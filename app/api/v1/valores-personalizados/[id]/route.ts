import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH  /api/v1/valores-personalizados/[id] — troca chave, valor ou descrição.
 * DELETE /api/v1/valores-personalizados/[id] — apaga o valor.
 *
 * Fase 4, item 4.6. `manager`, escrita pelo service role com a organização do
 * contexto autenticado. Apagar (ou renomear a chave) faz `{{empresa.<chave>}}`
 * já escrito em mensagens voltar a sair literal — a tela avisa antes.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COLUNAS_DO_VALOR,
  editarValorSchema,
  type ValorPersonalizado,
} from "@/lib/variaveis/valores-personalizados";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "valores_personalizados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Valor não encontrado."), 404, { requestId });
  }

  const parsed = editarValorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const mudanca = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

  const { data, error } = await createAdminClient()
    .from("valores_personalizados")
    .update(mudanca)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS_DO_VALOR)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um valor com essa chave."), 409, { requestId });
    }
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
  // Zero linhas é indistinguível de sucesso no PostgREST: o `select` de volta
  // separa "gravou" de "não é desta organização".
  if (!data) return fail("not_found", t("Valor não encontrado."), 404, { requestId });
  const valor = data as ValorPersonalizado;

  await audit({
    action: "valor_personalizado.alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "valor_personalizado",
    resourceId: valor.id,
    requestId,
    metadata: { campos: Object.keys(mudanca), chave: valor.chave },
  });

  return ok(valor, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "valores_personalizados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Valor não encontrado."), 404, { requestId });
  }

  const { data, error } = await createAdminClient()
    .from("valores_personalizados")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id, chave")
    .maybeSingle();
  if (error) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  if (!data) return fail("not_found", t("Valor não encontrado."), 404, { requestId });
  const apagado = data as { id: string; chave: string };

  await audit({
    action: "valor_personalizado.removido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "valor_personalizado",
    resourceId: apagado.id,
    requestId,
    metadata: { chave: apagado.chave },
  });

  return ok({ id: apagado.id }, { requestId });
}
