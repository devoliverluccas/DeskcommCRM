/**
 * VALORES PERSONALIZADOS DA EMPRESA — o contrato (fase 4, item 4.6, migration 9491).
 *
 * O PIX, o endereço, o horário de atendimento: o texto que a empresa repete em
 * toda mensagem e quer trocar num lugar só. Cada valor vira `{{empresa.<chave>}}`
 * em todas as fontes de variável (o catálogo declara `empresa.*`), e o envio
 * resolve o que a tela não resolveu.
 *
 * Puro: sem banco, sem React. A tela e a rota leem daqui a MESMA regra que o
 * CHECK da migration impõe — a tela não pode aceitar o que o banco recusa.
 */
import { z } from "zod";

/** Igual ao CHECK `valores_personalizados_chave_formato`. */
export const FORMATO_DA_CHAVE = /^[a-z][a-z0-9_]{1,39}$/;
export const TAMANHO_MAXIMO_DO_VALOR = 2000;
export const TAMANHO_MAXIMO_DA_DESCRICAO = 200;
/** Teto por organização: a lista é de textos da empresa, não um banco de dados. */
export const MAXIMO_DE_VALORES = 200;

export const COLUNAS_DO_VALOR = "id, chave, valor, descricao, created_at, updated_at";

export interface ValorPersonalizado {
  id: string;
  chave: string;
  valor: string;
  descricao: string | null;
  created_at: string;
  updated_at: string;
}

const chaveSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(FORMATO_DA_CHAVE, "Use de 2 a 40 letras minúsculas, números ou _, começando por letra.");

const valorSchema = z
  .string()
  .refine((v) => v.trim().length > 0, "Escreva o valor.")
  .refine((v) => v.length <= TAMANHO_MAXIMO_DO_VALOR, "O valor passa de 2000 caracteres.");

const descricaoSchema = z
  .string()
  .trim()
  .max(TAMANHO_MAXIMO_DA_DESCRICAO)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

/** Corpo do POST. `.strict()`: `organization_id` no corpo é recusado, nunca usado. */
export const criarValorSchema = z
  .object({ chave: chaveSchema, valor: valorSchema, descricao: descricaoSchema })
  .strict();

/** Corpo do PATCH. A chave pode mudar — mas quem já escreveu `{{empresa.antiga}}` perde o valor. */
export const editarValorSchema = z
  .object({ chave: chaveSchema.optional(), valor: valorSchema.optional(), descricao: descricaoSchema })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nada para alterar.");

/** Como a chave aparece numa mensagem. */
export function tokenDaChave(chave: string): string {
  return `{{empresa.${chave}}}`;
}

/** A lista vira o mapa que o resolvedor lê (`contexto.empresa`). */
export function mapaDosValores(lista: ReadonlyArray<Pick<ValorPersonalizado, "chave" | "valor">>): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const v of lista) mapa[v.chave] = v.valor;
  return mapa;
}

/** Ordem da tela: alfabética pela chave. */
export function ordenarValores<T extends Pick<ValorPersonalizado, "chave">>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => a.chave.localeCompare(b.chave));
}
