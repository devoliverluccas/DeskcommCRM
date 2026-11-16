import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PageHeader } from "./PageHeader";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

/**
 * PageHeader: a primária fica à vista em toda largura; as secundárias são botões
 * de `md` para cima e itens do "⋯" abaixo — com o MESMO nome nos dois lugares,
 * porque as specs procuram os botões pelo nome.
 */
describe("PageHeader", () => {
  it("título em h1, primária visível e secundárias como botões só de md para cima", () => {
    const importar = vi.fn();
    render(
      <PageHeader
        title="Contatos"
        subtitle="Busque e filtre."
        actions={<button type="button">Novo contato</button>}
        secondaryActions={[{ label: "Importar CSV", onSelect: importar, testId: "importar" }]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Contatos");
    expect(screen.getByText("Busque e filtre.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo contato" }).className).not.toContain("hidden");

    const secundario = screen.getByTestId("importar");
    expect(secundario).toHaveAccessibleName("Importar CSV");
    expect(secundario.className).toContain("max-md:hidden");

    const mais = screen.getByRole("button", { name: "Mais ações" });
    expect(mais.className).toContain("md:hidden");
    // 44px no toque: o `icon` do primitivo é `h-11 w-11` abaixo de `lg`.
    expect(mais.className).toContain("h-11");
  });

  it("o item do ⋯ tem o mesmo nome e dispara a mesma ação; grupo vira itens soltos", async () => {
    const importar = vi.fn();
    const csv = vi.fn();
    render(
      <PageHeader
        title="Contatos"
        secondaryActions={[
          { label: "Importar CSV", onSelect: importar },
          { label: "Exportar", items: [{ label: "Exportar CSV", onSelect: csv }, { label: "Exportar vCard", onSelect: vi.fn() }] },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Importar CSV" }));
    expect(importar).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Mais ações" }));
    const menu2 = await screen.findByRole("menu");
    expect(within(menu2).getByRole("menuitem", { name: "Exportar vCard" })).toBeInTheDocument();
    await userEvent.click(within(menu2).getByRole("menuitem", { name: "Exportar CSV" }));
    expect(csv).toHaveBeenCalledTimes(1);
  });

  it("sem secundárias não há ⋯; a fila de ações não tem shrink-0", () => {
    const { container } = render(
      <PageHeader title="Ficha" actions={<button type="button">Editar</button>} />,
    );
    expect(screen.queryByRole("button", { name: "Mais ações" })).toBeNull();
    const header = container.querySelector("header")!;
    expect(header.querySelector(".shrink-0")).toBeNull();
    expect(header.firstElementChild!.className).toContain("min-w-0");
  });
});
