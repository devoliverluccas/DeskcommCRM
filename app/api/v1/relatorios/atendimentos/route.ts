/**
 * GET /api/v1/relatorios/atendimentos — a aba "Atendimentos" de `/app/relatorios` (3.6).
 *
 * Abertos e encerrados por dia (no fuso da organização), 1ª resposta e
 * resolução (média e mediana), recortes por setor e por atendente, e o desfecho
 * das demandas fechadas no período. A conta é `fn_relatorio_atendimentos`
 * (migration 9484), SECURITY INVOKER chamada com o client da SESSÃO: a RLS de
 * `conversations`/`messages`/`demandas` decide o escopo — o agent vê o que já
 * vê no Inbox, o manager a organização. Piso de rota = agent (o mesmo de
 * Desempenho). Org da sessão, nunca da URL. Leitura ⇒ sem auditoria.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { fusoDoRelatorio } from "@/lib/relatorios/janela";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { lerPeriodo, MENSAGEM_DO_PERIODO } from "../_periodo";
import type { LinhaDeRecorte, RelatorioDeAtendimentos, TempoDoRelatorio } from "../_tipos";

export const dynamic = "force-dynamic";

/**
 * MOTIVOS DE ENCERRAMENTO no período (migration 9482): demandas FECHADAS na
 * janela `[from, to)` que têm motivo, contadas pelo nome do motivo. Mesmo
 * `supabase` da sessão: a RLS de `demandas` e de `motivos_de_encerramento`
 * decide o escopo, e o filtro de organização vai explícito. Teto de 5000
 * linhas — além disso a lista vira amostra, como os outros recortes daqui.
 * Erro de leitura = `null` (a aba esconde a lista em vez de mostrar zero).
 */
async function motivosDeEncerramento(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  janela: { from: string; to: string },
): Promise<RelatorioDeAtendimentos["motivos"]> {
  const { data, error } = await supabase
    .from("demandas")
    .select("motivo:motivos_de_encerramento(nome)")
    .eq("organization_id", orgId)
    .not("motivo_de_encerramento_id", "is", null)
    .gte("fechada_em", janela.from)
    .lt("fechada_em", janela.to)
    .limit(5000);
  if (error) return null;
  const contagem = new Map<string, number>();
  for (const linha of (data ?? []) as Array<{ motivo: { nome: string } | Array<{ nome: string }> | null }>) {
    const m = Array.isArray(linha.motivo) ? linha.motivo[0] : linha.motivo;
    if (!m?.nome) continue;
    contagem.set(m.nome, (contagem.get(m.nome) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .map(([motivo, quantidade]) => ({ motivo, quantidade }))
    .sort((x, y) => y.quantidade - x.quantidade || x.motivo.localeCompare(y.motivo));
}

const numero = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const talvez = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);

function tempo(bruto: unknown): TempoDoRelatorio {
  const b = (bruto ?? {}) as Record<string, unknown>;
  return { media: talvez(b.media), mediana: talvez(b.mediana), amostra: numero(b.amostra) };
}

function recorte(b: Record<string, unknown>): LinhaDeRecorte {
  return {
    abertos: numero(b.abertos),
    encerrados: numero(b.encerrados),
    primeira_resposta_media: talvez(b.primeira_resposta_media),
    resolucao_media: talvez(b.resolucao_media),
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const supabase = await createClient();
  const { data: organizacao } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();
  const fuso = fusoDoRelatorio((organizacao as { timezone?: string | null } | null)?.timezone);

  const periodo = lerPeriodo(new URL(req.url).searchParams, fuso);
  if (!periodo.ok) return fail("validation_failed", t(MENSAGEM_DO_PERIODO[periodo.motivo]), 422, { requestId });
  const { janela } = periodo;

  const { data, error } = await supabase.rpc("fn_relatorio_atendimentos", {
    p_org: orgId,
    p_de: janela.from,
    p_ate: janela.to,
    p_fuso: janela.tz,
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const bruto = (data ?? {}) as Record<string, unknown>;
  const porAtendente = ((bruto.por_atendente ?? []) as Array<Record<string, unknown>>).map((b) => ({
    user_id: (b.user_id as string | null) ?? null,
    nome: null as string | null,
    ...recorte(b),
  }));
  const nomes = await nomesDosAtendentes(
    orgId,
    porAtendente.map((a) => a.user_id),
  );
  for (const linha of porAtendente) linha.nome = linha.user_id ? (nomes.get(linha.user_id) ?? null) : null;

  const relatorio: RelatorioDeAtendimentos = {
    abertos: numero(bruto.abertos),
    encerrados: numero(bruto.encerrados),
    primeira_resposta: tempo(bruto.primeira_resposta),
    resolucao: tempo(bruto.resolucao),
    por_dia: ((bruto.por_dia ?? []) as Array<Record<string, unknown>>).map((b) => ({
      dia: String(b.dia),
      abertos: numero(b.abertos),
      encerrados: numero(b.encerrados),
    })),
    por_setor: ((bruto.por_setor ?? []) as Array<Record<string, unknown>>).map((b) => ({
      sector_id: (b.sector_id as string | null) ?? null,
      nome: (b.nome as string | null) ?? null,
      ...recorte(b),
    })),
    por_atendente: porAtendente,
    desfechos: (bruto.desfechos ?? {}) as Record<string, number>,
    motivos: await motivosDeEncerramento(supabase, orgId, janela),
  };

  return ok({ janela: { de: janela.de, ate: janela.ate, tz: janela.tz }, ...relatorio }, { requestId });
}
