"use client";

import { useT } from "@/hooks/i18n/useT";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAttendantMetrics, type AttendantMetric } from "@/hooks/metrics/useAttendantMetrics";
import { EmptyState } from "@/components/empty/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarDuracao } from "@/lib/metrics/canais";
import { urlDaExportacao } from "@/lib/relatorios/vendas-csv";
import { DownloadSimple, WarningOctagon } from "@/lib/ui/icons";
import { AtritoPanel } from "./AtritoPanel";
import { CanaisPanel } from "./CanaisPanel";
import { MetaDoMesPanel, type EstadoDaMeta } from "./MetaDoMesPanel";
import { PerdasPanel } from "./PerdasPanel";
import { PrevisaoPanel } from "./PrevisaoPanel";
import { SeriePanel } from "./SeriePanel";
import { CABECALHO_DE_CARTAO, TituloDeSecao } from "./Secao";
import { type FunilDaSerie } from "@/hooks/metrics/useSerieTemporal";
import { useMetasDoMes } from "@/hooks/metrics/useMetasDoMes";
import { janelaDoMes, mesLocal } from "@/lib/metas/periodo";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rotuloDoMembro } from "@/lib/users/rotulo-do-atendente";

const ALL = "__all__";

/**
 * Célula de número que, no celular, vira "Rótulo valor" dentro do cartão: o
 * cabeçalho some abaixo de `md` e o rótulo vem do `data-rotulo` da própria
 * célula. Só classes `max-md:` — no computador é a tabela de sempre.
 */
const CELULA_DE_NUMERO = "text-right tabular-nums max-md:p-0 max-md:text-left max-md:before:mr-1 max-md:before:text-muted-foreground max-md:before:content-[attr(data-rotulo)]";

function attendantLabel(a: AttendantMetric, t: (texto: string) => string): string {
  return rotuloDoMembro({ full_name: a.name, email: a.email, user_id: a.user_id }, t);
}

interface Props {
  canCompare: boolean;
  currentUserId: string;
  /**
   * Os funis da organização, para o recorte dos ganhos (#4918). Vêm do
   * componente de SERVIDOR, como no Kanban: `GET /api/v1/pipelines` exige
   * manager+ e `/app/metrics` é de qualquer papel — um agent que pedisse a
   * lista por ali levaria 403 e ficaria sem o seletor.
   */
  funis: FunilDaSerie[];
}

export function MetricsClient({ canCompare, currentUserId, funis }: Props) {
  const t = useT();
  const [owner, setOwner] = useState<string>(ALL);
  const selectedOwner = owner === ALL ? null : owner;
  const { data, isLoading, isError, refetch } = useAttendantMetrics(selectedOwner);
  // Opções do filtro: só manager+ (a rota /team é manager+). Agent nem vê o filtro.
  const team = useTeamMembers({ enabled: canCompare });

  // O MESMO gate da rota de exportação (`requireRole("manager")`, o piso de
  // `contacts/export` e `audit/export`): um botão que só devolve 403 é
  // armadilha — quem não pode exportar nem vê a porta.
  const podeExportar = canCompare;

  /**
   * Exportar é exportar o QUE A TELA ESTÁ MOSTRANDO (#4802, item 5): o
   * atendente escolhido no filtro viaja na query, e o arquivo sai com os MESMOS
   * números da tabela abaixo — a rota chama a mesma leitura desta tela
   * (`lib/relatorios/vendas.ts`), não um recálculo. O
   * `Content-Disposition: attachment` da resposta faz o navegador baixar, o
   * mesmo gesto do "Exportar CSV" de Contatos e do Audit Log.
   */
  const exportarVendas = () => {
    window.location.href = urlDaExportacao(selectedOwner);
  };

  // A meta é MENSAL e a janela é o mês corrente de quem está olhando a tela
  // (o mês é o dele, não um instante UTC — ver `lib/metas/periodo.ts`). Fixada
  // uma vez por montagem: remontar a cada render refaria o pedido sem mudança
  // nenhuma de dado.
  const [janelaDaMeta] = useState(() => janelaDoMes(mesLocal()));
  const metasDoMes = useMetasDoMes(janelaDaMeta);
  // #4796: a meta do vendedor precisa de NOME no painel. A lista da equipe é a
  // mesma que o filtro de atendente já carrega; quem não pode vê-la (agent) cai
  // no rótulo genérico "Vendedor", porque o número continua valendo.
  const nomesDaEquipe = Object.fromEntries(
    (team.data?.data ?? []).map((membro) => [
      membro.user_id,
      rotuloDoMembro(
        { full_name: membro.full_name, email: membro.email, user_id: membro.user_id },
        t,
      ),
    ]),
  );
  const estadoDaMeta: EstadoDaMeta = metasDoMes.isLoading
    ? "carregando"
    : metasDoMes.isError || !metasDoMes.data
      ? "erro"
      : metasDoMes.data.data.motivo === "sem_meta"
        ? "vazio"
        : "ok";

  // ─── CARREGANDO: a SILHUETA da tela, não a palavra "Carregando…" ──────────
  //
  // Era `<p>Carregando…</p>`: uma linha de texto cinza no alto de uma tela
  // vazia. Esqueleto com a forma certa faz a espera parecer continuação;
  // retângulo genérico — ou uma frase — faz parecer que a página trocou. É o
  // que o resto do produto já faz (`app/app/kanban/loading.tsx` desenha 5
  // colunas × 3 cards, `components/agenda/estados.tsx` desenha a grade).
  //
  // As três faixas abaixo são as três seções reais: o filtro de atendente, os
  // painéis de atrito/perdas/previsão, e a tabela por atendente.
  if (isLoading) {
    return (
      <div
        className="flex flex-col gap-6"
        aria-busy="true"
        aria-label={t("Carregando o desempenho")}
      >
        {canCompare ? <Skeleton className="h-10 w-64" /> : null}
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // ─── ERRO: diz o que houve e oferece saída ────────────────────────────────
  //
  // Era `<p class="text-destructive">Erro ao carregar métricas.</p>` — uma frase
  // vermelha solta no alto de uma tela em branco, sem ícone, sem explicação e
  // sem nada para clicar. Visto na captura de 360px: a tela inteira era o
  // título, a descrição e aquela linha.
  //
  // O `EmptyState` da casa é o mesmo componente que as telas vazias usam, então
  // a tela de erro passa a ter a mesma forma das outras — e um "Tentar de novo"
  // que de fato refaz a consulta, em vez de pedir F5.
  if (isError || !data) {
    return (
      <EmptyState
        icon={WarningOctagon}
        headline="Não consegui carregar o desempenho"
        subcopy="Pode ser uma falha de rede, ou este painel pode não estar incluído no plano da sua empresa."
        primary={{ label: t("Tentar de novo"), onClick: () => void refetch() }}
      />
    );
  }

  const metrics = data.data;
  const funnelTotal = metrics.funnel.reduce((acc, s) => acc + s.count, 0);
  const maxCount = Math.max(1, ...metrics.funnel.map((s) => s.count));

  return (
    <div className="flex flex-col">
      {/* Barra de controles: só o filtro de atendente, direto na página e sem
          moldura. A régua do abandono NÃO sobe para cá de propósito: ela mora
          no cabeçalho do Atrito, ao lado do número que governa, e o Atrito não
          segue este filtro — juntar os dois diria o contrário. */}
      {canCompare ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-4">
          <span className="text-xs text-text-muted">{t("Atendente")}</span>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-full sm:w-60">
              <SelectValue placeholder={t("Todos os atendentes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("Todos os atendentes")}</SelectItem>
              {(team.data?.data ?? [])
                .filter((m) => m.role !== "viewer")
                .map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {rotuloDoMembro(m, t)}
                    {m.user_id === currentUserId ? ` ${t("(você)")}` : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {/*
            A porta do RELATÓRIO para fora da tela (#4802, item 5). Fica colada
            no filtro de propósito: é o recorte VISÍVEL que sai no arquivo, e um
            botão longe do filtro sugeriria que o arquivo é sempre o mundo
            inteiro. O plano de papel é o mesmo da rota — agent não vê a porta.
          */}
          {podeExportar ? (
            <Button variant="outline" onClick={exportarVendas}>
              <DownloadSimple size={16} weight="bold" aria-hidden />
              <span>{t("Exportar vendas")}</span>
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Os painéis são separados por espaço e uma divisória, não por caixa:
          cartão só onde agrupa tabela ou gráfico. */}
      <div className="flex flex-col divide-y divide-border *:py-8 *:first:pt-6 *:last:pb-2">
        {/* Acima do funil e da performance de propósito: é o número do sistema
            inteiro, ao qual as métricas de área se subordinam (doutrina §3.6).
            Não filtra por atendente — atrito é propriedade do sistema, e quebrá-lo
            por pessoa convida a otimização local que degrada o todo. */}
        <AtritoPanel podeEditarRegua={canCompare} />

        {/* Relatório "Perdas" (#1537): manager+, porque é o funil inteiro — o
            mesmo critério do /metrics para quem compara. */}
        {canCompare ? <PerdasPanel /> : null}

        {/* Previsão ponderada do funil (issue #1535): por mês × moeda, com os
            baldes "sem data" e "sem probabilidade" à parte. Depois do atrito de
            propósito — é o número da EQUIPE comercial, que se subordina ao do
            sistema inteiro acima. */}
        <PrevisaoPanel />

        {/* A meta do mês (issue #3025, fatia 1) logo acima do funil: é o ALVO, e
            as barras do funil abaixo são o caminho até ele. O denominador é da
            empresa (não do atendente filtrado), então este painel não segue o
            `Select` — o alvo é um só, e o realizado é o que a empresa fechou.
            `canCompare` (manager+) abre a porta do cadastro, a mesma régua da
            action. */}
        <MetaDoMesPanel
          estado={estadoDaMeta}
          periodo={metasDoMes.data?.data.periodo ?? null}
          metas={metasDoMes.data?.data.metas ?? []}
          podeConfigurar={canCompare}
          valores={metasDoMes.data?.data.valores_do_periodo ?? null}
          nomes={nomesDaEquipe}
        />

        <section className="flex flex-col gap-4">
          <TituloDeSecao titulo={`${t("Funil")}${selectedOwner ? ` ${t("do atendente")}` : ""}`} />
          <div>
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{funnelTotal}</p>
            <p className="text-xs text-text-muted">
              {funnelTotal === 1 ? t("aberto") : t("abertos")}
            </p>
          </div>
          {metrics.funnel.length === 0 ? (
            <p className="text-sm text-text-muted">{t("Nenhuma etapa configurada.")}</p>
          ) : (
            <ul className="flex max-w-3xl flex-col gap-2.5">
              {metrics.funnel.map((s) => (
                <li key={s.stage_id} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-sm md:w-40">{s.stage_name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                    <div
                      className="h-full rounded-full bg-accent transition-[width]"
                      style={{ width: `${(s.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
                    {s.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Card>
          <TituloDeSecao
            className={CABECALHO_DE_CARTAO}
            titulo={canCompare ? t("Performance por atendente") : t("Sua performance")}
          />
          {metrics.attendants.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted">
              {t("Sem atividade no período (ganhos/perdidos, conversas ou respostas).")}
            </p>
          ) : (
            <Table className="max-md:block">
              <TableHeader className="max-md:hidden">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{t("Atendente")}</TableHead>
                  <TableHead className="text-right">{t("Ganhos")}</TableHead>
                  <TableHead className="text-right">{t("Perdidos")}</TableHead>
                  <TableHead className="text-right">{t("Conversas")}</TableHead>
                  <TableHead className="pr-4 text-right">{t("1ª resposta (média / mediana)")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="max-md:block">
                {metrics.attendants.map((a) => (
                  <TableRow
                    key={a.user_id}
                    className="max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:px-4 max-md:py-3"
                  >
                    <TableCell className="pl-4 font-medium max-md:col-span-2 max-md:p-0">
                      {attendantLabel(a, t)}
                      {a.user_id === currentUserId ? (
                        <span className="font-normal text-text-muted"> {t("(você)")}</span>
                      ) : null}
                    </TableCell>
                    <TableCell data-rotulo={t("Ganhos")} className={CELULA_DE_NUMERO}>
                      {a.won}
                    </TableCell>
                    <TableCell data-rotulo={t("Perdidos")} className={CELULA_DE_NUMERO}>
                      {a.lost}
                    </TableCell>
                    <TableCell data-rotulo={t("Conversas")} className={CELULA_DE_NUMERO}>
                      {a.conversations_handled}
                    </TableCell>
                    <TableCell
                      data-rotulo={t("1ª resposta (média / mediana)")}
                      className={`${CELULA_DE_NUMERO} pr-4 max-md:col-span-2`}
                    >
                      {formatarDuracao(a.avg_first_response_seconds)} ·{" "}
                      {formatarDuracao(a.median_first_response_seconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Relatório "Por canal" (issue #2390): o mesmo corte de período e de
            atendente da página, agora pelo NÚMERO — a unidade de trabalho da
            operação (rodízio #1330). Fora do filtro de atendente a RLS é quem
            escopa: agent vê as próprias conversas, manager+ a organização. */}
        <CanaisPanel owner={selectedOwner} />
        <SeriePanel funis={funis} />
      </div>
    </div>
  );
}
