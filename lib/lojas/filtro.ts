/**
 * O filtro "Loja" da URL (`?loja=<uuid>`), usado no relatório de Atendimentos.
 *
 * `null` = sem filtro (a organização inteira, como sempre foi). `"invalida"` =
 * veio alguma coisa que não é um id — recusa legível, nunca "ignora e mostra
 * tudo", porque um número da organização inteira com o rótulo de uma loja é
 * pior do que erro.
 */
import { z } from "zod";

export function lerLojaDoFiltro(parametros: URLSearchParams): string | null | "invalida" {
  const bruto = parametros.get("loja");
  if (bruto === null || bruto === "") return null;
  return z.uuid().safeParse(bruto).success ? bruto : "invalida";
}
