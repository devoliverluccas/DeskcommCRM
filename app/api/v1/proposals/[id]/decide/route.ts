import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { registrarDecisao } from "@/lib/propostas/decisao";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { sePropostasDesligadas } from "@/lib/propostas/porta";

export const dynamic = "force-dynamic";
const bodySchema = z.object({
  decisao: z.enum(["aceita", "recusada"]),
  motivo: z.string().max(1000).optional(),
});
type Ctx = { params: Promise<{ id: string }> };

/**
 * A decisão DA EQUIPE ("Marcar como aceita/recusada"). O efeito no negócio —
 * atividade, retorno cancelado, auditoria — mora em `registrarDecisao`
 * (`lib/propostas/decisao.ts`), o MESMO caminho que a decisão do cliente pelo
 * link público usa (9480). Aqui fica só o que é da porta da equipe: papel,
 * suporte, a sessão (RLS + guarda de transição) e o formato da resposta.
 */
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const supabase = await createClient();
  const resultado = await registrarDecisao(supabase, {
    orgId: authz.org.orgId,
    propostaId: id,
    decisao: parsed.data.decisao,
    motivo: parsed.data.motivo ?? null,
    quem: { via: "equipe", userId: authz.user.id },
    requestId,
  });
  if (!resultado.ok) {
    if (resultado.motivo === "erro") return fail("internal_error", t("Falha ao registrar a decisão."), 500, { requestId });
    return fail("proposal_context_stale", t("Só é possível decidir sobre uma proposta enviada."), 409, { requestId });
  }

  return ok({ id, status: parsed.data.decisao }, { requestId });
}
