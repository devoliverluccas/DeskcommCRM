import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LinksDeSaida from "@/lib/plataformas-de-anuncio/rastreio/links-de-saida";

const m = vi.hoisted(() => ({ admin: vi.fn(), rate: vi.fn(), link: vi.fn(), clique: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: m.rate }));
vi.mock("@/lib/plataformas-de-anuncio/rastreio/links-de-saida", async (original) => ({
  ...(await original<typeof LinksDeSaida>()),
  linkPeloCodigo: m.link,
  registrarClique: m.clique,
}));

import { GET } from "./route";

/**
 * A ROTA PÚBLICA DO LINK CURTO (`/l/<codigo>`, fase 4, item 4.4). Mesmo molde de
 * `tests/unit/links-rastreaveis-rota.test.ts`: limite antes do banco, a
 * organização é a da LINHA, 302 sem cache, e nada depende de cookie.
 */
const CODIGO = "AbCdE12345";
const request = (codigo = CODIGO) =>
  new NextRequest(`https://crm.test/l/${codigo}?organization_id=org-b&to=https://evil.test`, {
    headers: { "x-forwarded-for": "192.0.2.1", "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" },
  });
const chamar = (codigo = CODIGO) => GET(request(codigo), { params: Promise.resolve({ codigo }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.admin.mockReturnValue({});
  m.rate.mockResolvedValue({ allowed: true });
  m.clique.mockResolvedValue(undefined);
  m.link.mockResolvedValue({ id: "link-1", organization_id: "org-a", destino_url: "https://loja.exemplo/oferta" });
});

describe("rota pública do link de saída", () => {
  it("302 para o destino GRAVADO (o `to` da URL é ignorado), sem cache nem referrer", async () => {
    const r = await chamar();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://loja.exemplo/oferta");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(m.link).toHaveBeenCalledWith({}, CODIGO);
  });

  it("registra o clique com a organização da linha, o user agent e o IP (que vira hash lá dentro)", async () => {
    await chamar();
    expect(m.clique).toHaveBeenCalledWith(
      {},
      { id: "link-1", organization_id: "org-a", destino_url: "https://loja.exemplo/oferta" },
      { userAgent: "Mozilla/5.0 (iPhone) Safari/604.1", ip: "192.0.2.1" },
    );
  });

  it("código inexistente ou anonimizado: 404 e nenhum clique", async () => {
    m.link.mockResolvedValue(null);
    expect((await chamar()).status).toBe(404);
    expect(m.clique).not.toHaveBeenCalled();
  });

  it("código malformado não consulta o banco", async () => {
    expect((await chamar("nao-e-codigo")).status).toBe(404);
    expect(m.admin).not.toHaveBeenCalled();
    expect(m.rate).not.toHaveBeenCalled();
  });

  it("o limite bloqueia antes da consulta", async () => {
    m.rate.mockResolvedValue({ allowed: false });
    const r = await chamar();
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(m.admin).not.toHaveBeenCalled();
  });
});
