import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decidirPeloLink: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/propostas/orcamento-publico", () => ({ decidirPeloLink: mocks.decidirPeloLink }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { isPublicPath } from "@/lib/auth/public-paths";

import { POST } from "./route";

const TOKEN = "A".repeat(43);

function pedido(token: string, campos: Record<string, string>) {
  const corpo = new URLSearchParams(campos);
  return POST(
    new NextRequest(`http://localhost/o/${token}/decidir`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.9" },
      body: corpo.toString(),
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, count: 1, limit: 10 });
});

describe("POST /o/[token]/decidir", () => {
  it("aceite: decide pelo MESMO caminho da equipe e volta (303) para a página com ?r=aceita", async () => {
    mocks.decidirPeloLink.mockResolvedValue({ ok: true, decisao: "aceita" });
    const res = await pedido(TOKEN, { decisao: "aceita" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/o/${TOKEN}?r=aceita`);
    expect(mocks.decidirPeloLink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ token: TOKEN, decisao: "aceita", motivo: null }),
    );
  });

  it("recusa com motivo: o motivo viaja aparado", async () => {
    mocks.decidirPeloLink.mockResolvedValue({ ok: true, decisao: "recusada" });
    const res = await pedido(TOKEN, { decisao: "recusada", motivo: "  ficou caro  " });
    expect(res.headers.get("location")).toBe(`/o/${TOKEN}?r=recusada`);
    expect(mocks.decidirPeloLink).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ motivo: "ficou caro" }));
  });

  it("link fechado (já decidido, vencido, revogado): volta com ?erro=fechado, nada decidido", async () => {
    mocks.decidirPeloLink.mockResolvedValue({ ok: false, motivo: "fechado" });
    const res = await pedido(TOKEN, { decisao: "aceita" });
    expect(res.headers.get("location")).toBe(`/o/${TOKEN}?erro=fechado`);
  });

  it("token sem link: 404", async () => {
    mocks.decidirPeloLink.mockResolvedValue({ ok: false, motivo: "nao_encontrado" });
    const res = await pedido(TOKEN, { decisao: "aceita" });
    expect(res.status).toBe(404);
  });

  it("token sem o formato: 404 sem tocar no banco", async () => {
    const res = await pedido("curto", { decisao: "aceita" });
    expect(res.status).toBe(404);
    expect(mocks.decidirPeloLink).not.toHaveBeenCalled();
  });

  it("decisão fora do vocabulário: não decide", async () => {
    const res = await pedido(TOKEN, { decisao: "talvez" });
    expect(res.headers.get("location")).toBe(`/o/${TOKEN}?erro=falha`);
    expect(mocks.decidirPeloLink).not.toHaveBeenCalled();
  });

  it("rate limit por IP: volta com ?erro=limite ANTES de decidir", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, count: 11, limit: 10 });
    const res = await pedido(TOKEN, { decisao: "aceita" });
    expect(res.headers.get("location")).toBe(`/o/${TOKEN}?erro=limite`);
    expect(mocks.decidirPeloLink).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.stringContaining("203.0.113.9"), expect.any(Number), expect.any(Number));
  });

  it("falha inesperada vira ?erro=falha, nunca 500 para o cliente", async () => {
    mocks.decidirPeloLink.mockRejectedValue(new Error("banco fora"));
    const res = await pedido(TOKEN, { decisao: "aceita" });
    expect(res.headers.get("location")).toBe(`/o/${TOKEN}?erro=falha`);
  });
});

describe("a rota pública do orçamento atravessa o proxy — e só ela", () => {
  it("a página e o decidir, com o token na forma exata", () => {
    expect(isPublicPath(`/o/${TOKEN}`)).toBe(true);
    expect(isPublicPath(`/o/${TOKEN}/decidir`)).toBe(true);
  });

  it("nem token curto, nem sub-path, nem a pasta", () => {
    expect(isPublicPath("/o")).toBe(false);
    expect(isPublicPath("/o/abc")).toBe(false);
    expect(isPublicPath(`/o/${TOKEN}/outra-coisa`)).toBe(false);
    expect(isPublicPath(`/o/${TOKEN}/decidir/x`)).toBe(false);
  });
});
