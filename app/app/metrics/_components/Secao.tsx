import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * O cabeçalho de cada painel do Desempenho: título pequeno e forte, a contagem
 * ao lado em tom de dado, a explicação embaixo em texto secundário, e a ação
 * (seletor, botão) à direita. Os textos chegam já traduzidos por quem chama.
 *
 * Fora de cartão (Atrito, Meta, Funil) ele abre a seção; dentro de cartão
 * (tabelas e gráfico) o chamador passa `className` com a borda e o recuo.
 */
export function TituloDeSecao({
  titulo,
  contagem,
  descricao,
  acao,
  className,
}: {
  titulo: ReactNode;
  contagem?: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">
          {titulo}
          {contagem !== undefined ? (
            <span className="ml-2 font-normal text-text-muted tabular-nums">{contagem}</span>
          ) : null}
        </h2>
        {descricao ? <p className="mt-0.5 text-xs text-text-muted">{descricao}</p> : null}
      </div>
      {acao}
    </div>
  );
}

/** Cabeçalho de cartão: a mesma hierarquia, com a divisória que separa a tabela. */
export const CABECALHO_DE_CARTAO = "border-b border-border px-4 py-3";
