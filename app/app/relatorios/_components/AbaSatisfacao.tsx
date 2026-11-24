"use client";

/**
 * Aba "Satisfação" (3.6): a pesquisa do encerramento no período — média
 * (1 a 5) ou NPS (0 a 10), conforme a régua, a distribuição e as últimas
 * respostas. Só quem gerencia chega aqui (a rota cobra `manager`).
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { TituloDeSecao } from "@/app/app/metrics/_components/Secao";
import type { JanelaDaResposta, RelatorioDeSatisfacao } from "@/app/api/v1/relatorios/_tipos";

import type { Periodo } from "../_lib/periodo";
import { BotaoCsv, Carregando, ErroDaAba } from "./comum";
import { ResultadoDaSatisfacao } from "./ResultadoDaSatisfacao";

export function AbaSatisfacao({ periodo }: { periodo: Periodo }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const consulta = useQuery({
    queryKey: ["relatorios", "satisfacao", periodo.de, periodo.ate],
    queryFn: () =>
      apiClient.get<{ data: RelatorioDeSatisfacao & { janela: JanelaDaResposta } }>(
        `/api/v1/relatorios/satisfacao?de=${periodo.de}&ate=${periodo.ate}`,
      ),
  });

  if (consulta.isLoading) return <Carregando />;
  if (consulta.isError || !consulta.data) return <ErroDaAba tentar={() => void consulta.refetch()} />;
  const r = consulta.data.data;
  const quando = (iso: string) =>
    new Date(iso).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const regua = (e: string) => (e === "nps_0_10" ? "0–10" : "1–5");

  return (
    <div className="flex flex-col divide-y divide-border *:py-8 *:first:pt-2">
      <section className="flex flex-col gap-4">
        <TituloDeSecao
          titulo={r.escala === "nps_0_10" ? t("NPS do atendimento") : t("Satisfação do atendimento")}
          descricao={t("Pesquisa enviada ao encerrar o atendimento. Quem não respondeu não conta como nota.")}
          acao={
            <Link
              href="/app/settings/atendimento"
              className="inline-flex h-11 items-center text-sm text-text-muted underline-offset-4 hover:text-text hover:underline lg:h-8"
            >
              {t("Configurar a pesquisa")}
            </Link>
          }
        />
        {r.resumo.pedidos === 0 ? (
          <p className="text-sm text-text-muted">
            {t("Nenhuma pergunta feita no período. A pesquisa sai ao encerrar o atendimento, quando está ligada.")}
          </p>
        ) : (
          <ResultadoDaSatisfacao resumo={r.resumo} escala={r.escala} testIdDaMedia="relatorio-satisfacao-principal" />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <TituloDeSecao
          titulo={t("Respostas recentes")}
          contagem={r.recentes.length}
          acao={
            <BotaoCsv
              nome={`satisfacao-${periodo.de}-${periodo.ate}`}
              cabecalho={[t("Data"), t("Contato"), t("Nota"), t("Escala"), t("Mensagem")]}
              linhas={r.recentes.map((x) => [x.respondido_em, x.contato, x.nota, regua(x.escala), x.texto])}
            />
          }
        />
        {r.recentes.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhuma resposta no período.")}</p>
        ) : (
          <ul className="flex max-w-3xl flex-col">
            {r.recentes.map((x) => (
              <li key={x.id} className="border-b border-border last:border-0">
                <Link
                  href={`/app/inbox?id=${x.conversation_id}`}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-fast hover:bg-hover"
                >
                  <span className="w-10 shrink-0 text-lg font-semibold tabular-nums">{x.nota}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{x.contato ?? t("Contato")}</span>
                    {x.texto && x.texto.trim() !== String(x.nota) ? (
                      <span className="block truncate text-xs text-text-muted">{x.texto}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-subtle">
                    {regua(x.escala)} · {quando(x.respondido_em)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
