import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * DELETE /api/v1/feriados/[id] — remove um feriado da organização (manager+).
 *
 * O id vem do caminho; a organização, da sessão. Os dois entram no filtro: id de
 * outra organização é 404, nunca uma remoção. Feriado não tem dado que outra
 * tabela referencie, então remover é apagar a linha.
 */
export async function DELETE(_req: NextRequest, ctx: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "feriados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Feriado não encontrado."), 404, { requestId });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("feriados")
    .delete()
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select("id, data, nome")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", t("Feriado não encontrado."), 404, { requestId });

  const removido = data as { id: string; data: string; nome: string };
  await audit({
    action: "feriado.removido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "feriado",
    resourceId: id,
    requestId,
    metadata: { data: removido.data, nome: removido.nome },
  });

  return ok({ id }, { requestId });
}
