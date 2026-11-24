/**
 * FILTROS SALVOS NA BARRA DO FUNIL (fase 1, item 1.6).
 *
 * Salvar dá nome à combinação de chips; o seletor aplica (pela mesma porta do
 * deep-link) e apaga. Por funil: o salvo no funil A não aparece no B.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilterBar } from "./FilterBar";
import { CHAVE_DOS_FILTROS_SALVOS, salvarFiltro } from "@/lib/kanban/filtros-salvos";
import type { LeadFilters } from "@/lib/kanban/filters";

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useUser: () => ({ id: "u-1" }) }));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: [] }),
}));
vi.mock("@/hooks/kanban/useAssignableAgents", () => ({
  useAssignableAgents: () => ({ data: [] }),
}));

const FUNIL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUNIL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function barra(filters: LeadFilters, pipelineId: string | null = FUNIL_A) {
  const onChange = vi.fn();
  render(
    <FilterBar
      filters={filters}
      onChange={onChange}
      leads={[]}
      pipelineId={pipelineId ?? undefined}
    />,
  );
  return onChange;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("filtros salvos na barra do funil", () => {
  it("sem filtro ativo e sem salvo, o seletor nem aparece", () => {
    barra({ status: "all" });
    expect(screen.queryByTestId("filtros-salvos")).toBeNull();
  });

  it("sem funil, não oferece salvar", () => {
    barra({ status: "open" }, null);
    expect(screen.queryByTestId("filtros-salvos")).toBeNull();
  });

  it("salva o filtro ativo com o nome dado, neste funil", async () => {
    const user = userEvent.setup();
    barra({ status: "open", overdueOnly: true });

    await user.click(screen.getByTestId("filtros-salvos"));
    await user.click(await screen.findByRole("menuitem", { name: "Salvar filtro" }));
    const dialogo = await screen.findByRole("dialog");
    await user.type(within(dialogo).getByLabelText("Nome do filtro"), "Atrasados abertos");
    await user.click(within(dialogo).getByRole("button", { name: "Salvar" }));

    const guardado = JSON.parse(window.localStorage.getItem(CHAVE_DOS_FILTROS_SALVOS) ?? "{}");
    expect(guardado[FUNIL_A]).toEqual([
      { nome: "Atrasados abertos", consulta: "status=open&overdue=1" },
    ]);
    // O seletor já conta o novo salvo, sem recarregar.
    expect(screen.getByTestId("filtros-salvos").textContent).toContain("1");
  });

  it("aplicar um salvo devolve o filtro pela porta do deep-link", async () => {
    salvarFiltro(window.localStorage, FUNIL_A, "Perdidos por preço", {
      status: "lost",
      lostReason: "price",
      search: "acme",
    });
    const user = userEvent.setup();
    const onChange = barra({ status: "all" });

    await user.click(screen.getByTestId("filtros-salvos"));
    await user.click(await screen.findByRole("menuitem", { name: "Perdidos por preço" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "lost", lostReason: "price", search: "acme" }),
    );
    // A busca do campo acompanha o filtro aplicado.
    expect((screen.getByPlaceholderText("Buscar por título…") as HTMLInputElement).value).toBe(
      "acme",
    );
  });

  it("apagar tira só aquele salvo", async () => {
    salvarFiltro(window.localStorage, FUNIL_A, "Um", { status: "open" });
    salvarFiltro(window.localStorage, FUNIL_A, "Dois", { status: "won" });
    const user = userEvent.setup();
    const onChange = barra({ status: "open" });

    await user.click(screen.getByTestId("filtros-salvos"));
    await user.click(await screen.findByRole("menuitem", { name: "Apagar: Um" }));

    expect(onChange).not.toHaveBeenCalled();
    const guardado = JSON.parse(window.localStorage.getItem(CHAVE_DOS_FILTROS_SALVOS) ?? "{}");
    expect(guardado[FUNIL_A].map((f: { nome: string }) => f.nome)).toEqual(["Dois"]);
    expect(screen.queryByRole("menuitem", { name: "Um" })).toBeNull();
  });

  it("o salvo de outro funil não aparece", () => {
    salvarFiltro(window.localStorage, FUNIL_B, "Do outro funil", { status: "open" });
    barra({ status: "all" });
    expect(screen.queryByTestId("filtros-salvos")).toBeNull();
  });
});
