"use client";

/**
 * Aba "Origens" (3.6): de onde vêm os negócios do período e quais fecham. Lê
 * `/api/v1/metrics/funil` (a conta é `calcularOrigem`), com o mesmo escopo
 * da Análise do funil: a RLS de `crm_leads` decide o que cada um vê.
 */
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { RelatorioDeFunil } from "@/lib/metrics/funil";
import { CABECALHO_DE_CARTAO, TituloDeSecao } from "@/app/app/metrics/_components/Secao";

import { origensPorLinha } from "../_lib/origens";
import { instantesDoPeriodo, type Periodo } from "../_lib/periodo";
import { BotaoCsv, Carregando, ErroDaAba } from "./comum";

const SEM_ORIGEM = "sem origem";
const CELULA = "text-right tabular-nums";

function dinheiro(cents: number, moeda: string, tag: string): string {
  try {
    return (cents / 100).toLocaleString(tag, { style: "currency", currency: moeda });
  } catch {
    // "sem moeda" (negócio sem `currency`) não é código ISO: número cru com o rótulo.
    return `${(cents / 100).toLocaleString(tag, { minimumFractionDigits: 2 })} ${moeda}`;
  }
}

export function AbaOrigens({ periodo, fuso }: { periodo: Periodo; fuso: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { from, to } = instantesDoPeriodo(periodo, fuso);
  const consulta = useQuery({
    queryKey: ["relatorios", "origens", from, to],
    queryFn: () =>
      apiClient.get<{ data: RelatorioDeFunil & { truncado?: boolean } }>(
        `/api/v1/metrics/funil?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });

  if (consulta.isLoading) return <Carregando />;
  if (consulta.isError || !consulta.data) return <ErroDaAba tentar={() => void consulta.refetch()} />;
  const linhas = origensPorLinha(consulta.data.data.origem?.linhas ?? []);
  const nomeDaOrigem = (o: string) => (o === SEM_ORIGEM ? t("Sem origem") : o);
  const ganho = (l: (typeof linhas)[number]) =>
    l.ganhoPorMoeda.length === 0 ? "—" : l.ganhoPorMoeda.map((b) => dinheiro(b.valor_cents, b.moeda, tag)).join(" · ");
  const cabecalho = [t("Origem"), t("Abertos"), t("Ganhos"), t("Perdidos"), t("Total"), t("Valor ganho")];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <p className="max-w-3xl text-xs text-text-muted">
        {t("Negócios criados ou encerrados no período, pela origem gravada no negócio.")}
      </p>
      <Card>
        <TituloDeSecao
          className={CABECALHO_DE_CARTAO}
          titulo={t("Negócios por origem")}
          contagem={linhas.length}
          acao={
            <BotaoCsv
              nome={`origens-${periodo.de}-${periodo.ate}`}
              cabecalho={cabecalho}
              linhas={linhas.map((l) => [nomeDaOrigem(l.origem), l.abertos, l.ganhos, l.perdidos, l.total, ganho(l)])}
            />
          }
        />
        {linhas.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-muted">{t("Nenhum negócio no período.")}</p>
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
                {linhas.map((l) => (
                  <TableRow key={l.origem}>
                    <TableCell className="pl-4 font-medium">{nomeDaOrigem(l.origem)}</TableCell>
                    <TableCell className={CELULA}>{l.abertos}</TableCell>
                    <TableCell className={CELULA}>{l.ganhos}</TableCell>
                    <TableCell className={CELULA}>{l.perdidos}</TableCell>
                    <TableCell className={`${CELULA} font-medium`}>{l.total}</TableCell>
                    <TableCell className={`${CELULA} pr-4`}>{ganho(l)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {consulta.data.data.truncado ? (
        <p className="text-xs text-text-muted">{t("O período tem negócios demais: a conta usa os mais recentes.")}</p>
      ) : null}
    </div>
  );
}
