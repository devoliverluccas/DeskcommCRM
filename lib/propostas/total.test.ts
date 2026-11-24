import { describe, expect, it } from "vitest";
import { calcularSubtotal, calcularTotal } from "./total";
import type { ProposalItemInput } from "./tipos";

function item(over: Partial<ProposalItemInput> = {}): ProposalItemInput {
  return {
    product_id: null, descricao: "item", quantidade: 1,
    preco_unitario_cents: 1000, desconto_cents: 0, position: 1000, ...over,
  };
}

describe("calcularTotal", () => {
  it("soma quantidade x preco menos desconto, por item", () => {
    const total = calcularTotal([
      item({ quantidade: 2, preco_unitario_cents: 1000, desconto_cents: 0 }), // 2000
      item({ quantidade: 1, preco_unitario_cents: 5000, desconto_cents: 500 }), // 4500
    ]);
    expect(total).toBe(6500);
  });

  it("lista vazia soma zero", () => {
    expect(calcularTotal([])).toBe(0);
  });

  it("quantidade fracionária arredonda o item para baixo (centavos são inteiros)", () => {
    const total = calcularTotal([item({ quantidade: 1.5, preco_unitario_cents: 1000, desconto_cents: 0 })]);
    expect(total).toBe(1500);
    expect(Number.isInteger(total)).toBe(true);
  });

  it("nunca devolve negativo — desconto maior que o item trava em zero NO ITEM", () => {
    const total = calcularTotal([item({ quantidade: 1, preco_unitario_cents: 1000, desconto_cents: 5000 })]);
    expect(total).toBe(0);
  });

  it("item sem preço (null) NÃO entra na soma, mesmo com desconto (§5.2)", () => {
    expect(
      calcularTotal([
        item({ preco_unitario_cents: 1000 }),
        item({ preco_unitario_cents: null, desconto_cents: 500 }),
      ]),
    ).toBe(1000);
  });

  it("todos os itens sem preço: total zero, sem lançar", () => {
    expect(calcularTotal([item({ preco_unitario_cents: null })])).toBe(0);
  });
});

describe("calcularTotal — desconto e frete da proposta (migration 9480)", () => {
  const itens = [item({ quantidade: 2, preco_unitario_cents: 1000 })]; // 2000

  it("sem ajustes, o total é o de sempre", () => {
    expect(calcularTotal(itens)).toBe(2000);
    expect(calcularTotal(itens, {})).toBe(2000);
  });

  it("o desconto da proposta sai da soma dos itens", () => {
    expect(calcularTotal(itens, { desconto_cents: 300 })).toBe(1700);
  });

  it("o frete soma depois do desconto", () => {
    expect(calcularTotal(itens, { desconto_cents: 300, frete_cents: 1500 })).toBe(3200);
  });

  it("desconto maior que os itens trava em zero e NÃO come o frete", () => {
    expect(calcularTotal(itens, { desconto_cents: 99_999, frete_cents: 500 })).toBe(500);
  });

  it("nulos valem zero", () => {
    expect(calcularTotal(itens, { desconto_cents: null, frete_cents: null })).toBe(2000);
  });

  it("calcularSubtotal é a soma dos itens, sem ajustes", () => {
    expect(calcularSubtotal(itens)).toBe(2000);
  });
});
