import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ATALHOS_DO_INBOX } from "./atalhos-da-conversa";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";

/**
 * A AJUDA (`?`) É DESENHADA DA LISTA QUE REGISTRA AS TECLAS.
 *
 * Ela era um array estático próprio: o hook podia ganhar (ou trocar) uma tecla e
 * a ajuda seguir ensinando a lista antiga. Este caso reprova a ajuda que esquece
 * uma entrada ou mostra uma tecla diferente da registrada.
 */
describe("ShortcutsHelpDialog", () => {
  it("lista toda entrada de ATALHOS_DO_INBOX, com a mesma tecla, incluindo as ações da conversa", () => {
    render(<ShortcutsHelpDialog open onOpenChange={() => {}} />);
    const lista = screen.getByTestId("lista-de-atalhos");
    const linhas = within(lista).getAllByRole("listitem");
    expect(linhas).toHaveLength(ATALHOS_DO_INBOX.length);

    ATALHOS_DO_INBOX.forEach((atalho, i) => {
      const linha = linhas[i]!;
      expect(within(linha).getByText(atalho.descricao)).toBeTruthy();
      expect(linha.querySelector("kbd")?.textContent).toBe(atalho.exibicao);
    });

    for (const acao of [
      "Transferir",
      "Mover para fila",
      "Pausar ou devolver o automático",
      "Lembrar",
      "Criar tarefa",
      "Ver contato",
    ]) {
      expect(within(lista).getByText(acao), acao).toBeTruthy();
    }
  });
});
