import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/team/[user_id]/perfil-de-tela — atribui (ou tira) o perfil de
 * tela de um membro (item 5.6). Corpo: `{ perfil_de_tela_id: uuid | null }`.
 *
 * `admin`. Pela SESSÃO, como a interface do vínculo (`../interface/route.ts`):
 * a RLS `user_orgs_update` é a segunda trava, e a FK composta da migration 9497
 * recusa perfil de outra organização no banco (23503 → 422).
 *
 * Quem administra NÃO recebe perfil: esconderia de si a tela que desfaz o perfil
 * (ver `lib/navigation/perfis-de-tela.ts`). Tirar (`null`) é sempre permitido.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { invalidarUsuario } from "@/lib/auth/cache-curto";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { atribuirPerfilSchema } from "@/lib/navigation/perfis-de-tela";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ user_id: string }> }) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user_id } = await ctx.params;
  const parsed = atribuirPerfilSchema.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(user_id).success || !parsed.success) {
    return fail("validation_error", t("Dados inválidos."), 400, { requestId });
  }
  const perfilId = parsed.data.perfil_de_tela_id;

  const db = await createClient();
  const { data: membro, error: erroDeLeitura } = await db
    .from("user_organizations")
    .select("id, role")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (erroDeLeitura) return fail("internal_error", t("Não foi possível ler o membro."), 500, { requestId });
  if (!membro) return fail("not_found", t("Membro ativo não encontrado."), 404, { requestId });
  if (perfilId !== null && membro.role === "admin") {
    return fail(
      "validation_failed",
      t("Quem administra vê todas as áreas: perfil de tela vale para os outros papéis."),
      422,
      { requestId },
    );
  }

  invalidarUsuario(user_id);
  const { data, error } = await db
    .from("user_organizations")
    .update({ perfil_de_tela_id: perfilId })
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", user_id)
    .eq("role", membro.role)
    .is("revoked_at", null)
    .select("id, user_id, perfil_de_tela_id")
    .maybeSingle();
  if (error) {
    // FK composta: perfil inexistente ou de outra organização.
    if (error.code === "23503") return fail("validation_failed", t("Perfil não encontrado."), 422, { requestId });
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
  if (!data) return fail("conflict", t("O vínculo mudou. Atualize e tente novamente."), 409, { requestId });
  invalidarUsuario(user_id);

  void audit({
    action: "team.perfil_de_tela_changed",
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    resourceType: "membership",
    resourceId: data.id,
    requestId,
    metadata: { user_id, perfil_de_tela_id: perfilId },
  });
  return ok(data, { requestId });
}
