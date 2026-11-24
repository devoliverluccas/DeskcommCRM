import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/pontuacao/regras — as regras de pontos da organização.
 * POST /api/v1/pontuacao/regras — cria uma regra.
 *
 * Fase 4, item 4.5. `manager` nos dois: é configuração da organização, ao lado
 * dos motivos de encerramento e das Tags, e a tela não mostra botão que voltaria
 * 403.
 *
 * A sessão só tem SELECT em `regras_de_pontuacao` (migration 9492): a escrita vai
 * pelo service role, com `organization_id` do contexto autenticado como filtro
 * explícito — nunca do corpo (o schema é `.strict()` e recusa a chave).
 *
 * A etapa de uma regra "etapa alcançada" é conferida contra a organização antes
 * de gravar: uma regra com etapa alheia nunca casaria e ficaria na tela como se
 * funcionasse.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  COLUNAS_DA_REGRA,
  criarRegraSchema,
  ordenarRegras,
  type RegraDePontuacao,
} from "@/lib/leads/pontuacao-por-regra";
import { etapaDaOrganizacao } from "@/lib/leads/pontuacao-por-regra-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. */
const ENDPOINT = "POST /api/v1/pontuacao/regras";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "regras_de_pontuacao" });
  if (!authz.ok) return authz.response;

  // Pela SESSÃO: a RLS isola a organização, e o filtro explícito diz qual.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("regras_de_pontuacao")
    .select(COLUNAS_DA_REGRA)
    .eq("organization_id", authz.org.orgId)
    .limit(200);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok({ regras: ordenarRegras((data ?? []) as unknown as RegraDePontuacao[]) }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "regras_de_pontuacao" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const parsed = criarRegraSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const admin = createAdminClient();
  const entrada = parsed.data;

  try {
    if (!(await etapaDaOrganizacao(admin, org.orgId, entrada.evento, entrada.condicao))) {
      return fail("validation_failed", t("Escolha a etapa que vale pontos."), 422, {
        requestId,
        details: { condicao: [t("Escolha a etapa que vale pontos.")] },
      });
    }
  } catch {
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }

  /** O efeito. Lança em falha, para a idempotência não gravar recibo de erro. */
  async function criar(): Promise<RegraDePontuacao> {
    const { data, error } = await admin
      .from("regras_de_pontuacao")
      .insert({
        organization_id: org.orgId,
        nome: entrada.nome,
        evento: entrada.evento,
        condicao: entrada.condicao as never,
        pontos: entrada.pontos,
        ativo: entrada.ativo,
        teto_por_contato: entrada.teto_por_contato,
        created_by: user.id,
      })
      .select(COLUNAS_DA_REGRA)
      .single();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const regra = data as unknown as RegraDePontuacao;

    await audit({
      action: "pontuacao.regra_criada",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "regra_de_pontuacao",
      resourceId: regra.id,
      requestId,
      metadata: { evento: regra.evento, pontos: regra.pontos, teto_por_contato: regra.teto_por_contato },
    });
    return regra;
  }

  if (chave === null) {
    try {
      return ok(await criar(), { requestId, status: 201 });
    } catch {
      return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
    }
  }

  try {
    const supabase = await createClient();
    const desfecho = await comIdempotencia({
      db: supabase,
      organizationId: org.orgId,
      endpoint: ENDPOINT,
      chave,
      corpo: entrada,
      executar: async () => ({ resposta: await criar(), status: 201 }),
    });
    if (desfecho.tipo === "conflito") {
      return fail("idempotency_conflict", t("Esta chave de idempotência já foi usada com outro conteúdo."), 409, { requestId });
    }
    if (desfecho.tipo === "em_curso") {
      return fail("idempotency_in_progress", t("A mesma requisição ainda está em curso. Tente de novo em instantes."), 409, { requestId });
    }
    return ok(desfecho.resposta, { requestId, status: 201 });
  } catch {
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
}
