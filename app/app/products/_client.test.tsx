import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A TELA DO CATÁLOGO PARA MILHARES DE ITENS (migration 9481): grade e lista,
 * categoria e "só com estoque" na URL, preço promocional riscado e, quando o
 * texto não está em produto nenhum, os mais parecidos pela busca do agente.
 */

const replace = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { apiClient } from "@/lib/api/client";
import type { Produto } from "@/lib/schemas/produtos";

import { ProdutosClient } from "./_client";

const TEXTOS = { titulo: "Produtos", subtitulo: "", vazio: "vazio", vazioDica: "" };

function produto(over: Partial<Produto> = {}): Produto {
  return {
    id: "p1",
    codigo: "PERF-1",
    nome: "Perfume 212",
    descricao: "Amadeirado",
    marca: "Carolina",
    categoria: "Perfumaria",
    capacidade: null,
    preco_cents: 20000,
    preco_promocional_cents: null,
    moeda: "BRL",
    custo_cents: null,
    controla_estoque: true,
    quantidade: 3,
    ativo: true,
    origem: "manual",
    imagem_url: null,
    fotos: [],
    updated_at: "2026-11-24T00:00:00Z",
    ...over,
  };
}

type Props = Partial<React.ComponentProps<typeof ProdutosClient>>;

function tela(props: Props = {}) {
  return render(
    <ProdutosClient
      inicial={[produto()]}
      total={1}
      pagina={1}
      porPagina={50}
      buscaInicial=""
      urlsDasFotos={{}}
      podeEditar
      textos={TEXTOS}
      {...props}
    />,
  );
}

const semNbsp = (s: string | null | undefined) => (s ?? "").replace(/[  ]/g, " ");

beforeEach(() => {
  replace.mockClear();
  vi.mocked(apiClient.post).mockReset();
  window.localStorage.clear();
});

describe("grade e lista", () => {
  it("⭐ nasce em lista; a grade mostra foto, nome, SKU, categoria, preço e o selo de estoque", () => {
    tela({ inicial: [produto(), produto({ id: "p2", codigo: "PERF-2", quantidade: 0 })], total: 2 });

    expect(screen.getByTestId("lista-produtos")).toHaveAttribute("data-vista", "lista");
    expect(screen.getByTestId("vista-lista")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("vista-grade"));

    expect(screen.getByTestId("lista-produtos")).toHaveAttribute("data-vista", "grade");
    expect(screen.getByTestId("vista-grade")).toHaveAttribute("aria-pressed", "true");
    const cartao = screen.getByTestId("produto-PERF-1");
    expect(within(cartao).getByText("Perfume 212")).toBeInTheDocument();
    expect(within(cartao).getByText(/PERF-1 · Perfumaria/)).toBeInTheDocument();
    expect(within(cartao).getByText(/3\s+em estoque/)).toBeInTheDocument();
    expect(within(screen.getByTestId("produto-PERF-2")).getByText("Sem estoque")).toBeInTheDocument();
    // As ações de quem edita continuam no cartão, com os mesmos testids.
    expect(within(cartao).getByTestId("editar-PERF-1")).toBeInTheDocument();
    // E a escolha fica guardada para a próxima visita.
    expect(window.localStorage.getItem("produtos.vista")).toBe("grade");
  });

  it("a escolha guardada volta na próxima visita", () => {
    window.localStorage.setItem("produtos.vista", "grade");
    tela();
    expect(screen.getByTestId("lista-produtos")).toHaveAttribute("data-vista", "grade");
  });
});

describe("filtros na URL", () => {
  it("⭐ escolher categoria vai à URL, com a busca e voltando à página 1", () => {
    tela({ categorias: ["Perfumaria", "Tênis"], buscaInicial: "212", pagina: 3, total: 200 });

    fireEvent.change(screen.getByTestId("filtro-categoria"), { target: { value: "Tênis" } });
    expect(replace).toHaveBeenCalledWith("?busca=212&categoria=T%C3%AAnis", { scroll: false });
  });

  it("⭐ 'Só com estoque' liga e desliga pela URL", () => {
    const { unmount } = tela();
    fireEvent.click(screen.getByTestId("filtro-estoque"));
    expect(replace).toHaveBeenLastCalledWith("?estoque=1", { scroll: false });
    unmount();

    tela({ filtros: { categoria: "Perfumaria", soComEstoque: true } });
    expect(screen.getByTestId("filtro-estoque")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("filtro-estoque"));
    expect(replace).toHaveBeenLastCalledWith("?categoria=Perfumaria", { scroll: false });
  });

  it("a paginação mantém os filtros", () => {
    tela({ total: 120, filtros: { categoria: "Perfumaria", soComEstoque: true } });
    fireEvent.click(screen.getByTestId("proxima-pagina"));
    expect(replace).toHaveBeenLastCalledWith("?categoria=Perfumaria&estoque=1&pagina=2", { scroll: false });
  });

  it("sem categorias cadastradas, o seletor não aparece", () => {
    tela();
    expect(screen.queryByTestId("filtro-categoria")).toBeNull();
  });
});

describe("preço promocional", () => {
  it("⭐ em promoção, o preço que vale vem com o de antes riscado", () => {
    tela({ inicial: [produto({ preco_promocional_cents: 15000 })] });

    const preco = screen.getByTestId("promocao-PERF-1");
    expect(semNbsp(preco.querySelector("s")?.textContent)).toContain("R$ 200,00");
    expect(semNbsp(preco.textContent)).toMatch(/R\$ 150,00$/);
  });

  it("⭐ o cadastro manda a promoção em centavos — e recusa a que não é menor que o preço", async () => {
    tela();
    fireEvent.click(screen.getByTestId("novo-produto"));
    fireEvent.change(screen.getByTestId("produto-codigo"), { target: { value: "X1" } });
    fireEvent.change(screen.getByTestId("produto-nome"), { target: { value: "Produto X" } });
    fireEvent.change(screen.getByTestId("produto-preco"), { target: { value: "100,00" } });
    fireEvent.change(screen.getByTestId("produto-promocional"), { target: { value: "100,00" } });
    fireEvent.click(screen.getByTestId("salvar-produto"));
    expect(apiClient.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("produto-promocional"), { target: { value: "89,90" } });
    fireEvent.click(screen.getByTestId("salvar-produto"));
    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/v1/products",
      expect.objectContaining({ preco_cents: 10000, preco_promocional_cents: 8990 }),
    );
  });
});

describe("busca sem resultado por texto", () => {
  it("⭐ mostra os mais parecidos — a busca do atendente — sem fingir que são resultado", () => {
    tela({
      inicial: [],
      total: 0,
      buscaInicial: "ifone",
      parecidos: [produto({ id: "i", codigo: "IP15", nome: "iPhone 15" })],
    });

    expect(screen.getByTestId("produtos-busca-vazia")).toBeInTheDocument();
    expect(screen.queryByTestId("lista-produtos")).toBeNull();
    expect(within(screen.getByTestId("lista-parecidos")).getByText("iPhone 15")).toBeInTheDocument();
  });

  it("controle: sem parecidos, só o vazio", () => {
    tela({ inicial: [], total: 0, buscaInicial: "xyz" });
    expect(screen.getByTestId("produtos-busca-vazia")).toBeInTheDocument();
    expect(screen.queryByTestId("produtos-parecidos")).toBeNull();
  });
});
