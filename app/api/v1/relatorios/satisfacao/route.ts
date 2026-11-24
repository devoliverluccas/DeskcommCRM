/**
 * GET /api/v1/relatorios/satisfacao — a aba "Satisfação" de `/app/relatorios` (3.6).
 *
 * O resumo da pesquisa do encerramento no período (as duas réguas, CSAT e
 * NPS, separadas — `fn_satisfacao_resumo`), a régua configurada hoje e as
 * últimas respostas com o texto que o cliente mandou.
 *
 * Piso `manager`, o mesmo de `/api/v1/metrics/satisfacao`: nota de atendimento
 * é régua de gestão, e a policy da tabela diz o mesmo no banco. O client é de
 * serviço (as funções são só `service_role`), então a organização vem da
 * sessão e é filtrada à mão em toda leitura. A varredura de vencidos roda
 * antes, como na rota irmã: pedido de ontem não pode ficar "aguardando".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import {
  fecharPedidosVencidos,
  lerOpcaoDaSatisfacao,
  respostasRecentes,
  resumoDaSatisfacao,
} from "@/lib/atendimento/satisfacao";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { fusoDoRelatorio } from "@/lib/relatorios/janela";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerPeriodo, MENSAGEM_DO_PERIODO } from "../_periodo";
import type { RelatorioDeSatisfacao } from "../_tipos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const { data: organizacao, error: erroDaOrg } = await admin
    .from("organizations")
    .select("settings, timezone")
    .eq("id", orgId)
    .maybeSingle();
  if (erroDaOrg) return fail("internal_error", erroDaOrg.message, 500, { requestId });
  const linha = organizacao as { settings?: unknown; timezone?: string | null } | null;

  const periodo = lerPeriodo(new URL(req.url).searchParams, fusoDoRelatorio(linha?.timezone));
  if (!periodo.ok) return fail("validation_failed", t(MENSAGEM_DO_PERIODO[periodo.motivo]), 422, { requestId });
  const { janela } = periodo;

  try {
    await fecharPedidosVencidos(admin, orgId);
    const [resumo, recentes] = await Promise.all([
      resumoDaSatisfacao(admin, { organizationId: orgId, de: janela.from, ate: janela.to }),
      respostasRecentes(admin, { organizationId: orgId, de: janela.from, ate: janela.to, limite: 20 }),
    ]);
    const corpo: RelatorioDeSatisfacao = {
      escala: lerOpcaoDaSatisfacao(linha?.settings).escala,
      resumo,
      recentes,
    };
    return ok({ janela: { de: janela.de, ate: janela.ate, tz: janela.tz }, ...corpo }, { requestId });
  } catch (erro) {
    return fail(
      "internal_error",
      erro instanceof Error ? erro.message : t("Não foi possível calcular a satisfação."),
      500,
      { requestId },
    );
  }
}
