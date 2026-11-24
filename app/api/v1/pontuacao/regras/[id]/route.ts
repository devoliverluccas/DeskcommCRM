import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/pontuacao/regras/[id] — renomeia, troca a condição, os pontos
 * ou o teto, desativa ou reativa uma regra (fase 4, item 4.5).
 *
 * O EVENTO não muda (`editarRegraSchema` recusa a chave): o extrato já gravado
 * diz de que fato veio cada ponto, e a mesma regra passar a ouvir outro fato
 * faria as linhas antigas mentirem. A condição nova é conferida contra o evento
 * GRAVADO.
 *
 * Não há DELETE: "Desativar" para de pontuar e preserva o extrato que explica o
 * total de cada contato. `manager`, escrita pelo service role com a organização
 * do contexto autenticado.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  COLUNAS_DA_REGRA,
  MENSAGEM_DA_CONDICAO,
  editarRegraSchema,
  lerCondicao,
  type RegraDePontuacao,
} from "@/lib/leads/pontuacao-por-regra";
import { etapaDaOrganizacao } from "@/lib/leads/pontuacao-por-regra-servidor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "regras_de_pontuacao" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Regra não encontrada."), 404, { requestId });
  }

  const parsed = editarRegraSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const patch = parsed.data;

  const admin = createAdminClient();
  const { data: atual, error: erroDaLeitura } = await admin
    .from("regras_de_pontuacao")
    .select("evento")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (erroDaLeitura) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  if (!atual) return fail("not_found", t("Regra não encontrada."), 404, { requestId });
  const evento = (atual as { evento: RegraDePontuacao["evento"] }).evento;

  if (patch.condicao !== undefined) {
    const mensagem = t(MENSAGEM_DA_CONDICAO[evento] ?? "Este evento não tem condição.");
    let serve = lerCondicao(evento, patch.condicao) !== null;
    if (serve) {
      try {
        serve = await etapaDaOrganizacao(admin, authz.org.orgId, evento, patch.condicao);
      } catch {
        return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
      }
    }
    if (!serve) {
      return fail("validation_failed", mensagem, 422, { requestId, details: { condicao: [mensagem] } });
    }
  }

  const { data, error } = await admin
    .from("regras_de_pontuacao")
    .update({ ...patch, condicao: patch.condicao as never, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS_DA_REGRA)
    .maybeSingle();
  if (error) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  // Zero linhas é indistinguível de sucesso no PostgREST: o `select` de volta
  // separa "gravou" de "não é desta organização".
  if (!data) return fail("not_found", t("Regra não encontrada."), 404, { requestId });
  const regra = data as unknown as RegraDePontuacao;

  await audit({
    action: "pontuacao.regra_alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "regra_de_pontuacao",
    resourceId: regra.id,
    requestId,
    metadata: { campos: Object.keys(patch), evento: regra.evento, pontos: regra.pontos, ativo: regra.ativo },
  });

  return ok(regra, { requestId });
}
