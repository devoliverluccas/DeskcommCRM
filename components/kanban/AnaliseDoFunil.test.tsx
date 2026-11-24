/**
 * A VISÃO ANÁLISE DO FUNIL (fase 1, item 1.6).
 *
 * - Conversão entre etapas: da análise de funil do Desempenho
 *   (`/api/v1/metrics/funil`), recortada para ESTE funil — linhas de outro
 *   funil não entram.
 * - Tempo na etapa: dos negócios abertos do quadro, desde a entrada na etapa.
 * - Motivos de perda: dos perdidos do quadro, com a régua do relatório de Perdas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { AnaliseDoFunil, duracaoCurta } from "./AnaliseDoFunil";

const AGORA = new Date("2026-11-20T12:00:00.000Z");

const ETAPAS = [
  { id: "e-1", name: "Contato", is_won: false, is_lost: false },
  { id: "e-2", name: "Proposta", is_won: false, is_lost: false },
  { id: "e-3", name: "Perdido", is_won: false, is_lost: true },
] as unknown as Stage[];

const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

const NEGOCIOS = [
  {
    id: "l-1",
    stage_id: "e-1",
    status: "open",
    stage_changed_at: horasAtras(10),
    created_at: horasAtras(500),
  },
  {
    id: "l-2",
    stage_id: "e-1",
    status: "open",
    stage_changed_at: horasAtras(30),
    created_at: horasAtras(500),
  },
  {
    id: "l-3",
    stage_id: "e-2",
    status: "open",
    stage_changed_at: horasAtras(96),
    created_at: horasAtras(500),
  },
  {
    id: "l-4",
    stage_id: "e-3",
    status: "lost",
    lost_reason: "Preço alto",
    stage_changed_at: null,
    created_at: horasAtras(1),
  },
  {
    id: "l-5",
    stage_id: "e-3",
    status: "lost",
    lost_reason: "Preço alto",
    stage_changed_at: null,
    created_at: horasAtras(1),
  },
  {
    id: "l-6",
    stage_id: "e-3",
    status: "lost",
    lost_reason: null,
    stage_changed_at: null,
    created_at: horasAtras(1),
  },
] as unknown as Lead[];

function linhaDe(
  pipeline_id: string,
  etapa: { id: string; nome: string },
  proxima: { id: string; nome: string } | null,
  entraram: number,
  passaram: number,
) {
  return {
    pipeline_id,
    funil: "x",
    etapa: { ...etapa, posicao: 0 },
    proxima: proxima ? { ...proxima, posicao: 1 } : null,
    entraram,
    passaram,
    taxa: entraram ? passaram / entraram : null,
    amostra: entraram,
    saidas_sem_entrada_na_janela: 0,
    desvios: 0,
  };
}

function renderizar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AnaliseDoFunil pipelineId="p-1" stages={ETAPAS} leads={NEGOCIOS} settings={{}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  get.mockReset();
  get.mockResolvedValue({
    data: {
      conversao: {
        etapas: [
          linhaDe("p-1", { id: "e-1", nome: "Contato" }, { id: "e-2", nome: "Proposta" }, 10, 4),
          // Mesma etapa-id em OUTRO funil não pode vazar para esta tela.
          linhaDe("p-outro", { id: "e-2", nome: "Proposta" }, null, 99, 99),
        ],
        amostra: 10,
        notas: [],
      },
    },
  });
});
afterEach(() => vi.useRealTimers());

const celulas = (tr: HTMLElement) =>
  Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());

describe("visão Análise do funil", () => {
  it("conversão deste funil, na janela de 90 dias", async () => {
    renderizar();
    await screen.findByText("40%");
    const url = String(get.mock.calls[0]?.[0]);
    expect(url.startsWith("/api/v1/metrics/funil?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    const dias = (Date.parse(qs.get("to")!) - Date.parse(qs.get("from")!)) / 86_400_000;
    expect(dias).toBe(90);

    const contato = celulas(screen.getByTestId("analise-etapa-e-1"));
    expect(contato[0]).toContain("Contato");
    expect(contato.slice(1, 4)).toEqual(["10", "4", "40%"]);

    // A linha do outro funil (99/99) não aparece na Proposta deste.
    const proposta = celulas(screen.getByTestId("analise-etapa-e-2"));
    expect(proposta[1]).toBe("—");
  });

  it("tempo médio na etapa, de quem está nela agora", async () => {
    renderizar();
    await screen.findByText("40%");
    // Contato: 10 h e 30 h → média 20 h, 2 negócios. Proposta: 96 h → 4 d.
    expect(celulas(screen.getByTestId("analise-etapa-e-1")).slice(4)).toEqual(["2", "20 h"]);
    expect(celulas(screen.getByTestId("analise-etapa-e-2")).slice(4)).toEqual(["1", "4 d"]);
    // Etapa de desfecho não tem "agora na etapa" de espera.
    expect(celulas(screen.getByTestId("analise-etapa-e-3")).slice(4)).toEqual(["—", "—"]);
  });

  it("motivos de perda do funil, o mais frequente primeiro", async () => {
    renderizar();
    const lista = await screen.findByTestId("analise-motivos");
    const itens = within(lista)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(itens).toEqual(["Preço alto2", "Sem motivo registrado1"]);
  });

  it("duração curta: horas até dois dias, depois dias", () => {
    expect(duracaoCurta(null)).toBe("—");
    expect(duracaoCurta(5.4)).toBe("5 h");
    expect(duracaoCurta(47)).toBe("47 h");
    expect(duracaoCurta(72)).toBe("3 d");
  });
});
