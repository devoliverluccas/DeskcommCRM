import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: mocks.get } }));

import { PropostasDaConversa } from "./PropostasDaConversa";

function montar(lista: unknown[] | Error, onNovo?: () => void) {
  mocks.get.mockImplementation(async () => {
    if (lista instanceof Error) throw lista;
    return { data: lista };
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PropostasDaConversa contactId="c1" onNovo={onNovo} />
    </QueryClientProvider>,
  );
}

const BASE = {
  lead_id: "l1",
  moeda: "BRL",
  versao: 1,
  created_at: "2026-11-20T12:00:00.000Z",
  sent_at: null,
  decided_at: null,
  decided_via: "equipe",
};

beforeEach(() => vi.resetAllMocks());

describe("PropostasDaConversa — a lista Orçamentos do contato", () => {
  it("lê as propostas DO CONTATO e mostra número, título, valor, estado — cada linha abre a proposta", async () => {
    montar([
      { ...BASE, id: "p2", titulo: "Freios", status: "enviada", total_cents: 11500, numero: 12, ano: 2026 },
      { ...BASE, id: "p1", titulo: "Revisão", status: "rascunho", total_cents: 3000, numero: null, ano: null },
    ]);
    const linhas = await screen.findAllByTestId("orcamento-do-contato");
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/proposals?contact_id=c1", expect.anything());
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.getAttribute("href")).toBe("/app/proposals/p2");
    expect(linhas[0]!.textContent).toContain("0012/2026");
    expect(linhas[0]!.textContent).toMatch(/115,00/);
    expect(linhas[0]!.textContent).toContain("Enviada");
    expect(linhas[1]!.textContent).toContain("Rascunho");
  });

  it("decisão pelo link do cliente aparece como tal", async () => {
    montar([
      { ...BASE, id: "p3", titulo: "Pneus", status: "aceita", total_cents: 100, numero: 1, ano: 2026, decided_at: "2026-11-21T00:00:00Z", decided_via: "cliente" },
    ]);
    const [linha] = await screen.findAllByTestId("orcamento-do-contato");
    expect(linha!.textContent).toContain("Aceita");
    expect(linha!.textContent).toContain("pelo cliente");
  });

  it("vazio: diz que não há orçamento, e o botão Novo orçamento abre a gaveta", async () => {
    const onNovo = vi.fn();
    montar([], onNovo);
    expect(await screen.findByText("Nenhum orçamento ainda.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("novo-orcamento"));
    expect(onNovo).toHaveBeenCalled();
  });

  it("sem onNovo, não há botão", async () => {
    montar([]);
    await screen.findByText("Nenhum orçamento ainda.");
    expect(screen.queryByTestId("novo-orcamento")).toBeNull();
  });

  it("falha: diz que falhou e oferece tentar de novo", async () => {
    montar(new Error("rede"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Tentar novamente")).toBeTruthy();
  });
});
