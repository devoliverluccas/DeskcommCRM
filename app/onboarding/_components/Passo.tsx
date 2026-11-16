import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * As peças de composição dos passos do wizard — sem texto próprio.
 *
 * Cada passo é uma PÁGINA, não um cartão: título forte, subtítulo, blocos
 * separados por espaço e divisória, e o mesmo rodapé de ações em todos. Estas
 * peças só desenham; quem traduz é quem chama (`traduzir` no servidor, `t` no
 * cliente), por isso servem às duas metades sem `"use client"`.
 */

/** O `<header>` do passo. O do layout é o PRIMEIRO do DOM; este é o segundo. */
export function CabecalhoDoPasso({
  titulo,
  subtitulo,
  children,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-2 pb-8">
      <h2 className="text-2xl font-semibold tracking-tight text-text">{titulo}</h2>
      {subtitulo ? (
        <p className="max-w-prose text-sm leading-relaxed text-text-muted">{subtitulo}</p>
      ) : null}
      {children}
    </header>
  );
}

/** Um bloco do passo: separado do anterior por espaço e divisória. */
export function BlocoDoPasso({
  titulo,
  descricao,
  children,
  className,
  ...resto
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section
      className={cn("space-y-4 border-t border-border py-8 first:border-t-0 first:pt-0", className)}
      {...resto}
    >
      {titulo || descricao ? (
        <div className="space-y-1">
          {titulo ? <h3 className="text-sm font-semibold text-text">{titulo}</h3> : null}
          {descricao ? <p className="text-sm text-text-muted">{descricao}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * O rodapé de ações, igual em todos os passos: a saída discreta ("Pular") à
 * esquerda, a ação primária à direita. No celular a primária vem por cima e em
 * largura total — é o botão que a pessoa mais precisa achar.
 */
export function RodapeDoPasso({
  secundaria,
  children,
  className,
}: {
  secundaria?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [&>button]:w-full sm:[&>button]:w-auto">
        {secundaria}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
        {children}
      </div>
    </div>
  );
}

const TONS = {
  aviso: "bg-warning-bg text-warning-fg",
  sucesso: "bg-success-bg text-success-fg",
  info: "bg-info-bg text-info-fg",
  neutro: "bg-surface-elevated text-text",
} as const;

/** Aviso com os tokens de estado — nunca cor crua. `role` passa adiante. */
export function AvisoDoPasso({
  tom,
  className,
  children,
  ...resto
}: { tom: keyof typeof TONS } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-2 rounded-lg p-4 text-sm", TONS[tom], className)} {...resto}>
      {children}
    </div>
  );
}

/**
 * Cartão de escolha: `<label>` embrulhando o `<input>` nativo (rádio). A borda
 * accent e o fundo `accent-soft` marcam o selecionado; o resto é neutro.
 */
export function cartaoDeEscolha(marcado: boolean): string {
  return cn(
    "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-bg",
    marcado ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong hover:bg-hover",
  );
}
