// app/api/v1/proposals/[id]/link/route.ts
//
// POST — "COPIAR LINK" DA PROPOSTA ENVIADA (9480).
//
// O banco guarda só o hash do token, então o link que foi na mensagem não pode
// ser relido: copiar é GERAR um link novo para a mesma proposta, com a mesma
// validade. O de antes continua valendo — o cliente pode estar com ele aberto.
// Só proposta `enviada`: rascunho não tem o que o cliente decidir, e decidida,
// vencida ou substituída mostraria só o estado.
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { env } from "@/lib/env";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { criarLinkDaProposta, urlDoLink } from "@/lib/propostas/link-publico";
import { sePropostasDesligadas } from "@/lib/propostas/porta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  // O mesmo piso de quem DECIDE a proposta enviada (`/decide`): o atendente
  // que fala com o cliente é quem precisa reenviar o link.
  const authz = await requireRole("agent", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const { id } = params.data;

  const admin = createAdminClient();
  const { data: proposta } = await admin
    .from("crm_proposals")
    .select("id, status, valid_until")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!proposta) return fail("not_found", t("Proposta não encontrada."), 404, { requestId });
  const linha = proposta as { id: string; status: string; valid_until: string | null };
  if (linha.status !== "enviada") {
    return fail("proposal_context_stale", t("Só há link para o cliente numa proposta enviada."), 409, { requestId });
  }

  let link;
  try {
    link = await criarLinkDaProposta(admin, {
      orgId: authz.org.orgId,
      propostaId: linha.id,
      validUntil: linha.valid_until,
      criadoPor: authz.user.id,
    });
  } catch {
    return fail("internal_error", t("Não foi possível gerar o link agora."), 500, { requestId });
  }

  void audit({
    action: "proposal.link_gerado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_proposals",
    resourceId: linha.id,
    requestId,
    // O token NUNCA vai para a auditoria — só o id da linha do link.
    metadata: { link_id: link.id, expira_em: link.expiraEm },
  });

  return ok({ url: urlDoLink(env.NEXT_PUBLIC_APP_URL, link.token), expira_em: link.expiraEm }, { requestId, status: 201 });
}
