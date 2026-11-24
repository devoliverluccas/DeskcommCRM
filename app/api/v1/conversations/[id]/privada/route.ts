import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Corpo = z.object({ privada: z.boolean() });

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/conversations/[id]/privada — torna a conversa privada ou pública
 * (item 3.7, migration 9485).
 *
 * Privada = só o responsável pela conversa e gestores+ a leem; quem corta é a
 * RLS (policy restritiva `conversations_privada_select`), então a lista, a
 * contagem, as mensagens e as notas seguem a regra sem filtro aqui.
 *
 * Quem pode marcar ou desmarcar: o RESPONSÁVEL (`assigned_to_user_id`) ou
 * `manager`+. A leitura é pelo client da SESSÃO: conversa que a pessoa não vê é
 * 404, e não 403 — a resposta não confirma que ela existe. A escrita é pelo
 * service role, com o recorte de organização manual, depois do gate.
 *
 * Gesto que não muda nada (já está no estado pedido) responde 200 sem
 * auditoria.
 */
export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }
  const corpo = Corpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  const { privada } = corpo.data;

  const supabase = await createClient();
  const { data: conv, error: erroDaLeitura } = await supabase
    .from("conversations")
    .select("id, assigned_to_user_id, privada")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (erroDaLeitura) return fail("internal_error", erroDaLeitura.message, 500, { requestId });
  if (!conv) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const linha = conv as { id: string; assigned_to_user_id: string | null; privada: boolean | null };

  if (linha.assigned_to_user_id !== user.id && !roleAtLeast(org.role, "manager")) {
    return fail(
      "forbidden",
      t("Só o responsável pela conversa ou um gestor pode mudar a privacidade dela."),
      403,
      { requestId },
    );
  }
  if ((linha.privada === true) === privada) {
    return ok({ id, privada }, { requestId });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("conversations")
    .update({ privada, privada_por: privada ? user.id : null })
    .eq("organization_id", org.orgId)
    .eq("id", id)
    .select("id, privada")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  await audit({
    action: "conversation.privada_alterada",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { privada },
  });

  return ok(data, { requestId });
}
