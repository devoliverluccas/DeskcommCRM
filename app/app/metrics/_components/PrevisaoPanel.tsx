"use client";

import { useT } from "@/hooks/i18n/useT";
import { usePrevisaoFunil } from "@/hooks/metrics/usePrevisaoFunil";
import { formatValorDoNegocio } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CABECALHO_DE_CARTAO, TituloDeSecao } from "./Secao";

/**
 * Painel "Previsão" de `/app/metrics` (issue #1535) — mês × moeda.
 *
 * Três regras de honestidade que a apresentação não pode quebrar:
 *
 * 1. **Moeda diferente não soma.** Cada moeda tem a sua coluna de saldo; não
 *    existe total único na tela, porque não existe na regra
 *    (`lib/leads/previsao.ts`).
 * 2. **"Sem data" e "sem probabilidade" aparecem.** São o que falta calibrar,
 *    não zero: somá-los em silêncio faria a promessa sumir com o valor que não
 *    foi contado.
 * 3. **As duas parcelas nunca são somadas (#3602).** O valor ÚNICO (setup,
 *    implantação, matrícula) e a RECORRÊNCIA NOVA (a mensalidade) têm colunas
 *    próprias, com o mesmo par ponderado/bruto, e nenhuma célula mostra a soma
 *    das duas: elas entram em meses diferentes do caixa. Recorrência que não é
 *    mensal não vira número mensal — aparece à parte, com o valor real.
 */
export function PrevisaoPanel() {
  const t = useT();
  const { data, isLoading, isError } = usePrevisaoFunil();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("Carregando…")}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <section className="flex flex-col gap-2">
        <TituloDeSecao titulo={t("Previsão")} />
        <p className="text-sm text-error-fg">{t("Erro ao carregar a previsão.")}</p>
      </section>
    );
  }

  const vazia =
    data.meses.length === 0 &&
    data.sem_data.length === 0 &&
    data.sem_probabilidade.length === 0;

  const dinheiro = (centavos: number, moeda: string) => formatValorDoNegocio(centavos, moeda);

  return (
    <Card>
      <TituloDeSecao
        className={CABECALHO_DE_CARTAO}
        titulo={t("Previsão")}
        descricao={
          data.fonte === "ia_quando_houver"
            ? t("Chance vinda da inteligência artificial quando existe, e da etapa quando não.")
            : t("Chance de fechamento definida em cada etapa do funil.")
        }
      />
      <div className="space-y-5 p-4">
        {data.truncado ? (
          // O corte é DITO. Sem esta frase, a soma de um recorte da carteira
          // pareceria a previsão inteira (#4322).
          <p className="text-xs text-warning-fg" data-testid="previsao-truncada">
            {t(
              "Este funil tem mais negócios abertos do que a previsão consegue ler. Os valores abaixo são parciais.",
            )}
          </p>
        ) : null}

        {vazia ? (
          <p className="text-sm text-text-muted">
            {t("Nenhum negócio aberto com valor neste funil.")}
          </p>
        ) : null}

        {/* A caixa que rola é a da tabela, não a tela: as colunas das duas
            parcelas não quebram linha e passam dos 390px do celular. */}
        {data.meses.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                  <tr key={`${faixa.moeda}-${faixa.mes}`} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{faixa.mes}</td>
                    <td className="py-2 pr-3 text-text-muted">{faixa.moeda}</td>
                    <td className="py-2 pl-3 text-right font-medium tabular-nums">
                      {dinheiro(faixa.unico.ponderado_cents, faixa.moeda)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-text-muted">
                      {dinheiro(faixa.unico.bruto_cents, faixa.moeda)}
                    </td>
                    <td className="py-2 pl-3 text-right font-medium tabular-nums">
                      {dinheiro(faixa.recorrente_mensal.ponderado_cents, faixa.moeda)}
                    </td>
                    <td className="py-2 pl-3 text-right tabular-nums text-text-muted">
                      {dinheiro(faixa.recorrente_mensal.bruto_cents, faixa.moeda)}
                    </td>
                    <td className="py-2 pl-3 text-right font-medium tabular-nums">{faixa.n}</td>
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
          <div className="space-y-1 border-t border-border pt-4 text-sm">
            <p className="text-xs text-text-muted">
              {t("Sem data prevista — entram, mas sem mês no cronograma")}
            </p>
            {data.sem_data.map((balde) => (
              <p key={`sem-data-${balde.moeda}`} className="tabular-nums">
                {balde.moeda}: {dinheiro(balde.unico.ponderado_cents, balde.moeda)} ·{" "}
                {t("bruto")} {dinheiro(balde.unico.bruto_cents, balde.moeda)} · {balde.n}{" "}
                {t("negócios")}
                {balde.recorrente_mensal.bruto_cents > 0
                  ? ` · ${t("recorrência mensal")}: ${t("Ponderado")} ${dinheiro(
                      balde.recorrente_mensal.ponderado_cents,
                      balde.moeda,
                    )} · ${t("Bruto")} ${dinheiro(balde.recorrente_mensal.bruto_cents, balde.moeda)}`
                  : null}
              </p>
            ))}
          </div>
        )}

        {data.sem_probabilidade.length > 0 && (
          <div className="space-y-1 border-t border-border pt-4 text-sm">
            <p className="text-xs text-text-muted">
              {t("Sem chance definida na etapa — falta calibrar")}
            </p>
            {data.sem_probabilidade.map((balde) => (
              <p key={`sem-prob-${balde.moeda}`} className="tabular-nums">
                {balde.moeda}: {dinheiro(balde.unico.bruto_cents, balde.moeda)} · {balde.n}{" "}
                {t("negócios")}
                {balde.recorrente_mensal.bruto_cents > 0
                  ? ` · ${t("recorrência mensal")} ${t("Bruto")} ${dinheiro(
                      balde.recorrente_mensal.bruto_cents,
                      balde.moeda,
                    )}`
                  : null}
              </p>
            ))}
          </div>
        )}

        {data.recorrencia_nao_mensal.length > 0 && (
          <div className="space-y-1 border-t border-border pt-4 text-sm">
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
      </div>
    </Card>
  );
}
