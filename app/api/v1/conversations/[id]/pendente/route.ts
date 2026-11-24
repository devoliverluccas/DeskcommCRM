import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Corpo = z.object({ pendente: z.boolean() });

const ENCERRADA = new Set(["closed", "resolved", "archived"]);

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/conversations/[id]/pendente — marca ou tira a conversa de
 * pendente (item 3.7, `conversations.pendente_em`, migration 9485).
 *
 * "Pendente" é a marca da equipe — "tenho algo a resolver aqui" —, e o filtro
 * "Pendentes" do Inbox lista as marcadas. Qualquer `agent`+ que VÊ a conversa
 * marca (a leitura é pelo client da sessão: fora do escopo dele é 404). A marca
 * pertence ao atendimento: encerrar a limpa (gatilho da 9485), e por isso marcar
 * uma conversa encerrada é 409. Tirar a marca vale em qualquer estado.
 *
 * Gesto que não muda nada responde 200 sem auditoria.
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
  const { pendente } = corpo.data;

  const supabase = await createClient();
  const { data: conv, error: erroDaLeitura } = await supabase
    .from("conversations")
    .select("id, status, pendente_em")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (erroDaLeitura) return fail("internal_error", erroDaLeitura.message, 500, { requestId });
  if (!conv) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  const linha = conv as { id: string; status: string; pendente_em: string | null };

  if ((linha.pendente_em !== null) === pendente) {
    return ok({ id, pendente_em: linha.pendente_em }, { requestId });
  }
  if (pendente && ENCERRADA.has(linha.status)) {
    return fail(
      "state_conflict",
      t("Esta conversa está encerrada. Reabra para marcar como pendente."),
      409,
      { requestId },
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("conversations")
    .update({ pendente_em: pendente ? new Date().toISOString() : null })
    .eq("organization_id", org.orgId)
    .eq("id", id)
    .select("id, pendente_em")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  await audit({
    action: "conversation.pendente_alterada",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { pendente },
  });

  return ok(data, { requestId });
}
