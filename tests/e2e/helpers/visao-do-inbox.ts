/**
 * O topo minimalista do Inbox (Não lidas | Abertas | Importantes): as outras
 * visões (Fila, Minhas, Todas, Fechadas, Arquivadas, Automático, Pessoal), as
 * etiquetas e o atendente moram no modal "Filtros". Os specs que antes clicavam
 * numa aba da faixa passam por aqui — um lugar só sabe como se chega a uma visão.
 */
import { expect, type Page } from "@playwright/test";

/** Abre o modal de Filtros e devolve o diálogo. */
export async function abrirFiltrosDoInbox(page: Page) {
  await page.getByTestId("botao-filtros").click();
  const dialogo = page.getByRole("dialog", { name: "Filtros" });
  await expect(dialogo).toBeVisible();
  return dialogo;
}

/** Fecha o modal de Filtros pelo "Pronto". */
export async function fecharFiltrosDoInbox(page: Page) {
  await page.getByRole("dialog", { name: "Filtros" }).getByRole("button", { name: "Pronto" }).click();
}

/** Escolhe uma visão no modal (ex.: /Minhas/, /^Todas/, /^Fila/) e fecha o modal. */
export async function escolherVisaoDoInbox(page: Page, nome: RegExp | string) {
  const dialogo = await abrirFiltrosDoInbox(page);
  await dialogo.getByRole("radio", { name: nome }).click();
  await fecharFiltrosDoInbox(page);
}

/** O selo da visão escolhida no modal, ao lado das três abas do topo. */
export function seloDaVisaoDoInbox(page: Page) {
  return page.getByTestId("visao-do-filtro");
}
