/**
 * GET /api/v1/lojas/propostas — a loja registrada de cada orçamento da
 * organização (`proposta_da_loja`), para o filtro "Loja" da lista de Propostas.
 *
 * `agent`, o piso da lista. Leitura pela SESSÃO: a RLS das propostas decide o
 * que esta pessoa enxerga, e a do módulo isola a organização — o filtro
 * explícito diz qual. Leitura ⇒ sem auditoria.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const portao = await portaoDasLojas("agent", requestId);
  if (!portao.ok) return portao.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("proposta_da_loja")
    .select("proposal_id, loja_id")
    .eq("organization_id", portao.orgId)
    .limit(5000);
  if (error) return fail("internal_error", portao.t("Não consegui carregar as lojas."), 500, { requestId });
  return ok((data ?? []) as Array<{ proposal_id: string; loja_id: string }>, { requestId });
}
