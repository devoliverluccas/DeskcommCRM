/**
 * O CONTRATO DAS LOJAS (item 5.4) — o formato que as rotas aceitam e devolvem.
 *
 * Os limites são os mesmos dos CHECKs de `fn_lojas_provisionar` (migration
 * 9495): a rota recusa com 422 legível antes de o banco recusar com 23514.
 */
import { z } from "zod";

export const COLUNAS_DA_LOJA = "id, nome, codigo, endereco, telefone, ativa, padrao, created_at, updated_at";

export interface Loja {
  id: string;
  nome: string;
  codigo: string | null;
  endereco: string | null;
  telefone: string | null;
  ativa: boolean;
  padrao: boolean;
  created_at: string;
  updated_at: string;
}

/** Texto opcional: vazio vira `null` (apagar o campo), espaços nas pontas saem. */
const opcional = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => (v.trim() === "" ? null : v.trim()))
    .nullable()
    .optional();

export const criarLojaSchema = z
  .object({
    nome: z.string().trim().min(1).max(120),
    codigo: opcional(40),
    endereco: opcional(300),
    telefone: opcional(40),
    padrao: z.boolean().optional(),
  })
  .strict();
export type CriarLoja = z.infer<typeof criarLojaSchema>;

export const editarLojaSchema = z
  .object({
    nome: z.string().trim().min(1).max(120).optional(),
    codigo: opcional(40),
    endereco: opcional(300),
    telefone: opcional(40),
    ativa: z.boolean().optional(),
    padrao: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });
export type EditarLoja = z.infer<typeof editarLojaSchema>;

export const configurarLojasSchema = z.object({ enabled: z.boolean() }).strict();

export const estoqueSchema = z
  .object({
    loja_id: z.uuid(),
    product_id: z.uuid(),
    quantidade: z.number().int().min(0).max(1_000_000_000),
  })
  .strict();

/** `loja_id: null` tira o vínculo — o número volta a usar a loja padrão. */
export const lojaDoNumeroSchema = z
  .object({ channel_session_id: z.uuid(), loja_id: z.uuid().nullable() })
  .strict();

/** `loja_id: null` tira o vínculo da proposta. */
export const lojaDaPropostaSchema = z.object({ loja_id: z.uuid().nullable() }).strict();

/** Ordem da tela: a padrão primeiro, depois as ativas, por nome. */
export function ordenarLojas<L extends Pick<Loja, "nome" | "ativa" | "padrao">>(lojas: readonly L[]): L[] {
  return [...lojas].sort(
    (a, b) =>
      Number(b.padrao) - Number(a.padrao) ||
      Number(b.ativa) - Number(a.ativa) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );
}
