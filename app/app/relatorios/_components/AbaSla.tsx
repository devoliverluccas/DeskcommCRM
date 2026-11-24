"use client";

/**
 * Aba "SLA" (3.3 + 3.6): quanto da primeira resposta saiu dentro da meta no
 * período, no total e por setor. A régua é a do selo da lista
 * (`lib/inbox/sla-relatorio.ts`); sem meta configurada, a aba diz onde
 * configurar em vez de mostrar zeros.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { TituloDeSecao } from "@/app/app/metrics/_components/Secao";
import type { JanelaDaResposta, RelatorioDeSla } from "@/app/api/v1/relatorios/_tipos";

import type { Periodo } from "../_lib/periodo";
import { Barra, BotaoCsv, Carregando, ErroDaAba, NumeroGrande } from "./comum";

const porcento = (v: number | null) => (v === null ? "—" : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);

export function AbaSla({ periodo }: { periodo: Periodo }) {
  const t = useT();
  const consulta = useQuery({
    queryKey: ["relatorios", "sla", periodo.de, periodo.ate],
    queryFn: () =>
      apiClient.get<{ data: RelatorioDeSla & { janela: JanelaDaResposta } }>(
        `/api/v1/relatorios/sla?de=${periodo.de}&ate=${periodo.ate}`,
      ),
  });

  if (consulta.isLoading) return <Carregando />;
  if (consulta.isError || !consulta.data) return <ErroDaAba tentar={() => void consulta.refetch()} />;
  const r = consulta.data.data;

  const configurar = (
    <Link
      href="/app/settings/atendimento"
      className="inline-flex h-11 items-center text-sm text-text-muted underline-offset-4 hover:text-text hover:underline lg:h-8"
    >
      {t("Configurar metas")}
    </Link>
  );

  if (!r.com_meta || !r.resumo) {
    return (
      <section className="flex flex-col gap-4 py-2" data-testid="relatorio-sla-sem-meta">
        <TituloDeSecao titulo={t("SLA de primeira resposta")} acao={configurar} />
        <p className="text-sm text-text-muted">
          {t("Nenhuma meta de SLA configurada. Defina a meta de primeira resposta em Configurações › Atendimento.")}
        </p>
      </section>
    );
  }

  const resumo = r.resumo;
  const nomeDoSetor = (id: string | null) => (id ? (r.setores[id] ?? t("Setor removido")) : t("Sem setor"));
  const linhas = [...resumo.por_setor].sort((a, b) => b.medidos - a.medidos);

  return (
    <div className="flex flex-col divide-y divide-border *:py-8 *:first:pt-2" data-testid="relatorio-sla">
      <section className="flex flex-col gap-4">
        <TituloDeSecao
          titulo={t("SLA de primeira resposta")}
          descricao={t(
            "Atendimentos do período respondidos dentro da meta. O tempo fora do horário do setor não conta; os ainda no prazo e os com SLA ignorado ficam fora da porcentagem.",
          )}
          acao={configurar}
        />
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <NumeroGrande rotulo={t("Dentro da meta")} valor={porcento(resumo.percentual_dentro)} />
          <NumeroGrande rotulo={t("Dentro")} valor={resumo.dentro} />
          <NumeroGrande rotulo={t("Fora")} valor={resumo.fora} />
          <NumeroGrande rotulo={t("Ainda no prazo")} valor={resumo.pendentes} />
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <TituloDeSecao
          titulo={t("Por setor")}
          contagem={linhas.length}
          acao={
            <BotaoCsv
              nome={`sla-${periodo.de}-${periodo.ate}`}
              cabecalho={[t("Setor"), t("Dentro"), t("Fora"), t("Ainda no prazo"), t("Dentro da meta")]}
              linhas={linhas.map((l) => [nomeDoSetor(l.sector_id), l.dentro, l.fora, l.pendentes, l.percentual_dentro])}
            />
          }
        />
        {linhas.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum atendimento no período.")}</p>
        ) : (
          <ul className="flex max-w-3xl flex-col">
            {linhas.map((l) => (
              <li
                key={l.sector_id ?? "sem-setor"}
                className="flex min-h-11 items-center gap-4 border-b border-border py-2 text-sm last:border-0"
              >
                <span className="w-40 shrink-0 truncate">{nomeDoSetor(l.sector_id)}</span>
                <Barra valor={l.dentro} maximo={Math.max(1, l.medidos)} />
                <span className="w-16 shrink-0 text-right font-medium tabular-nums">{porcento(l.percentual_dentro)}</span>
                <span className="w-24 shrink-0 text-right text-xs text-text-muted tabular-nums">
                  {l.dentro}/{l.medidos}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
