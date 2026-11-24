import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { isPublicPath } from "@/lib/auth/public-paths";
import {
  FORMATO_DO_CODIGO,
  gerarCodigo,
  hashDoIp,
  linkDeSaida,
  registrarClique,
  resumirUserAgent,
  urlCurta,
} from "@/lib/plataformas-de-anuncio/rastreio/links-de-saida";
import { porContato, porRotulo, type LinkDeSaidaResumo } from "@/lib/plataformas-de-anuncio/rastreio/resumo-dos-links-de-saida";

/**
 * LINKS DE SAÍDA (fase 4, item 4.4) — as regras puras do encurtador e do clique.
 * O banco (índices, gatilho de LGPD, função do clique) está em
 * `tests/invariants/links-de-saida-e-valores-personalizados.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "33333333-3333-4333-8333-333333333333";

beforeEach(() => vi.clearAllMocks());

describe("o código e a URL curta", () => {
  it("10 alfanuméricos, aleatório, e a rota pública só abre esse formato", () => {
    const codigos = new Set(Array.from({ length: 200 }, gerarCodigo));
    expect(codigos.size).toBe(200);
    for (const c of codigos) expect(c).toMatch(FORMATO_DO_CODIGO);
    expect(urlCurta("https://crm.exemplo.com/", "AbCdE12345")).toBe("https://crm.exemplo.com/l/AbCdE12345");
    expect(isPublicPath("/l/AbCdE12345")).toBe(true);
    // Âncora: nenhum sub-path e nenhum outro formato nasce público de carona.
    expect(isPublicPath("/l/AbCdE12345/x")).toBe(false);
    expect(isPublicPath("/l/curto")).toBe(false);
    expect(isPublicPath("/l/AbCdE-1234")).toBe(false);
  });
});

describe("o clique, sem dado pessoal cru", () => {
  it("robô de prévia não é gente — o WhatsApp abre o link sozinho para montar a miniatura", () => {
    expect(resumirUserAgent("WhatsApp/2.24.6.77 A")).toEqual({ dispositivo: "robo", navegador: "WhatsApp" });
    expect(resumirUserAgent("facebookexternalhit/1.1").dispositivo).toBe("robo");
    expect(resumirUserAgent("TelegramBot (like TwitterBot)").dispositivo).toBe("robo");
  });

  it("celular, computador e navegador em duas palavras; CUBOT é celular, não robô", () => {
    expect(
      resumirUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
      ),
    ).toEqual({ dispositivo: "celular", navegador: "Chrome" });
    expect(
      resumirUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ dispositivo: "celular", navegador: "Safari" });
    expect(
      resumirUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0"),
    ).toEqual({ dispositivo: "computador", navegador: "Edge" });
    expect(resumirUserAgent("Mozilla/5.0 (Linux; Android 10; CUBOT X30) Chrome/120.0 Mobile").dispositivo).toBe("celular");
    expect(resumirUserAgent(null)).toEqual({ dispositivo: "desconhecido", navegador: null });
  });

  it("IP vira 16 hex com sal da organização — não volta ao IP e não cruza organizações", () => {
    const a = hashDoIp("203.0.113.7", ORG);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain("203");
    expect(hashDoIp("203.0.113.7", ORG)).toBe(a);
    expect(hashDoIp("203.0.113.7", OUTRA)).not.toBe(a);
    expect(hashDoIp(null, ORG)).toBeNull();
  });

  it("grava pela função do banco com a organização DA LINHA, e falha não lança", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "clique", error: null });
    const admin = { rpc } as unknown as SupabaseClient;
    await registrarClique(admin, { id: "link-1", organization_id: ORG }, { userAgent: "WhatsApp/2.24", ip: "203.0.113.7" });
    expect(rpc).toHaveBeenCalledWith("fn_registrar_clique_de_saida", {
      p_org: ORG,
      p_link: "link-1",
      p_dispositivo: "robo",
      p_navegador: "WhatsApp",
      p_ip_hash: hashDoIp("203.0.113.7", ORG),
    });

    rpc.mockResolvedValueOnce({ data: null, error: { message: "fora do ar" } });
    await expect(
      registrarClique(admin, { id: "link-1", organization_id: ORG }, { userAgent: null, ip: null }),
    ).resolves.toBeUndefined();
  });
});

describe("linkDeSaida — idempotente e à prova de corrida", () => {
  function admin(roteiro: { existentes: Array<unknown>; insercoes: Array<{ data: unknown; error: unknown }> }) {
    const inseridos: unknown[] = [];
    const from = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        is: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: roteiro.existentes.shift() ?? null, error: null }),
        insert: (linha: unknown) => {
          inseridos.push(linha);
          return q;
        },
        single: async () => roteiro.insercoes.shift()!,
      };
      return q;
    };
    return { cliente: { from } as unknown as SupabaseClient, inseridos };
  }
  const pedido = { organizationId: ORG, contactId: "c-1", destino: "https://loja.exemplo/", rotulo: null };

  it("já existe: reusa e não insere", async () => {
    const a = admin({ existentes: [{ id: "l1", codigo: "AAAAAAAAAA" }], insercoes: [] });
    expect(await linkDeSaida(a.cliente, pedido)).toEqual({ id: "l1", codigo: "AAAAAAAAAA" });
    expect(a.inseridos).toHaveLength(0);
  });

  it("perdeu a corrida (23505 com linha do vencedor): usa a do vencedor", async () => {
    const a = admin({
      existentes: [null, { id: "l2", codigo: "BBBBBBBBBB" }],
      insercoes: [{ data: null, error: { code: "23505", message: "dup" } }],
    });
    expect(await linkDeSaida(a.cliente, pedido)).toEqual({ id: "l2", codigo: "BBBBBBBBBB" });
  });

  it("colisão de código (23505 sem linha): tenta outro código", async () => {
    const a = admin({
      existentes: [null, null],
      insercoes: [
        { data: null, error: { code: "23505", message: "codigo" } },
        { data: { id: "l3", codigo: "CCCCCCCCCC" }, error: null },
      ],
    });
    expect(await linkDeSaida(a.cliente, pedido)).toEqual({ id: "l3", codigo: "CCCCCCCCCC" });
    const [primeiro, segundo] = a.inseridos as Array<{ codigo: string; organization_id: string }>;
    expect(primeiro!.codigo).not.toBe(segundo!.codigo);
    expect(segundo!.organization_id).toBe(ORG);
  });

  it("erro de banco: null (a URL sai sem rastreio) em vez de travar a mensagem", async () => {
    const a = admin({ existentes: [null], insercoes: [{ data: null, error: { code: "42501", message: "negado" } }] });
    expect(await linkDeSaida(a.cliente, pedido)).toBeNull();
  });
});

describe("o resumo da tela", () => {
  const link = (p: Partial<LinkDeSaidaResumo>): LinkDeSaidaResumo => ({
    id: "x",
    codigo: "AAAAAAAAAA",
    destino_url: "https://loja.exemplo/",
    rotulo: null,
    contact_id: null,
    contato_nome: null,
    anonimizado: false,
    created_at: "2026-11-24T00:00:00Z",
    cliques: 0,
    ultimo_clique: null,
    ...p,
  });

  it("por rótulo: mais clicado primeiro, 'sem rótulo' por último", () => {
    const grupos = porRotulo([
      link({ rotulo: "bf", cliques: 1 }),
      link({ rotulo: null, cliques: 9 }),
      link({ rotulo: "natal", cliques: 3 }),
      link({ rotulo: "bf", cliques: 0 }),
    ]);
    expect(grupos.map((g) => [g.chave, g.links, g.abertos, g.cliques])).toEqual([
      ["natal", 1, 1, 3],
      ["bf", 2, 1, 1],
      [null, 1, 1, 9],
    ]);
  });

  it("por contato: pelo id — dois contatos com o mesmo nome não se fundem", () => {
    const grupos = porContato([
      link({ contact_id: "c1", contato_nome: "Ana", cliques: 2 }),
      link({ contact_id: "c2", contato_nome: "Ana", cliques: 1 }),
    ]);
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.nome)).toEqual(["Ana", "Ana"]);
  });
});
