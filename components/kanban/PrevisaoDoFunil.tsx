"use client";

import { useQuery } from "@tanstack/react-query";

import { TituloDeSecao } from "@/app/app/metrics/_components/Secao";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { totaisDoFunil } from "@/lib/kanban/total-do-funil";
import type { Stage } from "@/lib/kanban/types";
import type { PrevisaoCarregada } from "@/lib/leads/previsao";
import { formatSomaPorMoeda, formatValorDoNegocio } from "@/lib/money";
import type { Lead } from "@/lib/types/leads";

/**
 * A VISÃO "PREVISÃO" DO FUNIL (fase 1, item 1.6).
 *
 * Duas perguntas, duas fontes, e nenhuma regra nova:
 *
 * - **Quando entra, por mês de fechamento** — `GET …/pipelines/[id]/forecast`,
 *   a MESMA rota e a mesma regra (`lib/leads/previsao.ts`) do painel de
 *   Métricas. A rota lê com o client de SESSÃO, então `visibility_mode = "own"`
 *   vale aqui como lá (`tests/unit/previsao-visibilidade.test.ts`). O desenho é o
 *   do `PrevisaoPanel`: moedas nunca somadas, as duas parcelas (único e
 *   recorrência mensal) nunca somadas, e os baldes "sem data", "sem chance" e
 *   "recorrência fora do mensal" ditos em vez de sumidos. O painel não serve
 *   direto porque o hook dele (`usePrevisaoFunil`) é preso ao funil PADRÃO.
 * - **Onde está, por etapa** — os negócios abertos do quadro já carregado,
 *   somados por `totaisDoFunil`: a mesma conta do cabeçalho e de cada coluna,
 *   com a chance da etapa. É o que a coluna mostra, posto em fila.
 *
 * Os filtros do quadro não valem aqui: a rota não os recebe, e uma tabela
 * filtrada ao lado de outra que não é seria dois números para a mesma pergunta.
 */
export function PrevisaoDoFunil({
  pipelineId,
  stages,
  leads,
}: {
  pipelineId: string;
  stages: Stage[];
  /** Os negócios do quadro, SEM filtro — ver o cabeçalho. */
  leads: Lead[];
}) {
  const t = useT();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["previsao", "funil", pipelineId],
    staleTime: 60_000,
    queryFn: async (): Promise<PrevisaoCarregada> => {
      const res = await apiClient.get<{ data: PrevisaoCarregada }>(
        `/api/v1/pipelines/${encodeURIComponent(pipelineId)}/forecast`,
      );
      return res.data;
    },
  });

  const dinheiro = (centavos: number, moeda: string) => formatValorDoNegocio(centavos, moeda);
  const etapasAbertas = stages.filter((s) => !s.is_won && !s.is_lost);
  const abertos = leads.filter((l) => l.status === "open");

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pb-6"
      data-testid="previsao-do-funil"
    >
      {/* O número que responde a pergunta vem primeiro e grande; a tabela é o
          detalhe dele. Uma linha por moeda — moedas não se somam. */}
      <section className="flex flex-col gap-3">
        <TituloDeSecao
          titulo={t("Previsão")}
          descricao={
            data?.fonte === "ia_quando_houver"
              ? t("Chance vinda da inteligência artificial quando existe, e da etapa quando não.")
              : t("Chance de fechamento definida em cada etapa do funil.")
          }
        />
        {isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("Carregando…")}>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-error-fg">{t("Erro ao carregar a previsão.")}</p>
        ) : (
          <>
            {data.truncado ? (
              <p className="text-xs text-warning-fg" data-testid="previsao-truncada">
                {t(
                  "Este funil tem mais negócios abertos do que a previsão consegue ler. Os valores abaixo são parciais.",
                )}
              </p>
            ) : null}
            {data.totais.length > 0 ? (
              <dl className="flex flex-wrap gap-x-10 gap-y-3">
                {data.totais.map((balde) => (
                  <div key={balde.moeda} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-text-muted">
                      {t("Ponderado")} · {balde.moeda}
                    </dt>
                    <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                      {dinheiro(balde.unico.ponderado_cents, balde.moeda)}
                    </dd>
                    <dd className="text-xs text-text-muted tabular-nums">
                      {t("Bruto")} {dinheiro(balde.unico.bruto_cents, balde.moeda)} · {balde.n}{" "}
                      {t("negócios")}
                    </dd>
                    {balde.recorrente_mensal.bruto_cents > 0 ? (
                      <dd className="text-xs text-text-muted tabular-nums">
                        {t("recorrência mensal")}: {t("Ponderado")}{" "}
                        {dinheiro(balde.recorrente_mensal.ponderado_cents, balde.moeda)}
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            ) : null}
            {data.meses.length === 0 &&
            data.sem_data.length === 0 &&
            data.sem_probabilidade.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t("Nenhum negócio aberto com valor neste funil.")}
              </p>
            ) : null}

            {data.meses.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="previsao-por-mes">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-text-muted">
                      <th rowSpan={2} className="py-1.5 pr-3 font-medium">
                        {t("Mês")}
                      </th>
                      <th rowSpan={2} className="py-1.5 pr-3 font-medium">
                        {t("Moeda")}
                      </th>
                      <th colSpan={2} className="py-1.5 text-center font-medium">
                        {t("Valor único")}
                      </th>
                      <th colSpan={2} className="py-1.5 text-center font-medium">
                        {t("Recorrência nova (mensal)")}
                      </th>
                      <th rowSpan={2} className="py-1.5 pl-3 text-right font-medium">
                        {t("Negócios")}
                      </th>
                    </tr>
                    <tr className="border-b border-border text-left text-xs text-text-muted">
                      <th className="py-1.5 pl-3 text-right font-medium">{t("Ponderado")}</th>
                      <th className="py-1.5 pl-3 text-right font-medium">{t("Bruto")}</th>
                      <th className="py-1.5 pl-3 text-right font-medium">{t("Ponderado")}</th>
                      <th className="py-1.5 pl-3 text-right font-medium">{t("Bruto")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.meses.map((faixa) => (
                      <tr
                        key={`${faixa.moeda}-${faixa.mes}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-2 pr-3 tabular-nums">{faixa.mes}</td>
                        <td className="py-2 pr-3 text-text-muted">{faixa.moeda}</td>
                        <td className="py-2 pl-3 text-right font-medium tabular-nums">
                          {dinheiro(faixa.unico.ponderado_cents, faixa.moeda)}
                        </td>
                        <td className="py-2 pl-3 text-right text-text-muted tabular-nums">
                          {dinheiro(faixa.unico.bruto_cents, faixa.moeda)}
                        </td>
                        <td className="py-2 pl-3 text-right font-medium tabular-nums">
                          {dinheiro(faixa.recorrente_mensal.ponderado_cents, faixa.moeda)}
                        </td>
                        <td className="py-2 pl-3 text-right text-text-muted tabular-nums">
                          {dinheiro(faixa.recorrente_mensal.bruto_cents, faixa.moeda)}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">{faixa.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="pt-2 text-xs text-text-subtle">
                  {t(
                    "As duas parcelas nunca são somadas: o valor único entra uma vez e a recorrência entra todo mês.",
                  )}
                </p>
              </div>
            )}

            {data.sem_data.length > 0 && (
              <div className="space-y-1 text-sm">
                <p className="text-xs text-text-muted">
                  {t("Sem data prevista — entram, mas sem mês no cronograma")}
                </p>
                {data.sem_data.map((balde) => (
                  <p key={`sem-data-${balde.moeda}`} className="tabular-nums">
                    {balde.moeda}: {dinheiro(balde.unico.ponderado_cents, balde.moeda)} ·{" "}
                    {t("bruto")} {dinheiro(balde.unico.bruto_cents, balde.moeda)} · {balde.n}{" "}
                    {t("negócios")}
                  </p>
                ))}
              </div>
            )}

            {data.sem_probabilidade.length > 0 && (
              <div className="space-y-1 text-sm">
                <p className="text-xs text-text-muted">
                  {t("Sem chance definida na etapa — falta calibrar")}
                </p>
                {data.sem_probabilidade.map((balde) => (
                  <p key={`sem-prob-${balde.moeda}`} className="tabular-nums">
                    {balde.moeda}: {dinheiro(balde.unico.bruto_cents, balde.moeda)} · {balde.n}{" "}
                    {t("negócios")}
                  </p>
                ))}
              </div>
            )}

            {data.recorrencia_nao_mensal.length > 0 && (
              <div className="space-y-1 text-sm">
                <p className="text-xs text-text-muted">
                  {t("Recorrência fora do mensal — não entra na projeção por mês")}
                </p>
                {data.recorrencia_nao_mensal.map((balde) => (
                  <p key={`fora-do-mes-${balde.moeda}`} className="tabular-nums">
                    {balde.moeda}: {dinheiro(balde.bruto_cents, balde.moeda)} · {balde.n}{" "}
                    {t("negócios")}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* POR ETAPA: o quadro em fila, com a mesma conta das colunas. Só as
          etapas de espera — ganho e perda já são desfecho, não previsão. */}
      {etapasAbertas.length > 0 && (
        <section className="flex flex-col gap-3">
          <TituloDeSecao
            titulo={t("Por etapa")}
            descricao={t("Negócios abertos no quadro, com a chance de cada etapa.")}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="previsao-por-etapa">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="py-1.5 pr-3 font-medium">{t("Etapa")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("Chance")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("Negócios")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("Bruto")}</th>
                  <th className="py-1.5 pl-3 text-right font-medium">{t("Ponderado")}</th>
                </tr>
              </thead>
              <tbody>
                {etapasAbertas.map((etapa) => {
                  const daEtapa = abertos.filter((l) => l.stage_id === etapa.id);
                  const soma = totaisDoFunil(daEtapa, stages);
                  const chance = etapa.win_probability ?? null;
                  return (
                    <tr key={etapa.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">{etapa.name}</td>
                      <td className="py-2 pl-3 text-right text-text-muted tabular-nums">
                        {chance === null ? "—" : `${chance}%`}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">{soma.negocios}</td>
                      <td className="py-2 pl-3 text-right text-text-muted tabular-nums">
                        {soma.bruto.size > 0
                          ? formatSomaPorMoeda(soma.bruto, formatValorDoNegocio, {
                              primeira: soma.primeira,
                            })
                          : "—"}
                      </td>
                      <td className="py-2 pl-3 text-right font-medium tabular-nums">
                        {soma.ponderado.size > 0
                          ? formatSomaPorMoeda(soma.ponderado, formatValorDoNegocio, {
                              primeira: soma.primeira,
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
