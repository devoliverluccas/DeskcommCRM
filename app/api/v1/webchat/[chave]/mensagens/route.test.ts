import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota pública do chat do site: a organização sai da LINHA da chave, o Origin
 * é conferido no servidor, o token do visitante é obrigatório e o limite por IP
 * e por visitante devolve 429 com CORS (o script precisa ler o status).
 */
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const OUTRA_ORG = "bbbbbbbb-0000-4000-8000-000000000002";
const SESSAO = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CHAVE = "c".repeat(32);
const TOKEN = "t".repeat(43);

const h = vi.hoisted(() => ({
  conexao: null as null | Record<string, unknown>,
  permitido: true,
  visitantePermitido: true,
  ingeridas: [] as Record<string, unknown>[],
  contato: null as null | Record<string, unknown>,
  lidas: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: async (balde: string) => ({
    allowed: balde.startsWith("webchat:visitante:") ? h.visitantePermitido : h.permitido,
  }),
}));
vi.mock("@/lib/channels/webchat/sessao", () => ({
  conexaoPelaChave: async (_db: unknown, chave: string) => (chave === CHAVE ? h.conexao : null),
}));
vi.mock("@/lib/channels/webchat/ingest", () => ({
  contatoDoVisitante: async () => h.contato,
  ingerirMensagemDoVisitante: async (_db: unknown, input: Record<string, unknown>) => {
    h.ingeridas.push(input);
    return { status: "ingested", conversationId: "conv", messageId: "msg", criadaEm: "2026-11-25T10:00:00.000Z" };
  },
}));
vi.mock("@/lib/channels/webchat/mensagens", () => ({
  mensagensParaOVisitante: async (_db: unknown, input: Record<string, unknown>) => {
    h.lidas.push(input);
    return [{ id: "m1", autor: "empresa", tipo: "text", texto: "Oi", midia: null, criada_em: "2026-11-25T10:00:00.000Z" }];
  },
}));

import { GET, OPTIONS, POST } from "./route";

const url = `http://localhost/api/v1/webchat/${CHAVE}/mensagens`;
const ctx = (chave = CHAVE) => ({ params: Promise.resolve({ chave }) });

function pedido(metodo: "GET" | "POST", over: { origin?: string | null; token?: string | null; corpo?: unknown; chave?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
  const origin = over.origin === undefined ? "https://www.loja.com.br" : over.origin;
  if (origin) headers.origin = origin;
  const token = over.token === undefined ? TOKEN : over.token;
  if (token) headers["x-webchat-visitante"] = token;
  return new NextRequest(url, {
    method: metodo,
    headers,
    body: metodo === "POST" ? JSON.stringify(over.corpo ?? { id: "11111111-1111-4111-8111-111111111111", texto: "Olá" }) : undefined,
  });
}

beforeEach(() => {
  h.conexao = {
    id: SESSAO,
    organizationId: ORG,
    chave: CHAVE,
    archivedAt: null,
    config: { nome: "Loja", saudacao: "", cor: "#1a1a1e", posicao: "direita", dominios: ["loja.com.br"], ativo: true },
  };
  h.permitido = true;
  h.visitantePermitido = true;
  h.ingeridas = [];
  h.contato = { id: "contato-1", name: null, email: null, is_anonymized: false };
  h.lidas = [];
});

describe("POST /api/v1/webchat/{chave}/mensagens", () => {
  it("aceita do domínio permitido e devolve CORS para AQUELE Origin", async () => {
    const res = await POST(pedido("POST"), ctx());
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.loja.com.br");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("a organização vem da conexão, nunca do corpo", async () => {
    await POST(pedido("POST", { corpo: { id: "11111111-1111-4111-8111-111111111111", texto: "Oi", organization_id: OUTRA_ORG } }), ctx());
    expect(h.ingeridas).toHaveLength(1);
    expect(h.ingeridas[0]!.organizationId).toBe(ORG);
    expect(h.ingeridas[0]!.channelSessionId).toBe(SESSAO);
    expect(h.ingeridas[0]!.token).toBe(TOKEN);
  });

  it("Origin fora da lista: 404 sem CORS e sem gravar", async () => {
    const res = await POST(pedido("POST", { origin: "https://golpe.example" }), ctx());
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(h.ingeridas).toHaveLength(0);
  });

  it("sem Origin (fora do navegador) também não passa", async () => {
    expect((await POST(pedido("POST", { origin: null }), ctx())).status).toBe(404);
  });

  it("chat desligado responde como chave inexistente", async () => {
    (h.conexao!.config as { ativo: boolean }).ativo = false;
    expect((await POST(pedido("POST"), ctx())).status).toBe(404);
    expect((await POST(pedido("POST"), ctx("d".repeat(32)))).status).toBe(404);
  });

  it("sem token do visitante: 401", async () => {
    expect((await POST(pedido("POST", { token: null }), ctx())).status).toBe(401);
    expect(h.ingeridas).toHaveLength(0);
  });

  it("mensagem acima do teto: 422", async () => {
    const res = await POST(pedido("POST", { corpo: { id: "11111111-1111-4111-8111-111111111111", texto: "x".repeat(2001) } }), ctx());
    expect(res.status).toBe(422);
    expect(h.ingeridas).toHaveLength(0);
  });

  it("limite por IP e por visitante: 429 com Retry-After e CORS", async () => {
    h.permitido = false;
    const porIp = await POST(pedido("POST"), ctx());
    expect(porIp.status).toBe(429);
    expect(porIp.headers.get("retry-after")).toBe("60");
    expect(porIp.headers.get("access-control-allow-origin")).toBe("https://www.loja.com.br");

    h.permitido = true;
    h.visitantePermitido = false;
    expect((await POST(pedido("POST"), ctx())).status).toBe(429);
    expect(h.ingeridas).toHaveLength(0);
  });
});

describe("GET /api/v1/webchat/{chave}/mensagens", () => {
  it("lê só o contato do token, na conexão da chave", async () => {
    const res = await GET(pedido("GET"), ctx());
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data: { mensagens: unknown[]; encerrada: boolean } };
    expect(corpo.data.mensagens).toHaveLength(1);
    expect(h.lidas[0]).toMatchObject({ organizationId: ORG, channelSessionId: SESSAO, contactId: "contato-1" });
  });

  it("ficha anonimizada (LGPD): nada volta e a sessão é encerrada", async () => {
    h.contato = { id: "contato-1", name: null, email: null, is_anonymized: true };
    const corpo = (await (await GET(pedido("GET"), ctx())).json()) as { data: { mensagens: unknown[]; encerrada: boolean } };
    expect(corpo.data).toEqual({ mensagens: [], encerrada: true });
    expect(h.lidas).toHaveLength(0);
  });

  it("cursor que não é data: 422", async () => {
    const req = new NextRequest(`${url}?depois=ontem`, {
      headers: { origin: "https://loja.com.br", "x-webchat-visitante": TOKEN },
    });
    expect((await GET(req, ctx())).status).toBe(422);
  });
});

describe("OPTIONS (preflight)", () => {
  it("CORS só para o domínio da lista", async () => {
    const ok = await OPTIONS(pedido("GET"), ctx());
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://www.loja.com.br");
    expect(ok.headers.get("access-control-allow-headers")).toContain("x-webchat-visitante");
    const nao = await OPTIONS(pedido("GET", { origin: "https://golpe.example" }), ctx());
    expect(nao.headers.get("access-control-allow-origin")).toBeNull();
  });
});
