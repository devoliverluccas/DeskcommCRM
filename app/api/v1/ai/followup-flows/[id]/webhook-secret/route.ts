/**
 * GET /api/v1/ai/followup-flows/:id/webhook-secret — o segredo com que o nó
 * "Webhook" deste fluxo assina cada envio (HMAC SHA-256, 4.3).
 *
 * O segredo NÃO mora no grafo (que é exportável e legível por quem só vê): ele é
 * derivado da instalação + organização + fluxo (`segredoDoWebhookDoFluxo`). Por
 * isso esta rota só LÊ, e é de `manager` — o mesmo papel que edita o fluxo e,
 * portanto, monta o webhook. Leitura não audita (como `GET /:id`).
 *
 * O `organization_id` vem da sessão; o fluxo é conferido nela antes de derivar
 * qualquer coisa — o id de outra organização responde 404, não um segredo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { segredoDoWebhookDoFluxo } from "@/lib/followup/webhook-do-fluxo";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("manager", { requestId, resource: "followup_flows" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const supabase = await createClient();
  const { data: fluxo, error } = await supabase
    .from("followup_flow_pointers")
    .select("id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!fluxo) return fail("not_found", t("Fluxo não encontrado."), 404, { requestId });

  let segredo: string;
  try {
    segredo = segredoDoWebhookDoFluxo(orgId, id);
  } catch {
    return fail(
      "internal_error",
      t("A instalação não tem a chave interna configurada; o webhook do fluxo não pode ser assinado."),
      500,
      { requestId },
    );
  }
  return ok({ segredo }, { requestId });
}
