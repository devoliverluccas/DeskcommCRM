/**
 * O PREÇO QUE VALE AGORA — o promocional quando há, o de venda quando não.
 *
 * Uma régua só para o agente (`crm_search_products`), para a tela e para o
 * orçamento: preço respondido ao cliente e preço do orçamento que divergem são
 * a mesma promessa dita de dois jeitos, e a loja cumpre a menor.
 *
 * O banco já recusa promoção que não é menor que o preço
 * (`catalog_products_promocional_valido`, migration 9481). A conferência aqui
 * de novo não é desconfiança do CHECK: é para a linha montada à mão (dublê de
 * teste, resposta de integração) não virar "promoção" de preço maior.
 */
export interface PrecoDoProduto {
  preco_cents: number;
  /** Nulo/ausente = sem promoção. */
  preco_promocional_cents?: number | null;
}

/** Há promoção válida neste produto? */
export function emPromocao(produto: PrecoDoProduto): boolean {
  const promo = produto.preco_promocional_cents;
  return typeof promo === "number" && Number.isFinite(promo) && promo >= 0 && promo < produto.preco_cents;
}

/** A constraint que recusa promoção que não é menor que o preço (migration 9481). */
export const CONSTRAINT_DA_PROMOCAO = "catalog_products_promocional_valido";

/**
 * O erro do PostgREST é a promoção recusada pelo banco? É o que transforma o
 * 23514 numa frase para quem digitou (rota) ou para a linha da planilha
 * (importação) — o PATCH só de preço não conhece a promoção guardada, e o
 * banco é quem confere.
 */
export function violouAPromocao(erro: { code?: string; message?: string } | null | undefined): boolean {
  return !!erro && erro.code === "23514" && (erro.message ?? "").includes(CONSTRAINT_DA_PROMOCAO);
}

/** O preço em centavos que vale agora: o promocional quando há, senão o de venda. */
export function precoVigente(produto: PrecoDoProduto): number {
  return emPromocao(produto) ? (produto.preco_promocional_cents as number) : produto.preco_cents;
}
