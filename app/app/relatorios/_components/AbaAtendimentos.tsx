"use client";

/**
 * Aba "Atendimentos" (3.6): abertos e encerrados por dia, 1ª resposta e
 * resolução, por setor e por atendente, e como as demandas terminaram.
 *
 * O escopo é a RLS de quem olha (`/api/v1/relatorios/atendimentos`): o agent
 * vê as conversas que já vê no Inbox, o gestor a organização.
 */
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { rotuloDoMembro } from "@/lib/users/rotulo-do-atendente";
import { CABECALHO_DE_CARTAO, TituloDeSecao } from "@/app/app/metrics/_components/Secao";
import type { JanelaDaResposta, LinhaDeRecorte, RelatorioDeAtendimentos } from "@/app/api/v1/relatorios/_tipos";

import { diaCurto, formatarTempo } from "../_lib/formato";
import type { Periodo } from "../_lib/periodo";
import { Barra, BotaoCsv, Carregando, ErroDaAba, NumeroGrande } from "./comum";

/** Os desfechos de `demandas.desfecho`, com os rótulos que o painel do contato já usa. */
const ROTULO_DO_DESFECHO: Record<string, string> = {
  resolvida: "Resolvida",
  convertida: "Convertida",
  nao_procede: "Não procede",
  encerrada_pelo_cliente: "Encerrada pelo cliente",
  perdida: "Perdida",
  expirada_sem_resposta: "Expirada sem resposta",
};

const CELULA = "text-right tabular-nums";

function TabelaDeRecorte<L extends LinhaDeRecorte>({
  titulo,
  rotuloDaColuna,
  linhas,
  nome,
  arquivo,
}: {
  titulo: string;
  rotuloDaColuna: string;
  linhas: L[];
  nome: (linha: L) => string;
  arquivo: string;
}) {
  const t = useT();
  const cabecalho = [rotuloDaColuna, t("Abertos"), t("Encerrados"), t("1ª resposta (média)"), t("Resolução (média)")];
  return (
    <Card>
      <TituloDeSecao
        className={CABECALHO_DE_CARTAO}
        titulo={titulo}
        acao={
          <BotaoCsv
            nome={arquivo}
            cabecalho={cabecalho}
            linhas={linhas.map((l) => [
              nome(l),
              l.abertos,
              l.encerrados,
              l.primeira_resposta_media,
              l.resolucao_media,
            ])}
          />
        }
      />
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">{t("Nenhum atendimento no período.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {cabecalho.map((c, i) => (
                  <TableHead key={c} className={i === 0 ? "pl-4" : `text-right ${i === cabecalho.length - 1 ? "pr-4" : ""}`}>
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-4 font-medium">{nome(l)}</TableCell>
                  <TableCell className={CELULA}>{l.abertos}</TableCell>
                  <TableCell className={CELULA}>{l.encerrados}</TableCell>
                  <TableCell className={CELULA}>{formatarTempo(l.primeira_resposta_media)}</TableCell>
                  <TableCell className={`${CELULA} pr-4`}>{formatarTempo(l.resolucao_media)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export function AbaAtendimentos({ periodo, loja = null }: { periodo: Periodo; loja?: string | null }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const consulta = useQuery({
    queryKey: ["relatorios", "atendimentos", periodo.de, periodo.ate, loja],
    queryFn: () =>
      apiClient.get<{ data: RelatorioDeAtendimentos & { janela: JanelaDaResposta } }>(
        `/api/v1/relatorios/atendimentos?de=${periodo.de}&ate=${periodo.ate}${loja ? `&loja=${loja}` : ""}`,
      ),
  });

  if (consulta.isLoading) return <Carregando />;
  if (consulta.isError || !consulta.data) return <ErroDaAba tentar={() => void consulta.refetch()} />;
  const r = consulta.data.data;
  const maiorDia = Math.max(1, ...r.por_dia.map((d) => Math.max(d.abertos, d.encerrados)));
  const desfechos = Object.entries(r.desfechos).sort((a, b) => b[1] - a[1]);
  const maiorDesfecho = Math.max(1, ...desfechos.map(([, n]) => n));
  const rotuloDoSetor = (l: { nome: string | null; sector_id: string | null }) =>
    l.sector_id ? (l.nome ?? t("Setor")) : t("Sem setor");
  const rotuloDoAtendente = (l: { nome: string | null; user_id: string | null }) =>
    l.user_id ? rotuloDoMembro({ full_name: l.nome, user_id: l.user_id }, t) : t("Sem responsável");

  return (
    <div className="flex flex-col divide-y divide-border *:py-8 *:first:pt-2">
      <section className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <NumeroGrande rotulo={t("Abertos")} valor={r.abertos} />
          <NumeroGrande rotulo={t("Encerrados")} valor={r.encerrados} />
          <NumeroGrande
            rotulo={t("1ª resposta (média / mediana)")}
            valor={formatarTempo(r.primeira_resposta.media)}
            detalhe={`${t("Mediana")}: ${formatarTempo(r.primeira_resposta.mediana)}`}
          />
          <NumeroGrande
            rotulo={t("Resolução (média / mediana)")}
            valor={formatarTempo(r.resolucao.media)}
            detalhe={`${t("Mediana")}: ${formatarTempo(r.resolucao.mediana)}`}
          />
        </dl>
        <p className="max-w-3xl text-xs text-text-muted">
          {t(
            "Um atendimento começa na primeira mensagem do cliente e termina ao encerrar. 1ª resposta é a primeira mensagem de uma pessoa da equipe; conversas de grupo ficam de fora.",
          )}
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <TituloDeSecao
          titulo={t("Por dia")}
          acao={
            <BotaoCsv
              nome={`atendimentos-por-dia-${periodo.de}-${periodo.ate}`}
              cabecalho={[t("Data"), t("Abertos"), t("Encerrados")]}
              linhas={r.por_dia.map((d) => [d.dia, d.abertos, d.encerrados])}
            />
          }
        />
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-accent" />
            {t("Abertos")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full bg-text-subtle" />
            {t("Encerrados")}
          </span>
        </div>
        <ul className="flex max-h-96 max-w-3xl flex-col gap-1.5 overflow-y-auto pr-1">
          {[...r.por_dia].reverse().map((d) => (
            <li key={d.dia} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-x-3 gap-y-1 text-xs">
              <span className="row-span-2 tabular-nums text-text-muted">{diaCurto(d.dia, tag)}</span>
              <Barra valor={d.abertos} maximo={maiorDia} />
              <span className="text-right tabular-nums">{d.abertos}</span>
              <Barra valor={d.encerrados} maximo={maiorDia} tom="muted" />
              <span className="text-right tabular-nums text-text-muted">{d.encerrados}</span>
            </li>
          ))}
        </ul>
      </section>

      <TabelaDeRecorte
        titulo={t("Por setor")}
        rotuloDaColuna={t("Setor")}
        linhas={r.por_setor}
        nome={rotuloDoSetor}
        arquivo={`atendimentos-por-setor-${periodo.de}-${periodo.ate}`}
      />

      <TabelaDeRecorte
        titulo={t("Por atendente")}
        rotuloDaColuna={t("Atendente")}
        linhas={r.por_atendente}
        nome={rotuloDoAtendente}
        arquivo={`atendimentos-por-atendente-${periodo.de}-${periodo.ate}`}
      />

      <section className="flex flex-col gap-4">
        <TituloDeSecao
          titulo={t("Como as demandas terminaram")}
          descricao={t("Desfecho das demandas fechadas no período.")}
        />
        {desfechos.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhuma demanda fechada no período.")}</p>
        ) : (
          <ul className="flex max-w-3xl flex-col gap-2.5">
            {desfechos.map(([desfecho, n]) => (
              <li key={desfecho} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm">{t(ROTULO_DO_DESFECHO[desfecho] ?? desfecho)}</span>
                <Barra valor={n} maximo={maiorDesfecho} />
                <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        )}
        {r.motivos !== null && (
          <div className="flex flex-col gap-2" data-testid="relatorio-motivos">
            <h3 className="text-xs font-medium text-text-muted">{t("Motivos de encerramento")}</h3>
            <ul className="flex max-w-3xl flex-col gap-1.5">
              {r.motivos.map((m) => (
                <li key={m.motivo} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{m.motivo}</span>
                  <span className="tabular-nums">{m.quantidade}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
