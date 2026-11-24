/**
 * A FAIXA DO TOPO lê desta rota, e ela pede duas coisas que o badge não pedia:
 * desde quando espera a conversa mais antiga da Fila, e o NOME de cada fila com
 * gente esperando. As duas pelo MESMO predicado do número `fila` — a faixa que
 * dissesse "mais antigo há 3 d" de uma conversa que o número não conta mandaria
 * o atendente procurar trabalho que não existe.
 */
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "0a0a0a0a-0000-4000-8000-000000000001";
const EU = "0a0a0a0a-2222-4000-8000-000000000001";
const VENDAS = "11111111-1111-4111-8111-111111111111";
const SUPORTE = "22222222-2222-4222-8222-222222222222";
const VAZIA = "33333333-3333-4333-8333-333333333333";

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]> = {};

/** Builder falso do supabase-js que APLICA os filtros, a ordem e o limite. */
function consulta(
  nome: string,
  filtros: Array<(l: Linha) => boolean> = [],
  ordem?: { coluna: string; asc: boolean },
  limite?: number,
) {
  const linhas = tabelas[nome] ?? [];
  const com = (f: (l: Linha) => boolean) => consulta(nome, [...filtros, f], ordem, limite);
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => com((l) => l[c] === v),
    is: (c: string, v: unknown) => com((l) => (v === null ? l[c] == null : l[c] === v)),
    in: (c: string, vs: unknown[]) => com((l) => vs.includes(l[c])),
    not: (c: string, op: string, valor: unknown) =>
      op === "is"
        ? com((l) => l[c] != null)
        : com((l) => !String(valor).slice(1, -1).split(",").includes(String(l[c]))),
    gt: (c: string, v: number) => com((l) => Number(l[c]) > v),
    order: (coluna: string, o: { ascending: boolean }) =>
      consulta(nome, filtros, { coluna, asc: o.ascending }, limite),
    limit: (n: number) => consulta(nome, filtros, ordem, n),
    then: (ok: (r: { count: number; error: null; data: Linha[] }) => unknown) => {
      let data = linhas.filter((l) => filtros.every((f) => f(l)));
      if (ordem) {
        data = [...data].sort((a, b) => {
          const x = String(a[ordem.coluna]);
          const y = String(b[ordem.coluna]);
          return ordem.asc ? x.localeCompare(y) : y.localeCompare(x);
        });
      }
      if (limite !== undefined) data = data.slice(0, limite);
      return Promise.resolve({ count: data.length, error: null, data }).then(ok);
    },
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: EU } }, error: null }) },
    from: (nome: string) => consulta(nome),
  }),
}));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: async () => ({ id: EU }) }));
vi.mock("@/lib/auth/require-role", () => ({
  orgAtivaDaApi: async () => ({ ok: true, org: { orgId: ORG, role: "agent" } }),
}));
vi.mock("@/lib/channels/desativado", () => ({ idsDosCanaisDesativados: async () => [] }));
vi.mock("@/lib/ai/agents/org-tem-automatico", () => ({ orgTemAutomatico: async () => true }));
vi.mock("@/app/api/v1/conversations/_handler", () => ({
  idsDeContatosPessoais: async () => [],
  idsDeContatosPessoaisVisiveis: async () => [],
}));

const { GET } = await import("./route");

interface Corpo {
  fila: number;
  por_fila: Record<string, number>;
  fila_mais_antiga_desde: string | null;
  setores: Array<{ id: string; nome: string; na_fila: number }>;
}

async function contagens(qs = ""): Promise<Corpo> {
  const req = {
    nextUrl: new URL(`http://x/api/v1/conversations/counts${qs ? `?${qs}` : ""}`),
  } as unknown as NextRequest;
  return ((await (await GET(req)).json()) as { data: Corpo }).data;
}

/** Conversa esperando gente: sem dono, aberta, com o comando `aguardando`. */
const naFila = (id: string, desde: string | null, setor: string | null): Linha => ({
  id,
  organization_id: ORG,
  assigned_to_user_id: null,
  status: "open",
  comando_da_conversa: "aguardando",
  awaiting_since: desde,
  sector_id: setor,
});

beforeEach(() => {
  tabelas = {
    conversations: [],
    attendant_sectors: [
      { id: VENDAS, organization_id: ORG, name: "Vendas" },
      { id: SUPORTE, organization_id: ORG, name: "Suporte" },
      { id: VAZIA, organization_id: ORG, name: "Financeiro" },
    ],
  };
});

describe("a faixa do topo: a espera mais antiga e as filas com nome", () => {
  it("devolve o MENOR awaiting_since entre as conversas que a Fila conta", async () => {
    tabelas.conversations = [
      naFila("c1", "2026-11-20T10:00:00.000Z", VENDAS),
      naFila("c2", "2026-11-18T08:00:00.000Z", VENDAS),
      naFila("c3", "2026-11-22T09:00:00.000Z", SUPORTE),
      naFila("c4", null, null),
      // Mais velha de todas, mas com DONO: não é fila, não pode ser "a mais antiga".
      { ...naFila("c5", "2026-01-01T00:00:00.000Z", VENDAS), assigned_to_user_id: EU, comando_da_conversa: "humano" },
      // Mais velha também, mas o automático está no comando: fora da Fila.
      { ...naFila("c6", "2026-02-01T00:00:00.000Z", null), comando_da_conversa: "automatico" },
    ];
    const corpo = await contagens();
    expect(corpo.fila).toBe(4);
    expect(corpo.fila_mais_antiga_desde).toBe("2026-11-18T08:00:00.000Z");
  });

  it("sem awaiting_since, a espera cai na reserva da pílula (last_inbound_at) — e pode ser a mais antiga", async () => {
    tabelas.conversations = [
      naFila("c1", "2026-11-20T10:00:00.000Z", VENDAS),
      { ...naFila("c2", null, SUPORTE), last_inbound_at: "2026-11-10T07:00:00.000Z" },
    ];
    const corpo = await contagens();
    expect(corpo.fila).toBe(2);
    expect(corpo.fila_mais_antiga_desde).toBe("2026-11-10T07:00:00.000Z");
  });

  it("lista só as filas com gente esperando, com o nome, da mais cheia à mais vazia", async () => {
    tabelas.conversations = [
      naFila("c1", "2026-11-20T10:00:00.000Z", SUPORTE),
      naFila("c2", "2026-11-18T08:00:00.000Z", VENDAS),
      naFila("c3", "2026-11-19T08:00:00.000Z", VENDAS),
    ];
    const corpo = await contagens();
    expect(corpo.setores).toEqual([
      { id: VENDAS, nome: "Vendas", na_fila: 2 },
      { id: SUPORTE, nome: "Suporte", na_fila: 1 },
    ]);
    // O que já existia não mudou: `por_fila` segue trazendo toda fila, zerada inclusive.
    expect(corpo.por_fila).toEqual({ [VENDAS]: 2, [SUPORTE]: 1, [VAZIA]: 0 });
  });

  it("Fila vazia: sem espera mais antiga e sem setores", async () => {
    tabelas.conversations = [
      { ...naFila("c1", "2026-11-18T08:00:00.000Z", VENDAS), assigned_to_user_id: EU, comando_da_conversa: "humano" },
    ];
    const corpo = await contagens();
    expect(corpo.fila).toBe(0);
    expect(corpo.fila_mais_antiga_desde).toBeNull();
    expect(corpo.setores).toEqual([]);
  });

  it("respeita a fila escolhida na URL, como o número `fila`", async () => {
    tabelas.conversations = [
      naFila("c1", "2026-11-18T08:00:00.000Z", VENDAS),
      naFila("c2", "2026-11-21T08:00:00.000Z", SUPORTE),
    ];
    const corpo = await contagens(`sector_id=${SUPORTE}`);
    expect(corpo.fila).toBe(1);
    expect(corpo.fila_mais_antiga_desde).toBe("2026-11-21T08:00:00.000Z");
  });
});
