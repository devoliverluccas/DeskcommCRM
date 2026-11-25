import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH  /api/v1/lojas/[id] — edita, desativa, reativa ou marca como padrão.
 * DELETE /api/v1/lojas/[id] — exclui a loja que nunca orçou.
 *
 * `admin`, escrita pelo service role com a organização do contexto autenticado.
 * Marcar como padrão vai por `fn_lojas_definir_padrao` (a antiga sai e a nova
 * entra juntas); desativar a padrão é recusado — o banco também recusa
 * (`lojas_padrao_ativa_check`). Excluir uma loja com orçamento registrado
 * responde 409: o vínculo do orçamento é RESTRICT, e o caminho é desativar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { COLUNAS_DA_LOJA, editarLojaSchema, type Loja } from "@/lib/lojas/schemas";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("admin", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", t("Loja não encontrada."), 404, { requestId });

  const parsed = editarLojaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { padrao, ...campos } = parsed.data;

  const { data: atual } = await admin
    .from("lojas")
    .select(COLUNAS_DA_LOJA)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!atual) return fail("not_found", t("Loja não encontrada."), 404, { requestId });
  const antes = atual as Loja;

  if ((campos.ativa === false || padrao === false) && antes.padrao) {
    return fail("validation_failed", t("Escolha outra loja como padrão antes de desativar esta."), 422, { requestId });
  }

  let loja = antes;
  if (Object.keys(campos).length > 0) {
    const { data, error } = await admin
      .from("lojas")
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", id)
      .select(COLUNAS_DA_LOJA)
      .maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return fail("conflict", t("Já existe uma loja com esse nome ou código."), 409, { requestId });
      }
      return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
    }
    if (!data) return fail("not_found", t("Loja não encontrada."), 404, { requestId });
    loja = data as Loja;
  }

  if (padrao === true && !loja.padrao) {
    const { data: trocou, error } = await admin.rpc("fn_lojas_definir_padrao", { p_org: orgId, p_loja: id });
    if (error) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
    if (trocou !== true) {
      return fail("validation_failed", t("Só uma loja ativa pode ser a padrão."), 422, { requestId });
    }
    loja = { ...loja, padrao: true };
    await audit({
      action: "loja.padrao_definida",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "loja",
      resourceId: id,
      requestId,
      metadata: { nome: loja.nome },
    });
  }

  if (Object.keys(campos).length > 0) {
    await audit({
      action: "loja.alterada",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "loja",
      resourceId: id,
      requestId,
      metadata: { campos: Object.keys(campos), nome: loja.nome, ativa: loja.ativa },
    });
  }

  return ok(loja, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("admin", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", t("Loja não encontrada."), 404, { requestId });

  const { data, error } = await admin
    .from("lojas")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", id)
    .select("id, nome, padrao")
    .maybeSingle();
  if (error) {
    // 23503: há orçamento registrado nesta loja (FK RESTRICT).
    if (error.code === "23503") {
      return fail("conflict", t("Esta loja tem orçamentos registrados. Desative-a em vez de excluir."), 409, { requestId });
    }
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
  if (!data) return fail("not_found", t("Loja não encontrada."), 404, { requestId });

  await audit({
    action: "loja.removida",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "loja",
    resourceId: id,
    requestId,
    metadata: { nome: (data as { nome: string }).nome, era_padrao: (data as { padrao: boolean }).padrao },
  });
  return ok({ id }, { requestId });
}
