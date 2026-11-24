import { describe, expect, it } from "vitest";

import {
  categoriaPedida,
  FILTRO_COM_ESTOQUE,
  filtrosDaUrl,
  queryDaTela,
  SEM_FILTROS,
  soComEstoquePedido,
} from "./busca-da-tela";

/** Os filtros da tela de Produtos e da rota (migration 9481). */
describe("filtros da URL", () => {
  it("categoria vem aparada; vazia ou maior que o campo é 'todas'", () => {
    expect(categoriaPedida("  Perfumaria ")).toBe("Perfumaria");
    expect(categoriaPedida("")).toBeNull();
    expect(categoriaPedida(undefined)).toBeNull();
    expect(categoriaPedida("x".repeat(81))).toBeNull();
  });

  it("só `1`/`true` ligam o estoque", () => {
    expect(soComEstoquePedido("1")).toBe(true);
    expect(soComEstoquePedido("TRUE")).toBe(true);
    expect(soComEstoquePedido("0")).toBe(false);
    expect(soComEstoquePedido(null)).toBe(false);
  });

  it("filtrosDaUrl junta os dois", () => {
    expect(filtrosDaUrl({ categoria: "Tênis", estoque: "1" })).toEqual({ categoria: "Tênis", soComEstoque: true });
    expect(filtrosDaUrl({})).toEqual(SEM_FILTROS);
  });

  it("o filtro de estoque é a regra do agente: sem controle conta como disponível", () => {
    expect(FILTRO_COM_ESTOQUE).toBe("controla_estoque.eq.false,quantidade.gt.0");
  });
});

describe("queryDaTela com filtros", () => {
  it("⭐ leva categoria e estoque na URL, e a página por último", () => {
    expect(queryDaTela("perfume", 2, { categoria: "Perfumaria", soComEstoque: true })).toBe(
      "?busca=perfume&categoria=Perfumaria&estoque=1&pagina=2",
    );
  });

  it("controle: sem filtros a URL é a de antes — a busca da tela não muda de forma", () => {
    expect(queryDaTela("glock", 1)).toBe("?busca=glock");
    expect(queryDaTela("", 1, SEM_FILTROS)).toBe("");
  });
});
