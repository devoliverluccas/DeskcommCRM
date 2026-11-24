import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/sla — `{ ignorar: boolean }`.
 *
 * Tira esta conversa da conta do SLA (`ignorar: true`) ou a devolve (`false`).
 * É decisão de gestor (`manager`+): quem atende não tira a própria conversa
 * atrasada da conta. O banco cobra a mesma coisa pelo outro lado — pela sessão,
 * `sla_ignorado_em`/`sla_ignorado_por` são do servidor (gatilho
 * `trg_conversa_sla_ignorado`, migration 9483) — e por isso a escrita vai pelo
 * service role, com o `organization_id` da sessão no filtro.
 *
 * Reabrir a conversa zera o ignorado (o mesmo gatilho): é atendimento novo.
 *
 * Auditoria: `conversation.sla_ignored` / `conversation.sla_restored`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ ignorar: z.boolean() }).strict();

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }

  const bruto = await req.json().catch(() => null);
  const parsed = corpoSchema.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { ignorar } = parsed.data;

  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const { data, error } = await admin
    .from("conversations")
    .update(
      ignorar
        ? { sla_ignorado_em: agora, sla_ignorado_por: user.id }
        : { sla_ignorado_em: null, sla_ignorado_por: null },
    )
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select("id, sla_ignorado_em, sla_ignorado_por")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  void audit({
    action: ignorar ? "conversation.sla_ignored" : "conversation.sla_restored",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: data.id,
    requestId,
    metadata: { ignorar },
  });

  return ok(
    { sla_ignorado_em: data.sla_ignorado_em ?? null, sla_ignorado_por: data.sla_ignorado_por ?? null },
    { requestId },
  );
}
