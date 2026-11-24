// lib/propostas/preco-do-catalogo.test.ts
import { describe, expect, it, vi } from "vitest";
import { buscarPrecoDoCatalogo } from "./preco-do-catalogo";

function montarSupabase(resultado: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(function (this: typeof chain) { return this; }),
    eq: vi.fn(function (this: typeof chain) { return this; }),
    maybeSingle: vi.fn(async () => resultado),
  };
  return { from: vi.fn(() => chain), chain } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("buscarPrecoDoCatalogo", () => {
  it("produto ativo da própria organização: devolve o preço", async () => {
    const db = montarSupabase({ data: { preco_cents: 5000, moeda: "BRL" }, error: null });
    const r = await buscarPrecoDoCatalogo(db, "org-1", "prod-1");
    expect(r).toEqual({ preco_cents: 5000, moeda: "BRL" });
  });

  it("produto de OUTRA organização, apagado, ou inativo: devolve null (filtro é o próprio SELECT)", async () => {
    const db = montarSupabase({ data: null, error: null });
    const r = await buscarPrecoDoCatalogo(db, "org-1", "prod-de-outra-org");
    expect(r).toBeNull();
  });

  it("devolve também a moeda do produto (D11)", async () => {
    const chain = {
      select: vi.fn(function (this: typeof chain) { return this; }),
      eq: vi.fn(function (this: typeof chain) { return this; }),
      maybeSingle: vi.fn(async () => ({ data: { preco_cents: 5000, moeda: "USD" }, error: null })),
    };
    const db = { from: vi.fn(() => chain) } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const r = await buscarPrecoDoCatalogo(db, "org-1", "prod-1");
    expect(r).toEqual({ preco_cents: 5000, moeda: "USD" });
  });
});

describe("buscarPrecoDoCatalogo — preço promocional (9481)", () => {
  it("produto em promoção: o preço do item é o PROMOCIONAL", async () => {
    const db = montarSupabase({ data: { preco_cents: 5000, preco_promocional_cents: 3990, moeda: "BRL" }, error: null });
    expect(await buscarPrecoDoCatalogo(db, "org-1", "prod-1")).toEqual({ preco_cents: 3990, moeda: "BRL" });
  });

  it("sem promoção (nula): o preço de venda", async () => {
    const db = montarSupabase({ data: { preco_cents: 5000, preco_promocional_cents: null, moeda: "BRL" }, error: null });
    expect(await buscarPrecoDoCatalogo(db, "org-1", "prod-1")).toEqual({ preco_cents: 5000, moeda: "BRL" });
  });

  it("'promoção' maior que o preço não vale: o preço de venda", async () => {
    const db = montarSupabase({ data: { preco_cents: 5000, preco_promocional_cents: 6000, moeda: "BRL" }, error: null });
    expect(await buscarPrecoDoCatalogo(db, "org-1", "prod-1")).toEqual({ preco_cents: 5000, moeda: "BRL" });
  });

  it("pede a coluna da promoção no mesmo SELECT", async () => {
    const db = montarSupabase({ data: { preco_cents: 5000, moeda: "BRL" }, error: null });
    await buscarPrecoDoCatalogo(db, "org-1", "prod-1");
    const chain = (db as unknown as { chain: { select: { mock: { calls: unknown[][] } } } }).chain;
    expect(String(chain.select.mock.calls[0]?.[0])).toContain("preco_promocional_cents");
  });
});
