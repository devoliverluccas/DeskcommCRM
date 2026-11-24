import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registrarDecisao: vi.fn(),
  marcaDaOrganizacaoParaPdf: vi.fn(),
}));
vi.mock("./decisao", () => ({ registrarDecisao: mocks.registrarDecisao }));
vi.mock("./marca-da-organizacao-para-pdf", () => ({ marcaDaOrganizacaoParaPdf: mocks.marcaDaOrganizacaoParaPdf }));
vi.mock("./data-no-fuso", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fusoDaOrganizacao: vi.fn(async () => "America/Sao_Paulo"),
}));

import { hashDoToken } from "./link-publico";
import { decidirPeloLink, lerOrcamentoPublico } from "./orcamento-publico";

type Linha = Record<string, unknown>;

/** Um banco de mentira que respeita `eq` — o suficiente para provar o filtro por organização. */
function banco(tabelas: Record<string, Linha[]>) {
  const consultas: Array<{ tabela: string; filtros: Record<string, unknown> }> = [];
  const db = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      consultas.push({ tabela, filtros });
      const linhas = () => (tabelas[tabela] ?? []).filter((l) => Object.entries(filtros).every(([c, v]) => l[c] === v));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        update: () => q,
        eq(c: string, v: unknown) {
          filtros[c] = v;
          return q;
        },
        order: () => q,
        maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
        then: (resolve: (r: { data: Linha[]; error: null }) => unknown) => resolve({ data: linhas(), error: null }),
      };
      return q;
    },
  };
  return { db: db as never, consultas };
}

const TOKEN = "C".repeat(43);
const AGORA = new Date("2026-11-24T15:00:00.000Z");

function mundo(over: { proposta?: Linha; link?: Linha; contato?: Linha } = {}) {
  return banco({
    crm_proposal_links: [
      {
        id: "link-1",
        organization_id: "org-1",
        proposal_id: "p1",
        token_hash: hashDoToken(TOKEN),
        expira_em: "2026-12-11T14:00:00.000Z",
        revogado_em: null,
        ...over.link,
      },
    ],
    crm_proposals: [
      {
        id: "p1",
        organization_id: "org-1",
        contact_id: "c1",
        status: "enviada",
        titulo: "Orçamento",
        numero: 7,
        ano: 2026,
        versao: 1,
        total_cents: 11500,
        desconto_cents: 1000,
        frete_cents: 2500,
        moeda: "BRL",
        valid_until: "2026-12-10",
        condicoes: null,
        decided_at: null,
        ...over.proposta,
      },
    ],
    crm_proposal_items: [
      { organization_id: "org-1", proposal_id: "p1", descricao: "Peça", quantidade: 2, preco_unitario_cents: 5000, desconto_cents: 0, position: 1 },
      { organization_id: "org-2", proposal_id: "p1", descricao: "De outra organização", quantidade: 1, preco_unitario_cents: 1, desconto_cents: 0, position: 2 },
    ],
    contacts: [{ id: "c1", organization_id: "org-1", name: "Joana", display_name: "Joana", is_anonymized: false, ...over.contato }],
    organizations: [{ id: "org-1", name: "Oficina do Zé" }],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.marcaDaOrganizacaoParaPdf.mockResolvedValue({ appName: null, accentHex: null, logoUrl: null });
});

describe("lerOrcamentoPublico", () => {
  it("acha o link pelo HASH do token e monta o orçamento da organização do link", async () => {
    const { db, consultas } = mundo();
    const o = await lerOrcamentoPublico(db, TOKEN, AGORA);
    expect(o).toMatchObject({
      estado: "aberta",
      organizationId: "org-1",
      cliente: "Joana",
      empresa: { nome: "Oficina do Zé" },
      subtotalCents: 10000,
      descontoCents: 1000,
      freteCents: 2500,
      totalCents: 11500,
    });
    // o item de outra organização NÃO aparece
    expect(o?.itens.map((i) => i.descricao)).toEqual(["Peça"]);
    // o token em claro nunca vai ao banco
    expect(consultas.find((c) => c.tabela === "crm_proposal_links")?.filtros).toEqual({ token_hash: hashDoToken(TOKEN) });
    // toda leitura depois do link filtra a organização DO LINK
    for (const c of consultas.filter((c) => c.tabela !== "crm_proposal_links" && c.tabela !== "organizations")) {
      expect(c.filtros.organization_id, c.tabela).toBe("org-1");
    }
  });

  it("token sem formato: null, sem consultar o banco", async () => {
    const { db, consultas } = mundo();
    expect(await lerOrcamentoPublico(db, "curto", AGORA)).toBeNull();
    expect(consultas).toHaveLength(0);
  });

  it("token desconhecido: null", async () => {
    const { db } = mundo();
    expect(await lerOrcamentoPublico(db, "D".repeat(43), AGORA)).toBeNull();
  });

  it("a marca é a da organização quando ela tem uma", async () => {
    mocks.marcaDaOrganizacaoParaPdf.mockResolvedValue({ appName: "Zé Peças", accentHex: "#123456", logoUrl: "https://logo" });
    const { db } = mundo();
    const o = await lerOrcamentoPublico(db, TOKEN, AGORA);
    expect(o?.empresa).toEqual({ nome: "Zé Peças", logoUrl: "https://logo", corHex: "#123456" });
    expect(mocks.marcaDaOrganizacaoParaPdf).toHaveBeenCalledWith(db, "org-1");
  });

  it("contato anonimizado: revogado e sem o nome, mesmo que o link não tenha sido revogado", async () => {
    const { db } = mundo({ contato: { is_anonymized: true, name: "Cliente Anonimizado #3" } });
    const o = await lerOrcamentoPublico(db, TOKEN, AGORA);
    expect(o?.estado).toBe("revogada");
    expect(o?.cliente).toBeNull();
  });

  it("validade passada no fuso da organização: vencida", async () => {
    const { db } = mundo({ proposta: { valid_until: "2026-11-23" } });
    expect((await lerOrcamentoPublico(db, TOKEN, AGORA))?.estado).toBe("vencida");
  });
});

describe("decidirPeloLink", () => {
  it("link aberto: decide pelo registrarDecisao com via 'cliente' e o link", async () => {
    mocks.registrarDecisao.mockResolvedValue({ ok: true, id: "p1", status: "aceita" });
    const { db } = mundo();
    const r = await decidirPeloLink(db, { token: TOKEN, decisao: "aceita", motivo: "ignorado no aceite", requestId: "req" });
    expect(r).toEqual({ ok: true, decisao: "aceita" });
    expect(mocks.registrarDecisao).toHaveBeenCalledWith(db, {
      orgId: "org-1",
      propostaId: "p1",
      decisao: "aceita",
      motivo: null,
      quem: { via: "cliente", linkId: "link-1" },
      requestId: "req",
    });
  });

  it.each([
    ["aceita", { proposta: { status: "aceita" } }],
    ["revogado", { link: { revogado_em: "2026-11-01T00:00:00Z" } }],
    ["substituída", { proposta: { status: "substituida" } }],
    ["vencido", { link: { expira_em: "2026-11-01T00:00:00Z" } }],
  ])("%s: fechado, sem decidir", async (_n, over) => {
    const { db } = mundo(over as never);
    const r = await decidirPeloLink(db, { token: TOKEN, decisao: "recusada", motivo: null, requestId: "req" });
    expect(r).toEqual({ ok: false, motivo: "fechado" });
    expect(mocks.registrarDecisao).not.toHaveBeenCalled();
  });

  it("corrida com a equipe (o UPDATE não achou 'enviada'): fechado", async () => {
    mocks.registrarDecisao.mockResolvedValue({ ok: false, motivo: "nao_enviada" });
    const { db } = mundo();
    const r = await decidirPeloLink(db, { token: TOKEN, decisao: "aceita", motivo: null, requestId: "req" });
    expect(r).toEqual({ ok: false, motivo: "fechado" });
  });

  it("token sem link: nao_encontrado", async () => {
    const { db } = mundo();
    const r = await decidirPeloLink(db, { token: "E".repeat(43), decisao: "aceita", motivo: null, requestId: "req" });
    expect(r).toEqual({ ok: false, motivo: "nao_encontrado" });
  });
});
