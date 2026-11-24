// lib/propostas/total.ts
import type { ProposalItemInput } from "./tipos";

/** O desconto e o frete DA PROPOSTA — colunas de `crm_proposals` (migration 9480). */
export interface AjustesDaProposta {
  desconto_cents?: number | null;
  frete_cents?: number | null;
}

/** Soma dos itens com preço, cada um já líquido do desconto dele. */
export function calcularSubtotal(itens: readonly ProposalItemInput[]): number {
  return itens.reduce((acc, it) => {
    if (it.preco_unitario_cents === null) return acc;
    const subtotal = Math.round(it.quantidade * it.preco_unitario_cents);
    const liquido = Math.max(0, subtotal - it.desconto_cents);
    return acc + liquido;
  }, 0);
}

/**
 * Total em centavos. Item sem preço (§5.2, "a definir") não entra na soma —
 * nem ele, nem o desconto dele. Cada item com preço trava em ZERO se o
 * desconto exceder o subtotal — nunca deixa um item negativo puxar o total
 * pra baixo do que os outros itens somam sozinhos.
 *
 * Os ajustes da proposta (9480) entram DEPOIS dos itens, nesta ordem: o
 * desconto sai da soma dos itens e trava em zero (desconto maior que a compra
 * não vira crédito), e o frete soma por cima — frete é custo de entrega, e um
 * desconto grande não pode comer o frete que alguém vai pagar ao transportador.
 */
export function calcularTotal(itens: readonly ProposalItemInput[], ajustes: AjustesDaProposta = {}): number {
  const desconto = Math.max(0, Math.round(ajustes.desconto_cents ?? 0));
  const frete = Math.max(0, Math.round(ajustes.frete_cents ?? 0));
  return Math.max(0, calcularSubtotal(itens) - desconto) + frete;
}
