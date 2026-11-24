import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/motivos-de-encerramento/[id] — renomeia, troca a categoria,
 * reordena, desativa ou reativa um motivo (fase 3, item 3.2).
 *
 * Não há DELETE: o motivo pode estar gravado em demandas antigas, e "Desativar"
 * tira da lista do Inbox sem apagar o porquê do que já foi encerrado. `manager`,
 * escrita pelo service role com a organização do contexto autenticado.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  COLUNAS_DO_MOTIVO,
  editarMotivoSchema,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "motivos_de_encerramento" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Motivo não encontrado."), 404, { requestId });
  }

  const parsed = editarMotivoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("motivos_de_encerramento")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS_DO_MOTIVO)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um motivo com esse nome."), 409, { requestId });
    }
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
  // Zero linhas é indistinguível de sucesso no PostgREST: o `select` de volta
  // separa "gravou" de "não é desta organização".
  if (!data) return fail("not_found", t("Motivo não encontrado."), 404, { requestId });
  const motivo = data as MotivoDeEncerramento;

  await audit({
    action: "motivo_de_encerramento.alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "motivo_de_encerramento",
    resourceId: motivo.id,
    requestId,
    metadata: { campos: Object.keys(parsed.data), nome: motivo.nome, ativo: motivo.ativo },
  });

  return ok(motivo, { requestId });
}
