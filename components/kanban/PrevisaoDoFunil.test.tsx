/**
 * A VISÃO PREVISÃO DO FUNIL (fase 1, item 1.6).
 *
 * - Pede a previsão DESTE funil (`…/pipelines/[id]/forecast`), não a do padrão.
 * - Escreve o valor na régua do negócio (`formatValorDoNegocio`): em guarani,
 *   ₲125.000 é "Gs. 125.000", não cem vezes mais (o mesmo defeito do #1732).
 * - Moedas não se somam; o recorte truncado é dito.
 * - Por etapa: a mesma conta da coluna (chance da etapa), só etapas de espera.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Stage } from "@/lib/kanban/types";
import type { PrevisaoCarregada } from "@/lib/leads/previsao";
import type { Lead } from "@/lib/types/leads";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { PrevisaoDoFunil } from "./PrevisaoDoFunil";

const semNbsp = (s: string) => s.replace(/[  ]/g, " ");

function balde(moeda: string, bruto: number, ponderado: number) {
  return {
    moeda,
    bruto_cents: bruto,
    ponderado_cents: ponderado,
    n: 2,
    unico: { bruto_cents: bruto, ponderado_cents: ponderado },
    recorrente_mensal: { bruto_cents: 0, ponderado_cents: 0 },
  };
}

const ETAPAS = [
  { id: "e-1", name: "Proposta", is_won: false, is_lost: false, win_probability: 50 },
  { id: "e-2", name: "Contato", is_won: false, is_lost: false, win_probability: null },
  { id: "e-3", name: "Ganho", is_won: true, is_lost: false, win_probability: null },
] as unknown as Stage[];

const NEGOCIOS = [
  { id: "l-1", stage_id: "e-1", status: "open", value_cents: 100_000, currency: "BRL" },
  { id: "l-2", stage_id: "e-1", status: "open", value_cents: 10_000, currency: "EUR" },
  { id: "l-3", stage_id: "e-2", status: "open", value_cents: 30_000, currency: "BRL" },
  { id: "l-4", stage_id: "e-3", status: "won", value_cents: 999_999, currency: "BRL" },
] as unknown as Lead[];

function renderizar(previsao: PrevisaoCarregada) {
  get.mockResolvedValue({ data: previsao });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PrevisaoDoFunil pipelineId="p-9" stages={ETAPAS} leads={NEGOCIOS} />
    </QueryClientProvider>,
  );
}

beforeEach(() => get.mockReset());

describe("visão Previsão do funil", () => {
  it("pede a previsão deste funil e escreve guarani na régua do negócio", async () => {
    const b = balde("PYG", 25_000_000, 12_500_000);
    renderizar({
      pipeline_id: "p-9",
      fonte: "etapa",
      meses: [{ ...b, mes: "2026-10" }],
      totais: [b],
      sem_data: [],
      sem_probabilidade: [],
      recorrencia_nao_mensal: [],
    });

    const tabela = await screen.findByTestId("previsao-por-mes");
    expect(get).toHaveBeenCalledWith("/api/v1/pipelines/p-9/forecast");
    const celulas = Array.from(
      within(tabela).getByText("2026-10").closest("tr")!.querySelectorAll("td"),
    ).map((td) => semNbsp(td.textContent ?? ""));
    expect(celulas.slice(0, 4)).toEqual(["2026-10", "PYG", "Gs. 125.000", "Gs. 250.000"]);
  });

  it("diz quando a previsão é parcial", async () => {
    renderizar({
      pipeline_id: "p-9",
      fonte: "etapa",
      meses: [],
      totais: [],
      sem_data: [],
      sem_probabilidade: [],
      recorrencia_nao_mensal: [],
      truncado: true,
    });
    expect(await screen.findByTestId("previsao-truncada")).toBeTruthy();
  });

  it("por etapa: só etapas de espera, moedas lado a lado, sem chance sem ponderado", async () => {
    renderizar({
      pipeline_id: "p-9",
      fonte: "etapa",
      meses: [],
      totais: [],
      sem_data: [],
      sem_probabilidade: [],
      recorrencia_nao_mensal: [],
    });
    const tabela = await screen.findByTestId("previsao-por-etapa");
    expect(within(tabela).queryByText("Ganho")).toBeNull();

    const linha = (nome: string) =>
      Array.from(within(tabela).getByText(nome).closest("tr")!.querySelectorAll("td")).map((td) =>
        semNbsp(td.textContent ?? ""),
      );
    const proposta = linha("Proposta");
    expect(proposta[1]).toBe("50%");
    expect(proposta[2]).toBe("2");
    expect(proposta[3]).toContain("R$ 1.000,00");
    expect(proposta[3]).toContain("€");
    expect(proposta[4]).toContain("R$ 500,00");

    const contato = linha("Contato");
    expect(contato[1]).toBe("—");
    expect(contato[3]).toBe("R$ 300,00");
    expect(contato[4]).toBe("—");
  });
});
