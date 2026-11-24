import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  pipeline: { data: undefined as unknown },
  toast: { success: vi.fn(), message: vi.fn() },
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: mocks.get, post: mocks.post, patch: mocks.patch } }));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({ useDefaultPipeline: () => mocks.pipeline }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { OrcamentoDaConversa, paraCentavos } from "./OrcamentoDaConversa";

const CONTATO = "c1";
const CONVERSA = "conv-1";
const PRODUTO = { id: "prod-1", codigo: "PST-01", nome: "Pastilha de freio", preco_cents: 5000, moeda: "BRL" };

interface Mundo {
  negocios?: Array<Record<string, unknown>>;
}

function montar(m: Mundo = {}) {
  mocks.get.mockImplementation(async (url: string) => {
    if (url.includes("/crm-summary")) {
      return { data: { leads: m.negocios ?? [{ id: "lead-1", title: "Freios", status: "open", currency: "BRL", etapa_nome: "Proposta" }] } };
    }
    if (url.startsWith("/api/v1/settings/proposal-templates")) {
      return { data: [{ slug: "orcamento", nome: "Orçamento simples", oculto: false }, { slug: "x", nome: "Oculto", oculto: true }] };
    }
    if (url.startsWith("/api/v1/products?busca=")) return { data: [PRODUTO] };
    throw new Error(`GET inesperado: ${url}`);
  });
  const onAbertoChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrcamentoDaConversa aberto onAbertoChange={onAbertoChange} conversationId={CONVERSA} contactId={CONTATO} contactName="Joana" />
    </QueryClientProvider>,
  );
  return { onAbertoChange };
}

async function adicionarProduto() {
  fireEvent.change(screen.getByTestId("orcamento-busca"), { target: { value: "past" } });
  const opcao = await screen.findByText("Pastilha de freio", {}, { timeout: 2000 });
  fireEvent.click(opcao);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pipeline = { data: undefined };
});

describe("paraCentavos", () => {
  it.each([
    ["12,50", 1250],
    ["12.50", 1250],
    ["1.234,56", 123456],
    ["R$ 10", 1000],
    ["", null],
    ["abc", null],
    ["-3", null],
  ])("%s → %s", (texto, esperado) => {
    expect(paraCentavos(texto)).toBe(esperado);
  });
});

describe("OrcamentoDaConversa — a gaveta Novo orçamento", () => {
  it("total ao vivo: item do catálogo, desconto e frete — com o rótulo de prévia", async () => {
    montar();
    await adicionarProduto();
    const qtd = screen.getByLabelText("Quantidade");
    fireEvent.change(qtd, { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Desconto"), { target: { value: "10,00" } });
    fireEvent.change(screen.getByLabelText("Frete"), { target: { value: "25" } });
    const total = screen.getByTestId("orcamento-total").textContent ?? "";
    expect(total).toContain("Subtotal");
    expect(total).toMatch(/115,00/); // 2 × 50 − 10 + 25
    expect(total).toContain("Prévia — o total oficial é calculado ao salvar");
  });

  it("Salvar: cria pela rota de proposta, com o negócio aberto, a conversa, o desconto e o frete", async () => {
    montar();
    mocks.post.mockResolvedValue({ data: { id: "p-1" } });
    await adicionarProduto();
    fireEvent.change(screen.getByLabelText("Desconto"), { target: { value: "5" } });
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar")));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [url, corpo] = mocks.post.mock.calls[0]!;
    expect(url).toBe("/api/v1/proposals");
    expect(corpo).toMatchObject({
      lead_id: "lead-1",
      conversation_id: CONVERSA,
      desconto_cents: 500,
      frete_cents: 0,
      itens: [expect.objectContaining({ product_id: "prod-1", quantidade: 1 })],
    });
  });

  it("sem negócio aberto: cria o negócio no funil padrão (primeira etapa aberta) e só então a proposta", async () => {
    mocks.pipeline = {
      data: {
        pipeline: { id: "pipe-1" },
        stages: [
          { id: "st-ganho", is_won: true, is_lost: false, is_archived: false },
          { id: "st-novo", is_won: false, is_lost: false, is_archived: false },
        ],
      },
    };
    montar({ negocios: [] });
    mocks.post.mockImplementation(async (url: string) =>
      url === "/api/v1/leads" ? { data: { id: "lead-novo" } } : { data: { id: "p-1" } },
    );
    await screen.findByText(/Sem negócio aberto/);
    await adicionarProduto();
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar")));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    expect(mocks.post.mock.calls[0]![0]).toBe("/api/v1/leads");
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ pipeline_id: "pipe-1", stage_id: "st-novo", contact_id: CONTATO });
    expect(mocks.post.mock.calls[1]![1]).toMatchObject({ lead_id: "lead-novo" });
  });

  it("Salvar e enviar sem modelo: diz o que falta e não grava nada", async () => {
    montar();
    await adicionarProduto();
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar-e-enviar")));
    expect(screen.getByRole("alert").textContent).toContain("Escolha o modelo do documento antes de enviar.");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("Salvar e enviar: cria com o modelo, envia pela rota send e fecha a gaveta", async () => {
    const { onAbertoChange } = montar();
    mocks.post.mockImplementation(async (url: string) =>
      url.endsWith("/send") ? { data: { status: "enviada", ultima_falha_envio: null } } : { data: { id: "p-1" } },
    );
    await screen.findByRole("option", { name: "Orçamento simples" });
    fireEvent.change(screen.getByLabelText("Modelo do documento"), { target: { value: "orcamento" } });
    await adicionarProduto();
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar-e-enviar")));
    await waitFor(() => expect(onAbertoChange).toHaveBeenCalledWith(false));
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ template_slug: "orcamento" });
    expect(mocks.post.mock.calls[1]![0]).toBe("/api/v1/proposals/p-1/send");
    expect(mocks.toast.success).toHaveBeenCalled();
  });

  it("modelo oculto não aparece no seletor", async () => {
    montar();
    await screen.findByRole("option", { name: "Orçamento simples" });
    expect(screen.queryByRole("option", { name: "Oculto" })).toBeNull();
  });

  it("envio recusado com 403 (item avulso): a gaveta diz que o envio é do gestor", async () => {
    montar();
    mocks.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/send")) throw new ApiError(403, "forbidden_role", undefined, "req");
      return { data: { id: "p-1" } };
    });
    await screen.findByRole("option", { name: "Orçamento simples" });
    fireEvent.change(screen.getByLabelText("Modelo do documento"), { target: { value: "orcamento" } });
    fireEvent.click(screen.getByTestId("orcamento-item-avulso"));
    fireEvent.change(screen.getByLabelText("Descrição 1"), { target: { value: "Mão de obra" } });
    fireEvent.change(screen.getByLabelText("Preço unit. 1"), { target: { value: "80" } });
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar-e-enviar")));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("quem envia é o gestor"));
    expect(mocks.post.mock.calls[0]![1]).toMatchObject({ itens: [expect.objectContaining({ product_id: null, preco_unitario_cents: 8000 })] });
  });

  it("negócio que já tem rascunho (409): mostra a recusa e o caminho para o rascunho aberto", async () => {
    montar();
    mocks.post.mockRejectedValue(
      new ApiError(409, "validation_failed", { rascunho_aberto_id: "rasc-9" }, "req", "Este negócio já tem um rascunho de proposta aberto."),
    );
    await adicionarProduto();
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar")));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("já tem um rascunho");
    expect(screen.getByRole("link", { name: "Abrir proposta" }).getAttribute("href")).toBe("/app/proposals/rasc-9");
  });

  it("sem item nenhum: Salvar não chama a rota", async () => {
    montar();
    await act(async () => fireEvent.click(screen.getByTestId("orcamento-salvar")));
    expect(screen.getByRole("alert").textContent).toContain("Adicione ao menos um item.");
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
