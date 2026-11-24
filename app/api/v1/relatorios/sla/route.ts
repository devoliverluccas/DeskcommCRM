/**
 * Relatório de SLA (fase 3, itens 3.3 + 3.6): quantos atendimentos do período
 * tiveram a PRIMEIRA RESPOSTA dentro da meta, no total e por setor.
 *
 * A conta é a de `lib/inbox/sla-relatorio.ts` — a mesma régua do selo da lista
 * (espera da Fila, tempo fora do expediente do setor não conta, atendimento
 * com SLA ignorado fica de fora). Aqui só se resolve o período no fuso da
 * organização e o nome de cada setor. Quem gerencia vê (`manager`), como as
 * outras abas de gestão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { resumoDoSlaDePrimeiraResposta } from "@/lib/inbox/sla-relatorio";
import { fusoDoRelatorio } from "@/lib/relatorios/janela";
import { temMetaDeSla, metasDoSla } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerPeriodo, MENSAGEM_DO_PERIODO } from "../_periodo";
import type { RelatorioDeSla } from "../_tipos";

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

  const metas = metasDoSla(linha?.settings);
  if (!temMetaDeSla(metas)) {
    const vazio: RelatorioDeSla = { com_meta: false, resumo: null, setores: {} };
    return ok({ janela: { de: janela.de, ate: janela.ate, tz: janela.tz }, ...vazio }, { requestId });
  }

  try {
    const [resumo, setores] = await Promise.all([
      resumoDoSlaDePrimeiraResposta(admin, {
        organizationId: orgId,
        de: new Date(janela.from),
        ate: new Date(janela.to),
      }),
      admin.from("attendant_sectors").select("id, name").eq("organization_id", orgId),
    ]);
    const nomes: Record<string, string> = {};
    for (const s of (setores.data ?? []) as Array<{ id: string; name: string | null }>) {
      if (s.name) nomes[s.id] = s.name;
    }
    const corpo: RelatorioDeSla = { com_meta: true, resumo, setores: nomes };
    return ok({ janela: { de: janela.de, ate: janela.ate, tz: janela.tz }, ...corpo }, { requestId });
  } catch (erro) {
    return fail(
      "internal_error",
      erro instanceof Error ? erro.message : t("Não foi possível carregar o relatório."),
      500,
      { requestId },
    );
  }
}
