import { describe, expect, it } from "vitest";

import type { Produto } from "@/lib/schemas/produtos";

import { corpoDaEdicao, promocionalDoTexto, rascunhoDaEdicao } from "./edicao-do-produto";

const t = (s: string) => s;

const PRODUTO: Produto = {
  id: "p1",
  codigo: "PERF-1",
  nome: "Perfume",
  descricao: null,
  marca: null,
  categoria: null,
  capacidade: null,
  preco_cents: 20000,
  preco_promocional_cents: null,
  moeda: "BRL",
  custo_cents: null,
  controla_estoque: false,
  quantidade: 0,
  ativo: true,
  origem: "manual",
  imagem_url: null,
  fotos: [],
  updated_at: "2026-11-24T00:00:00Z",
};

/** O campo "Preço promocional" do formulário de edição (migration 9481). */
describe("preço promocional na edição", () => {
  it("⭐ preencher manda só a promoção, em centavos", () => {
    const rascunho = { ...rascunhoDaEdicao(PRODUTO), promocional: "149,90" };
    expect(corpoDaEdicao(rascunho, PRODUTO, t)).toEqual({ corpo: { preco_promocional_cents: 14990 } });
  });

  it("⭐ esvaziar tira a promoção (manda null)", () => {
    const comPromo = { ...PRODUTO, preco_promocional_cents: 15000 };
    const rascunho = rascunhoDaEdicao(comPromo);
    expect(rascunho.promocional).toBe("150,00");
    expect(corpoDaEdicao({ ...rascunho, promocional: "" }, comPromo, t)).toEqual({
      corpo: { preco_promocional_cents: null },
    });
  });

  it("sem mudança, nada vai ao servidor", () => {
    const comPromo = { ...PRODUTO, preco_promocional_cents: 15000 };
    expect(corpoDaEdicao(rascunhoDaEdicao(comPromo), comPromo, t)).toEqual({ corpo: {} });
  });

  it("⭐ promoção igual ou acima do preço é recusada antes de ir ao servidor", () => {
    const rascunho = { ...rascunhoDaEdicao(PRODUTO), promocional: "200,00" };
    const { corpo, erro } = corpoDaEdicao(rascunho, PRODUTO, t);
    expect(corpo).toEqual({});
    expect(erro).toMatch(/menor que o preço de venda/);
  });

  it("baixar o preço para abaixo da promoção também é recusado", () => {
    const comPromo = { ...PRODUTO, preco_promocional_cents: 15000 };
    const rascunho = { ...rascunhoDaEdicao(comPromo), preco: "100,00" };
    expect(corpoDaEdicao(rascunho, comPromo, t).erro).toMatch(/menor que o preço de venda/);
  });

  it("texto que não é preço falha fechado", () => {
    expect(promocionalDoTexto("de 10 por 5")).toBe("invalido");
    expect(promocionalDoTexto("  ")).toBeNull();
    const { erro } = corpoDaEdicao({ ...rascunhoDaEdicao(PRODUTO), promocional: "abc" }, PRODUTO, t);
    expect(erro).toBe("Preço promocional inválido.");
  });
});
