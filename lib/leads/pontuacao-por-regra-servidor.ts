/**
 * As conferências da pontuação por regra que precisam do banco (fase 4, 4.5).
 * Separadas de `pontuacao-por-regra.ts`, que é puro e roda no navegador.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

import { lerCondicao, type RegraDePontuacao } from "./pontuacao-por-regra";

/**
 * A etapa citada na condição existe NESTA organização? Só a regra de etapa tem
 * alvo que mora noutra tabela; a de tag compara texto.
 */
export async function etapaDaOrganizacao(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  evento: RegraDePontuacao["evento"],
  condicao: unknown,
): Promise<boolean> {
  if (evento !== "etapa_alcancada") return true;
  const c = lerCondicao("etapa_alcancada", condicao);
  if (!c?.stage_id) return false;
  const { data, error } = await admin
    .from("crm_stages")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", c.stage_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}
