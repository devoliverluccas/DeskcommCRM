"use client";

/**
 * Meta do mês e progresso no Desempenho (issue #3025, fatia 1).
 *
 * ─── Por que este painel existe ─────────────────────────────────────────────
 * A tela mostrava só o realizado. Sem ALVO não há percentual, e a comparação
 * mês a mês ficava na cabeça de quem cobra o time. Aqui estão os quatro números,
 * com a MESMA régua de barra do card de funil logo abaixo: o que muda de um
 * painel para o outro é o denominador, não o desenho.
 *
 * ─── Por que o estado chega por prop ────────────────────────────────────────
 * Quem busca é o `MetricsClient` (um pedido só para a tela). O painel recebe
 * carregando/erro/vazio/ok e por isso é medido em DOM sem banco e sem mock de
 * rede — o que precisa de prova aqui é o DESFECHO de cada estado, e o mais
 * importante deles é o VAZIO: "sem meta" é ausência de cadastro, e mostrar
 * `0 de 0` ali seria afirmar que a empresa não vendeu nada.
 *
 * ─── O caso atingido ───────────────────────────────────────────────────────
 * Percentual acima de 100 é informação (vendeu mais do que a meta), mas a barra
 * para em 100% e "quanto falta" fica ausente em vez de negativo: `-7` seria uma
 * dívida que não existe.
 */
import { useT } from "@/hooks/i18n/useT";
import { Skeleton } from "@/components/ui/skeleton";
import type { ValoresDoPeriodo } from "@/lib/metrics/valores-do-periodo";
import { mesLegivel } from "@/lib/metas/periodo";
import { MOEDA_PADRAO, formatValorDoNegocio } from "@/lib/money";
import Link from "next/link";

import { TituloDeSecao } from "./Secao";

export interface MetaDaEmpresa {
  id: string;
  escopo: "empresa" | "funil";
  pipeline_id: string | null;
  pipeline_nome: string | null;
  alvo: number;
  realizado: number;
  percentual: number;
  falta: number;
  atingida: boolean;
}

export type EstadoDaMeta = "carregando" | "erro" | "vazio" | "ok";

interface Props {
  estado: EstadoDaMeta;
  /** O 1º dia do mês da meta, como `YYYY-MM-01`; nulo quando não há meta. */
  periodo: string | null;
  metas: readonly MetaDaEmpresa[];
  /** manager+: mostra a porta do cadastro em Configurações. */
  podeConfigurar: boolean;
  /**
   * As duas parcelas do período (fatia 2, item 1, da #3602). Ausente ou
   * `null` = nada a mostrar (resposta antiga ou leitura ainda sem o bloco).
   */
  valores?: ValoresDoPeriodo | null;
}

export function MetaDoMesPanel({ estado, periodo, metas, podeConfigurar, valores }: Props) {
  const t = useT();
  const mes = mesLegivel(periodo);

  return (
    // Sem cartão: o painel abre com o percentual grande e a barra, como o funil
    // logo abaixo. Cartão fica para tabela e gráfico.
    <section className="flex flex-col gap-4">
      <TituloDeSecao titulo={`${t("Meta do mês")}${mes ? ` · ${mes}` : ""}`} />

      {estado === "carregando" ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-label={t("Carregando a meta do mês")}
        >
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-1.5 w-full max-w-xl" />
        </div>
      ) : null}

      {estado === "erro" ? (
        <p className="text-sm text-text-muted">
          {t(
            "Não consegui carregar a meta do mês — isto é uma falha de leitura, não a ausência de meta.",
          )}
        </p>
      ) : null}

      {estado === "vazio" ? (
        <div className="flex max-w-xl flex-col gap-1.5">
          <p className="text-sm font-medium">{t("Nenhuma meta cadastrada para este mês.")}</p>
          <p className="text-sm text-text-muted">
            {t(
              "Defina a meta em Configurações › Meta de vendas para ver aqui o quanto já foi feito e o quanto falta.",
            )}
          </p>
          {podeConfigurar ? (
            <Link
              href="/app/settings/metas"
              className="mt-1 self-start text-sm font-medium text-accent underline-offset-4 hover:underline"
            >
              {t("Definir a meta")}
            </Link>
          ) : (
            <p className="text-sm text-text-muted">
              {t("Só quem administra a empresa define a meta.")}
            </p>
          )}
        </div>
      ) : null}

      {estado === "ok" ? (
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          {metas.map((m) => (
            <div key={m.id} className="flex min-w-0 flex-col gap-2">
              <p className="truncate text-xs text-text-muted">
                {m.escopo === "funil" ? (m.pipeline_nome ?? t("Funil")) : t("Empresa")}
              </p>
              <p className="flex items-baseline gap-2">
                <span
                  className="text-3xl font-semibold tracking-tight tabular-nums"
                  data-meta="percentual"
                >
                  {m.percentual}%
                </span>
                <span className="text-sm text-text-muted">{t("da meta")}</span>
              </p>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated">
                <div
                  data-meta="barra"
                  className={`h-full rounded-full transition-[width] ${
                    m.atingida ? "bg-success" : "bg-accent"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, m.percentual))}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-text-muted">
                <span>
                  <span className="font-medium text-text tabular-nums" data-meta="realizado">
                    {m.realizado}
                  </span>{" "}
                  {t("de")}{" "}
                  <span className="font-medium text-text tabular-nums" data-meta="alvo">
                    {m.alvo}
                  </span>{" "}
                  {t("Vendas ganhas")}
                </span>
                <span>
                  {m.atingida ? (
                    <span className="text-success-fg">{t("Meta atingida.")}</span>
                  ) : (
                    <>
                      {t("Faltam")}{" "}
                      <span className="font-medium text-text tabular-nums" data-meta="falta">
                        {m.falta}
                      </span>{" "}
                      {t("para a meta")}
                    </>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* As DUAS parcelas do período (fatia 2, item 1, da #3602). Só aparecem
          quando há recorrência preenchida: quem nunca usa o campo continua
          vendo exatamente o painel de antes. Cada moeda na sua linha — somar
          dólar com real produziria um número que não existe (Régua 3). */}
      {valores && valores.negocios_com_recorrencia > 0 ? (
        <div className="flex max-w-xl flex-col gap-3 border-t border-border pt-4" data-valores="periodo">
          {valores.por_moeda.map((balde) => (
            <div
              key={balde.moeda ?? "sem-moeda"}
              className="flex flex-col gap-1 text-sm"
              data-valores="moeda"
            >
              <div className="flex flex-col divide-y divide-border">
                <span className="flex items-baseline justify-between gap-4 py-1.5">
                  <span className="text-text-muted">{t("Vendido único")}: </span>
                  <span className="font-medium tabular-nums" data-valores="unico">
                    {formatValorDoNegocio(balde.unico_centavos, balde.moeda ?? MOEDA_PADRAO)}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-4 py-1.5">
                  <span className="text-text-muted">{t("Recorrência nova (mensal)")}: </span>
                  <span className="font-medium tabular-nums">
                    <span data-valores="recorrente-mensal">
                      {formatValorDoNegocio(
                        balde.recorrente_mensal_centavos,
                        balde.moeda ?? MOEDA_PADRAO,
                      )}
                    </span>
                    <span className="font-normal text-text-muted">{t("/mês")}</span>
                  </span>
                </span>
              </div>
              <span className="text-xs text-text-subtle" data-valores="com-recorrencia">
                {balde.negocios_com_recorrencia}{" "}
                {balde.negocios_com_recorrencia === 1
                  ? t("negócio com recorrência")
                  : t("negócios com recorrência")}
              </span>
            </div>
          ))}
          {valores.truncado ? (
            <p className="text-xs text-text-subtle" data-valores="piso">
              {t("Leitura parcial: as parcelas somam o que foi lido no período.")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
