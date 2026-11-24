"use client";

/**
 * Peças comuns das abas de Relatórios: o botão de CSV, o número grande, a
 * mensagem de erro e a de carregando. Sem cartão em volta de tudo: a
 * hierarquia é peso, tamanho e espaço; cartão só onde agrupa tabela.
 */
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { DownloadSimple } from "@/lib/ui/icons";

import { baixarCsv, montarCsv, type Celula } from "../_lib/csv";

export function BotaoCsv({
  nome,
  cabecalho,
  linhas,
}: {
  nome: string;
  cabecalho: string[];
  linhas: Celula[][];
}) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={linhas.length === 0}
      onClick={() => baixarCsv(nome, montarCsv(cabecalho, linhas))}
    >
      <DownloadSimple aria-hidden />
      {t("Exportar CSV")}
    </Button>
  );
}

export function NumeroGrande({ rotulo, valor, detalhe }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{rotulo}</dt>
      <dd className="text-2xl font-semibold tracking-tight tabular-nums">{valor}</dd>
      {detalhe ? <dd className="text-xs text-text-muted">{detalhe}</dd> : null}
    </div>
  );
}

export function Carregando() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("Carregando")}>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function ErroDaAba({ tentar }: { tentar: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-3 py-6">
      <p className="text-sm text-error-fg">{t("Não foi possível carregar o relatório.")}</p>
      <Button variant="outline" size="sm" onClick={tentar}>
        {t("Tentar de novo")}
      </Button>
    </div>
  );
}

/** Uma barra horizontal proporcional (as distribuições e as séries). */
export function Barra({ valor, maximo, tom = "accent" }: { valor: number; maximo: number; tom?: "accent" | "muted" }) {
  return (
    <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
      <span
        className={`block h-full rounded-full ${tom === "accent" ? "bg-accent" : "bg-text-subtle"}`}
        style={{ width: `${maximo > 0 ? (valor / maximo) * 100 : 0}%` }}
      />
    </span>
  );
}
