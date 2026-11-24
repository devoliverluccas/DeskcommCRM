/**
 * A LEITURA dos valores personalizados de uma organização (migration 9491).
 *
 * Servidor: quem chama passa o cliente — a sessão (RLS isola) ou o service
 * role (o envio) — e a organização vem SEMPRE de fonte confiável (sessão,
 * contexto do envio), nunca do corpo. O filtro de organização é explícito nos
 * dois casos: com service role, ele é a única proteção.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MAXIMO_DE_VALORES, mapaDosValores } from "./valores-personalizados";

/** O mapa `chave → valor` da organização. Lança em erro de leitura: quem chama decide. */
export async function lerValoresDaEmpresa(
  db: SupabaseClient,
  organizationId: string,
): Promise<Record<string, string>> {
  const { data, error } = await db
    .from("valores_personalizados")
    .select("chave, valor")
    .eq("organization_id", organizationId)
    .limit(MAXIMO_DE_VALORES);
  if (error) throw new Error(error.message);
  return mapaDosValores((data ?? []) as Array<{ chave: string; valor: string }>);
}
