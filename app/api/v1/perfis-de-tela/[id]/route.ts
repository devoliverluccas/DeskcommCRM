import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH  /api/v1/perfis-de-tela/[id] — troca o nome ou as portas do perfil.
 * DELETE /api/v1/perfis-de-tela/[id] — apaga o perfil.
 *
 * Item 5.6, `admin`. Apagar devolve os membros do perfil a "tudo que o papel
 * permite" (`on delete set null` da FK, migration 9497). Nos dois casos o
 * snapshot de permissões de quem usa o perfil é derrubado (`invalidarUsuario`):
 * o menu é montado a partir dele e ficaria velho por até 30 s.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { invalidarUsuario } from "@/lib/auth/cache-curto";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DO_PERFIL, editarPerfilSchema, type PerfilDeTela } from "@/lib/navigation/perfis-de-tela";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Quem usa o perfil agora — para derrubar o cache de cada um. */
async function membrosDoPerfil(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  perfilId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("perfil_de_tela_id", perfilId);
  return ((data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", t("Perfil não encontrado."), 404, { requestId });

  const parsed = editarPerfilSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const mudanca = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("perfis_de_tela")
    .update(mudanca)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS_DO_PERFIL)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return fail("conflict", t("Já existe um perfil com esse nome."), 409, { requestId });
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
  if (!data) return fail("not_found", t("Perfil não encontrado."), 404, { requestId });
  const perfil = data as PerfilDeTela;

  const membros = await membrosDoPerfil(admin, authz.org.orgId, id);
  if (membros.length > 0) invalidarUsuario(...membros);

  await audit({
    action: "perfil_de_tela.alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "perfil_de_tela",
    resourceId: perfil.id,
    requestId,
    metadata: { campos: Object.keys(mudanca), nome: perfil.nome, destinos: perfil.destinos.length },
  });
  return ok(perfil, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", t("Perfil não encontrado."), 404, { requestId });

  const admin = createAdminClient();
  // ANTES do delete: depois dele a FK já limpou o ponteiro e não há como saber quem usava.
  const membros = await membrosDoPerfil(admin, authz.org.orgId, id);

  const { data, error } = await admin
    .from("perfis_de_tela")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id, nome")
    .maybeSingle();
  if (error) return fail("internal_error", t("Não consegui apagar agora."), 500, { requestId });
  if (!data) return fail("not_found", t("Perfil não encontrado."), 404, { requestId });

  if (membros.length > 0) invalidarUsuario(...membros);
  await audit({
    action: "perfil_de_tela.removido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "perfil_de_tela",
    resourceId: id,
    requestId,
    metadata: { nome: (data as { nome: string }).nome, membros: membros.length },
  });
  return ok({ id, removido: true, membros_sem_perfil: membros.length }, { requestId });
}
