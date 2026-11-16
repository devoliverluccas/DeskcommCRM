"use client";

/**
 * Relatório "PERDAS" (issue #1537) — por motivo, por categoria e pela etapa de
 * onde o negócio saiu, em quantidade e em valor POR MOEDA.
 *
 * As tabelas são as chaves de `agruparPerdas`, na ordem que ela devolve (maior
 * primeiro): a conta mora em `lib/metrics/perdas.ts`, testada, e esta tela só
 * apresenta — reimplementar a soma aqui faria a tela e o teste dizerem coisas
 * diferentes.
 *
 * Só manager+ (a rota é manager+): é o funil inteiro, não o pedaço de quem
 * olha.
 */
import { useT } from "@/hooks/i18n/useT";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import { SEM_CATEGORIA, SEM_ETAPA, SEM_MOEDA, SEM_MOTIVO } from "@/lib/metrics/perdas";
import { usePerdasMetrics } from "@/hooks/metrics/usePerdasMetrics";
import { formatValorDoNegocio } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CABECALHO_DE_CARTAO, TituloDeSecao } from "./Secao";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formataMoeda(moeda: string, cents: number): string {
  if (!/^[A-Z]{3}$/.test(moeda)) return "—";
  return formatValorDoNegocio(cents, moeda);
}

/** Os rótulos que o SERVIDOR põe no lugar da ausência: texto do produto, traduzível. */
const SENTINELAS = new Set<string>([SEM_MOTIVO, SEM_CATEGORIA, SEM_ETAPA, SEM_MOEDA]);

function Bloco({
  titulo,
  linhas,
  coluna,
  rotulo = (chave) => chave,
}: {
  titulo: string;
  linhas: Array<{ chave: string; quantidade: number }>;
  coluna: string;
  /** O que exibir no lugar da chave; nome de etapa e motivo próprio são dado. */
  rotulo?: (chave: string) => string;
}) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-1">
      <h3 className="text-xs font-medium text-text-muted">{t(titulo)}</h3>
      {linhas.length === 0 ? (
        <p className="py-2 text-sm text-text-subtle">{t("Nenhuma perda na janela.")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-0">{t(coluna)}</TableHead>
              <TableHead className="pr-0 text-right">{t("Negócios")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((linha) => (
              <TableRow key={linha.chave}>
                <TableCell className="pl-0 max-md:wrap-anywhere md:truncate">
                  {SENTINELAS.has(linha.chave) ? t(linha.chave) : rotulo(linha.chave)}
                </TableCell>
                <TableCell className="pr-0 text-right font-medium tabular-nums">
                  {linha.quantidade}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function PerdasPanel() {
  const t = useT();
  const { data, isLoading, isError } = usePerdasMetrics();
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("Carregando…")}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError || !data)
    return <p className="text-sm text-error-fg">{t("Erro ao carregar o relatório de perdas.")}</p>;

  const relatorio = data.data;

  return (
    <Card>
      <TituloDeSecao
        className={CABECALHO_DE_CARTAO}
        titulo={t("Perdas")}
        descricao={
          <>
            {t("Por motivo, categoria e etapa de saída — quantidade e valor por moeda.")}
            {relatorio.truncado ? ` ${t("Cortado no limite de leitura.")}` : ""}
          </>
        }
      />
      <div className="grid gap-6 p-4 md:grid-cols-3 md:gap-8">
        <Bloco
          titulo="Por motivo"
          linhas={relatorio.porMotivo}
          coluna="Motivo"
          rotulo={(motivo) => {
            const canonico = rotuloDoMotivoDePerda(motivo);
            return canonico === motivo ? motivo : t(canonico);
          }}
        />
        <Bloco titulo="Por categoria" linhas={relatorio.porCategoria} coluna="Categoria" />
        <Bloco titulo="Por etapa de saída" linhas={relatorio.porEtapa} coluna="Etapa" />

        <div className="min-w-0 space-y-1 md:col-span-3">
          <h3 className="text-xs font-medium text-text-muted">{t("Valor por moeda")}</h3>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-0">{t("Moeda")}</TableHead>
                <TableHead className="text-right">{t("Negócios")}</TableHead>
                <TableHead className="pr-0 text-right">{t("Valor")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {relatorio.porMoeda.map((m) => (
                <TableRow key={m.moeda}>
                  <TableCell className="pl-0">{m.moeda === SEM_MOEDA ? t(SEM_MOEDA) : m.moeda}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.quantidade}</TableCell>
                  <TableCell className="pr-0 text-right font-medium tabular-nums">
                    {formataMoeda(m.moeda, m.valor_cents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-text-subtle">
            {t("Moedas nunca são somadas entre si: cada balde é o total da própria moeda.")}
          </p>
        </div>
      </div>
    </Card>
  );
}
