"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { TituloDeSecao } from "@/app/app/metrics/_components/Secao";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { Stage } from "@/lib/kanban/types";
import type { LinhaDeConversao, RelatorioDeFunil } from "@/lib/metrics/funil";
import { SEM_CATEGORIA, SEM_MOTIVO, agruparPerdas } from "@/lib/metrics/perdas";
import { agregarPorEtapa } from "@/lib/metrics/tempo-da-etapa";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import type { Lead } from "@/lib/types/leads";

/** A janela da conversão. 90 e não os 30 do padrão da rota: funil de venda longa não cabe num mês. */
const DIAS_DA_JANELA = 90;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Horas como a tela lê: até dois dias em horas, depois em dias. */
export function duracaoCurta(horas: number | null): string {
  if (horas === null) return "—";
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} d`;
}

/**
 * A VISÃO "ANÁLISE" DO FUNIL (fase 1, item 1.6).
 *
 * Três perguntas, cada uma da fonte que JÁ existe — nenhuma rota nova, nenhuma
 * consulta nova ao banco:
 *
 * 1. **Quantos entraram em cada etapa e quantos passaram para a seguinte** —
 *   `GET /api/v1/metrics/funil` (a análise de funil do Desempenho, conta em
 *   `lib/metrics/funil.ts`), recortada para ESTE funil. Lê com o client de
 *   sessão e piso `agent`: a RLS decide o escopo de cada linha, como lá.
 * 2. **Tempo na etapa** — `agregarPorEtapa` (`lib/metrics/tempo-da-etapa.ts`)
 *   sobre os negócios ABERTOS do quadro já carregado: quem está na etapa agora,
 *   desde a entrada nela (`stage_changed_at`). É a mesma régua da rota de taxas
 *   das etapas, que é manager+ e por isso não serve a quem atende.
 * 3. **Motivos de perda** — `agruparPerdas` (`lib/metrics/perdas.ts`, a conta do
 *   relatório de Perdas) sobre os perdidos do quadro. O relatório de Perdas é da
 *   organização inteira e manager+; aqui é deste funil, e por isso só alcança os
 *   perdidos que o quadro trouxe (o recorte de encerrados antigos, quando
 *   ligado no funil, os tira do quadro e daqui também).
 *
 * Os filtros do quadro não valem aqui, pelo mesmo motivo da Previsão: a rota
 * de conversão não os recebe, e metade da tela filtrada ao lado da outra metade
 * sem filtro seria pior do que nenhum.
 */
export function AnaliseDoFunil({
  pipelineId,
  stages,
  leads,
  settings,
  truncado,
}: {
  pipelineId: string;
  stages: Stage[];
  /** Os negócios do quadro, SEM filtro. */
  leads: Lead[];
  settings?: Record<string, unknown>;
  /** O quadro veio recortado (#4321): os números do quadro são parciais. */
  truncado?: boolean;
}) {
  const t = useT();
  // A janela nasce uma vez por visita e fecha na PRÓXIMA hora cheia: recalculada
  // a cada render, a chave da consulta mudaria a cada milissegundo, e voltar à
  // aba dentro da mesma hora reaproveita o cache em vez de pedir de novo.
  const [janela] = useState(() => {
    const ate = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000);
    return {
      de: new Date(ate.getTime() - DIAS_DA_JANELA * DIA_MS).toISOString(),
      ate: ate.toISOString(),
    };
  });
  const conversao = useQuery({
    queryKey: ["funil-analise", janela.de, janela.ate],
    staleTime: 60_000,
    queryFn: async (): Promise<RelatorioDeFunil> => {
      const qs = new URLSearchParams({ from: janela.de, to: janela.ate });
      const res = await apiClient.get<{ data: RelatorioDeFunil }>(
        `/api/v1/metrics/funil?${qs.toString()}`,
      );
      return res.data;
    },
  });

  const linhasDeConversao = useMemo(() => {
    const porEtapa = new Map<string, LinhaDeConversao>();
    const etapas = conversao.data?.conversao?.etapas;
    if (Array.isArray(etapas)) {
      for (const linha of etapas) {
        if (linha.pipeline_id === pipelineId) porEtapa.set(linha.etapa.id, linha);
      }
    }
    return porEtapa;
  }, [conversao.data, pipelineId]);

  const etapasPorId = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const tempos = useMemo(() => {
    const abertos = leads.filter((l) => {
      const etapa = etapasPorId.get(l.stage_id);
      return l.status === "open" && etapa && !etapa.is_won && !etapa.is_lost;
    });
    return new Map(agregarPorEtapa(abertos, new Date()).map((m) => [m.stageId, m]));
  }, [leads, etapasPorId]);

  const perdas = useMemo(
    () =>
      agruparPerdas(
        leads
          .filter((l) => l.status === "lost")
          .map((l) => ({
            lost_reason: l.lost_reason,
            lost_from_stage_id: null,
            value_cents: l.value_cents,
            currency: l.currency,
          })),
        { settings },
      ),
    [leads, settings],
  );
  const maiorMotivo = perdas.porMotivo[0]?.quantidade ?? 0;
  const rotuloDoMotivo = (motivo: string) => {
    if (motivo === SEM_MOTIVO) return t("Sem motivo registrado");
    // Canônico vira o rótulo traduzido; motivo próprio do funil é dado e sai
    // como está. A chamada vai DENTRO do `t()` para o guarda de i18n ver de
    // onde a chave vem (a tabela `ROTULO_DO_MOTIVO_CANONICO`).
    return rotuloDoMotivoDePerda(motivo) === motivo ? motivo : t(rotuloDoMotivoDePerda(motivo));
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pb-6"
      data-testid="analise-do-funil"
    >
      {truncado ? (
        <p className="text-xs text-warning-fg">
          {t("O quadro trouxe só uma parte deste funil: os números por etapa são parciais.")}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <TituloDeSecao
          titulo={t("Conversão entre etapas")}
          descricao={`${t("Últimos 90 dias")} · ${t(
            "Quantos entraram em cada etapa e quantos passaram para a seguinte. O tempo é de quem está na etapa agora.",
          )}`}
        />
        {conversao.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : conversao.isError ? (
          <p className="text-sm text-error-fg">{t("Não foi possível carregar a conversão.")}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="analise-por-etapa">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-1.5 pr-3 font-medium">{t("Etapa")}</th>
                <th className="py-1.5 pl-3 text-right font-medium">{t("Entraram")}</th>
                <th className="py-1.5 pl-3 text-right font-medium">{t("Passaram")}</th>
                <th className="w-40 py-1.5 pl-3 font-medium">{t("Conversão")}</th>
                <th className="py-1.5 pl-3 text-right font-medium">{t("Na etapa agora")}</th>
                <th className="py-1.5 pl-3 text-right font-medium">{t("Tempo médio")}</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((etapa) => {
                const linha = linhasDeConversao.get(etapa.id);
                const tempo = tempos.get(etapa.id);
                const desfecho = etapa.is_won || etapa.is_lost;
                const taxa = linha?.taxa ?? null;
                return (
                  <tr
                    key={etapa.id}
                    className="border-b border-border last:border-0"
                    data-testid={`analise-etapa-${etapa.id}`}
                  >
                    <td className="py-2 pr-3">
                      <span className={desfecho ? "text-text-muted" : undefined}>{etapa.name}</span>
                      {linha?.proxima ? (
                        <span className="ml-1.5 text-xs text-text-subtle">
                          → {linha.proxima.nome}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {linha ? linha.entraram : "—"}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {linha && !desfecho && linha.proxima ? linha.passaram : "—"}
                    </td>
                    <td className="py-2 pl-3">
                      {taxa !== null && !desfecho && linha?.proxima ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
                            <div
                              className="h-full rounded-full bg-text-muted"
                              style={{ width: `${Math.round(taxa * 100)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-medium tabular-nums">
                            {Math.round(taxa * 100)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums">
                      {desfecho ? "—" : (tempo?.quantidade ?? 0)}
                    </td>
                    <td className="py-2 pl-3 text-right text-text-muted tabular-nums">
                      {desfecho ? "—" : duracaoCurta(tempo?.horasMedia ?? null)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <TituloDeSecao
          titulo={t("Motivos de perda")}
          contagem={perdas.total > 0 ? perdas.total : undefined}
          descricao={t("Dos negócios perdidos que estão no quadro deste funil.")}
        />
        {perdas.total === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum negócio perdido neste funil.")}</p>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            <ul className="flex flex-col gap-2" data-testid="analise-motivos">
              {perdas.porMotivo.map((linha) => (
                <li key={linha.chave} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{rotuloDoMotivo(linha.chave)}</span>
                    <span className="shrink-0 text-text-muted tabular-nums">
                      {linha.quantidade}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-hover">
                    <div
                      className="h-full rounded-full bg-text-muted"
                      style={{
                        width: `${maiorMotivo ? (linha.quantidade / maiorMotivo) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {perdas.porCategoria.length > 1 ||
            (perdas.porCategoria.length === 1 &&
              perdas.porCategoria[0]?.chave !== SEM_CATEGORIA) ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-text-muted">{t("Por categoria")}</h3>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {perdas.porCategoria.map((linha) => (
                    <li key={linha.chave} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {linha.chave === SEM_CATEGORIA ? t("Sem categoria") : linha.chave}
                      </span>
                      <span className="shrink-0 text-text-muted tabular-nums">
                        {linha.quantidade}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
