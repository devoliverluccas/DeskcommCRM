/**
 * PREVISÃO, ANÁLISE E O TOTAL DO FUNIL (fase 1, item 1.6).
 *
 * - As duas visões novas moram na URL como as outras (`?visao=previsao`,
 *   `?visao=analise`): link colado e F5 abrem nelas.
 * - Elas não recebem o filtro do quadro, e por isso a barra some nelas.
 * - Funil arquivado continua só com o quadro, nem pela URL.
 * - O cabeçalho soma o que o quadro mostra: negócios, total e ponderado, sobre a
 *   MESMA lista filtrada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PipelinePageClient } from "./_client";
import type { Pipeline, Stage } from "@/lib/kanban/types";

const estado = vi.hoisted(() => ({
  params: new URLSearchParams(),
  arquivado: false,
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: estado.replace, push: vi.fn() }),
  usePathname: () => "/app/pipelines/p-1",
  useSearchParams: () => estado.params,
}));

const ETAPAS = [
  { id: "e-1", name: "Proposta", position: 0, is_won: false, is_lost: false, win_probability: 50 },
  { id: "e-2", name: "Ganho", position: 1, is_won: true, is_lost: false, win_probability: null },
] as unknown as Stage[];

const NEGOCIOS = [
  {
    id: "l-1",
    title: "A",
    stage_id: "e-1",
    status: "open",
    value_cents: 100_000,
    currency: "BRL",
    tags: [],
  },
  {
    id: "l-2",
    title: "B",
    stage_id: "e-1",
    status: "open",
    value_cents: 50_000,
    currency: "BRL",
    tags: [],
  },
  {
    id: "l-3",
    title: "C",
    stage_id: "e-2",
    status: "won",
    value_cents: 20_000,
    currency: "BRL",
    tags: [],
  },
];

vi.mock("@/hooks/kanban/useBoard", () => ({
  useBoard: () => ({
    data: {
      pipeline: {
        id: "p-1",
        name: "Vendas",
        vocabulary: null,
        settings: {},
        is_archived: estado.arquivado,
      },
      stages: ETAPAS,
      leads: NEGOCIOS,
    },
    isLoading: false,
    error: null,
    pulses: new Map(),
    realtimeStatus: "SUBSCRIBED",
    seguranca: { divergencias: 0, ultimaVerificacao: null },
  }),
}));
vi.mock("@/hooks/kanban/useDensidadeDoQuadro", () => ({
  useDensidadeDoQuadro: () => ({ compacta: false, alternar: vi.fn() }),
}));
vi.mock("@/components/kanban/FilterBar", () => ({
  FilterBar: () => <div data-testid="barra-de-filtro" />,
}));
vi.mock("@/components/kanban/NewLeadDialog", () => ({ NewLeadDialog: () => null }));
vi.mock("@/components/kanban/KanbanBoard", () => ({
  KanbanBoard: ({ leads }: { leads: unknown[] }) => <div data-testid="quadro">{leads.length}</div>,
}));
vi.mock("@/components/kanban/CalendarioDoFunil", () => ({ CalendarioDoFunil: () => null }));
vi.mock("@/components/kanban/ListaDoFunil", () => ({ ListaDoFunil: () => null }));
vi.mock("@/components/kanban/BulkActionBar", () => ({ BulkActionBar: () => null }));
vi.mock("@/components/kanban/PrevisaoDoFunil", () => ({
  PrevisaoDoFunil: ({ leads }: { leads: unknown[] }) => (
    <div data-testid="previsao-stub">{leads.length}</div>
  ),
}));
vi.mock("@/components/kanban/AnaliseDoFunil", () => ({
  AnaliseDoFunil: ({ leads }: { leads: unknown[] }) => (
    <div data-testid="analise-stub">{leads.length}</div>
  ),
}));

const semNbsp = (s: string) => s.replace(/[  ]/g, " ");

function renderizar() {
  return render(
    <PipelinePageClient
      pipelineId="p-1"
      initialName="Vendas"
      role="admin"
      funis={[{ id: "p-1", name: "Vendas" }]}
      funilInicial={
        {
          id: "p-1",
          name: "Vendas",
          settings: {},
          is_archived: estado.arquivado,
        } as unknown as Pipeline
      }
      etapasIniciais={ETAPAS}
    />,
  );
}

beforeEach(() => {
  estado.params = new URLSearchParams();
  estado.arquivado = false;
  estado.replace.mockReset();
});

describe("visões Previsão e Análise", () => {
  it("as abas novas existem e trocar escreve ?visao= na URL", async () => {
    renderizar();
    expect(screen.getByTestId("visao-previsao").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("visao-analise").getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(screen.getByTestId("visao-previsao"));
    expect(estado.replace).toHaveBeenLastCalledWith("/app/pipelines/p-1?visao=previsao", {
      scroll: false,
    });
    expect(screen.getByTestId("visao-previsao").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("previsao-stub")).toBeTruthy();
    expect(screen.queryByTestId("quadro")).toBeNull();

    await userEvent.click(screen.getByTestId("visao-analise"));
    expect(estado.replace).toHaveBeenLastCalledWith("/app/pipelines/p-1?visao=analise", {
      scroll: false,
    });
    expect(screen.getByTestId("analise-stub")).toBeTruthy();
  });

  it("?visao=previsao abre direto na Previsão, sem a barra de filtro", () => {
    estado.params = new URLSearchParams("visao=previsao&status=open");
    renderizar();
    // Recebe o funil SEM o filtro: os três negócios, não só os dois abertos.
    expect(screen.getByTestId("previsao-stub").textContent).toBe("3");
    expect(screen.queryByTestId("barra-de-filtro")).toBeNull();
  });

  it("?visao=analise abre direto na Análise", () => {
    estado.params = new URLSearchParams("visao=analise");
    renderizar();
    expect(screen.getByTestId("analise-stub")).toBeTruthy();
    expect(screen.queryByTestId("barra-de-filtro")).toBeNull();
  });

  it("funil arquivado ignora ?visao=previsao e não mostra as abas", () => {
    estado.arquivado = true;
    estado.params = new URLSearchParams("visao=previsao");
    renderizar();
    expect(screen.getByTestId("quadro")).toBeTruthy();
    expect(screen.queryByTestId("previsao-stub")).toBeNull();
    expect(screen.queryByTestId("visao-previsao")).toBeNull();
    expect(screen.queryByTestId("visao-analise")).toBeNull();
  });
});

describe("total do funil no cabeçalho", () => {
  it("negócios, total e ponderado do que o quadro mostra", () => {
    renderizar();
    // 1.000 + 500 + 200 = 1.700; ponderado 50% de 1.500 + 100% de 200 = 950.
    expect(semNbsp(screen.getByTestId("total-do-funil").textContent ?? "")).toBe(
      "3 negócios · R$ 1.700,00 · ponderado R$ 950,00",
    );
  });

  it("acompanha o filtro ativo", () => {
    estado.params = new URLSearchParams("status=won");
    renderizar();
    expect(screen.getByTestId("quadro").textContent).toBe("1");
    expect(semNbsp(screen.getByTestId("total-do-funil").textContent ?? "")).toBe(
      "1 negócio · R$ 200,00 · ponderado R$ 200,00",
    );
  });

  it("some nas visões que têm os próprios números", () => {
    estado.params = new URLSearchParams("visao=analise");
    renderizar();
    expect(screen.queryByTestId("total-do-funil")).toBeNull();
  });
});
