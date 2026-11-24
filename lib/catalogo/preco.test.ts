import { describe, expect, it } from "vitest";

import { CONSTRAINT_DA_PROMOCAO, emPromocao, precoVigente, violouAPromocao } from "./preco";

/**
 * O PREÇO QUE VALE AGORA (migration 9481) — o que o agente responde e o que o
 * orçamento cobra. Os dois lados chamam `precoVigente`; se um dia divergirem, a
 * loja cumpre o menor.
 */
describe("precoVigente", () => {
  it("⭐ com promoção válida, vale a promoção", () => {
    expect(precoVigente({ preco_cents: 20000, preco_promocional_cents: 15000 })).toBe(15000);
    expect(emPromocao({ preco_cents: 20000, preco_promocional_cents: 15000 })).toBe(true);
  });

  it("sem promoção (nula ou ausente), vale o preço de venda", () => {
    expect(precoVigente({ preco_cents: 20000, preco_promocional_cents: null })).toBe(20000);
    expect(precoVigente({ preco_cents: 20000 })).toBe(20000);
    expect(emPromocao({ preco_cents: 20000 })).toBe(false);
  });

  it("⭐ 'promoção' igual ou maior que o preço não é promoção — vale o preço", () => {
    // O banco recusa (CHECK), mas a linha montada à mão não passa por ele.
    expect(precoVigente({ preco_cents: 20000, preco_promocional_cents: 20000 })).toBe(20000);
    expect(precoVigente({ preco_cents: 20000, preco_promocional_cents: 25000 })).toBe(20000);
  });

  it("promoção zero é promoção (brinde): vale zero", () => {
    expect(precoVigente({ preco_cents: 20000, preco_promocional_cents: 0 })).toBe(0);
  });
});

describe("violouAPromocao", () => {
  it("reconhece o 23514 da constraint da promoção", () => {
    expect(
      violouAPromocao({
        code: "23514",
        message: `new row for relation "catalog_products" violates check constraint "${CONSTRAINT_DA_PROMOCAO}"`,
      }),
    ).toBe(true);
  });

  it("controle: outra constraint, outro código ou nada não contam", () => {
    expect(violouAPromocao({ code: "23514", message: 'violates check constraint "catalog_products_preco_nao_negativo"' })).toBe(false);
    expect(violouAPromocao({ code: "23505", message: CONSTRAINT_DA_PROMOCAO })).toBe(false);
    expect(violouAPromocao(null)).toBe(false);
  });
});
