"use client";

/**
 * O RESULTADO DA PESQUISA DO ENCERRAMENTO, nas duas réguas (3.4).
 *
 * Um componente para as duas portas que mostram a nota — Configurações ›
 * Atendimento (o cartão da pesquisa) e Relatórios › Satisfação —, para que as
 * duas nunca façam contas diferentes do mesmo número.
 *
 * A régua configurada aparece sempre; a outra só quando teve resposta no
 * período (a organização que trocou de CSAT para NPS no meio do mês vê as duas,
 * separadas: média de 1–5 com 0–10 não mede nada).
 */

import { useT } from "@/hooks/i18n/useT";
import {
  calcularNps,
  type EscalaDaSatisfacao,
  type ResumoDaEscala,
  type ResumoDaSatisfacao,
} from "@/lib/atendimento/satisfacao-nps";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

const NOTAS_CSAT = [5, 4, 3, 2, 1];
const NOTAS_NPS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

function Distribuicao({ notas, ordem }: { notas: Record<string, number>; ordem: number[] }) {
  const maior = Math.max(1, ...ordem.map((n) => Number(notas[String(n)] ?? 0)));
  return (
    <ul className="flex max-w-md flex-col gap-1">
      {ordem.map((nota) => {
        const quantidade = Number(notas[String(nota)] ?? 0);
        return (
          <li key={nota} className="flex items-center gap-2 text-xs">
            <span className="w-5 text-right tabular-nums text-text-muted">{nota}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${(quantidade / maior) * 100}%` }}
              />
            </span>
            <span className="w-8 text-right tabular-nums">{quantidade}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Numero({ rotulo, valor, testId }: { rotulo: string; valor: string | number; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{rotulo}</dt>
      <dd className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {valor}
      </dd>
    </div>
  );
}

function BlocoCsat({ bloco, testIdDaMedia }: { bloco: ResumoDaEscala; testIdDaMedia?: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  return (
    <div className="flex flex-col gap-3" data-testid="resultado-csat">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Numero
          rotulo={t("Média")}
          valor={bloco.media === null ? "—" : bloco.media.toLocaleString(tag, { maximumFractionDigits: 2 })}
          testId={testIdDaMedia}
        />
        <Numero rotulo={t("Respostas")} valor={bloco.respostas} />
      </dl>
      <Distribuicao notas={bloco.notas} ordem={NOTAS_CSAT} />
    </div>
  );
}

function BlocoNps({ bloco, testIdDaMedia }: { bloco: ResumoDaEscala; testIdDaMedia?: string }) {
  const t = useT();
  const nps = calcularNps(bloco.notas);
  const pct = (parte: number) => (nps.respostas === 0 ? "—" : `${Math.round((parte / nps.respostas) * 100)}%`);
  return (
    <div className="flex flex-col gap-3" data-testid="resultado-nps">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Numero rotulo="NPS" valor={nps.nps === null ? "—" : nps.nps} testId={testIdDaMedia} />
        <Numero rotulo={t("Promotores (9–10)")} valor={pct(nps.promotores)} />
        <Numero rotulo={t("Neutros (7–8)")} valor={pct(nps.neutros)} />
        <Numero rotulo={t("Detratores (0–6)")} valor={pct(nps.detratores)} />
      </dl>
      <Distribuicao notas={bloco.notas} ordem={NOTAS_NPS} />
      <p className="text-xs text-text-muted">
        {t("NPS = % de promotores menos % de detratores, de −100 a 100.")}
      </p>
    </div>
  );
}

export function ResultadoDaSatisfacao({
  resumo,
  escala,
  testIdDaMedia,
}: {
  resumo: ResumoDaSatisfacao;
  /** A régua configurada hoje: é a que aparece primeiro, e sempre. */
  escala: EscalaDaSatisfacao;
  /** O `data-testid` do número principal da régua configurada. */
  testIdDaMedia?: string;
}) {
  const t = useT();
  const outra: EscalaDaSatisfacao = escala === "nps_0_10" ? "csat_1_5" : "nps_0_10";
  const mostrarOutra = (resumo.por_escala[outra]?.respostas ?? 0) > 0;
  const bloco = (e: EscalaDaSatisfacao, testId?: string) =>
    e === "nps_0_10" ? (
      <BlocoNps bloco={resumo.por_escala.nps_0_10} testIdDaMedia={testId} />
    ) : (
      <BlocoCsat bloco={resumo.por_escala.csat_1_5} testIdDaMedia={testId} />
    );

  return (
    <div className="flex flex-col gap-6">
      {bloco(escala, testIdDaMedia)}
      {mostrarOutra && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <h4 className="text-xs font-medium text-text-muted">
            {outra === "nps_0_10"
              ? t("Respostas na régua de 0 a 10 (NPS)")
              : t("Respostas na régua de 1 a 5")}
          </h4>
          {bloco(outra)}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Numero rotulo={t("Perguntas feitas")} valor={resumo.pedidos} />
        <Numero rotulo={t("Sem resposta")} valor={resumo.sem_nota} />
      </dl>
    </div>
  );
}
