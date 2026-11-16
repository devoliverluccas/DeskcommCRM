"use client";

import { usePathname } from "next/navigation";
import { useT } from "@/hooks/i18n/useT";

import { Check } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export interface PassoVisivel {
  segmento: string;
  rotulo: string;
  cumprido: boolean;
}

/** O passo atual sai da ROTA — ver o cabeçalho de `Stepper`. */
function usePassoAtual(passos: PassoVisivel[]): number {
  const pathname = usePathname() ?? "";
  return passos.findIndex((p) => pathname.includes(`/${p.segmento}`));
}

/**
 * O indicador de progresso.
 *
 * Duas coisas mudaram, e as duas eram defeito:
 *
 * 1. A lista era FIXA aqui dentro. Ela mostrava "Loja" mesmo quando a
 *    integração estava desligada — o padrão de toda instalação pelo kit — e a
 *    pessoa via um passo que nunca lhe seria oferecido. Agora os passos chegam
 *    de `lib/onboarding/passos.ts`, a mesma fonte que decide a ordem e monta o
 *    resumo final.
 *
 * 2. "Concluído" era `índice < atual`: bastava estar num passo adiante para os
 *    anteriores ficarem verdes, inclusive os que a pessoa pulou e os que nunca
 *    apareceram. Agora quem responde é o estado gravado.
 *
 * O passo ATUAL continua saindo da rota — o header `x-pathname` que alimentava
 * isso antes nunca era escrito por ninguém, e o indicador ficava travado no
 * primeiro passo o wizard inteiro.
 *
 * Lista VERTICAL no trilho lateral (a partir de `lg`), com o rótulo sempre
 * visível: os rótulos são frases (`Quem trabalha com ele`), e na fila
 * horizontal de antes eles sumiam no celular. Abaixo de `lg` quem fala é
 * `ProgressoCompacto`.
 */
export function Stepper({ passos }: { passos: PassoVisivel[] }) {
  const t = useT();
  const idx = usePassoAtual(passos);

  return (
    <ol aria-label="onboarding steps" className="space-y-0.5">
      {passos.map((p, i) => {
        const isActive = i === idx;
        return (
          <li
            key={p.segmento}
            aria-current={isActive ? "step" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
              isActive ? "bg-pressed font-medium text-text" : p.cumprido ? "text-text" : "text-text-muted",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                isActive && "border-text bg-text text-bg",
                !isActive && p.cumprido && "border-success bg-success-bg text-success-fg",
                !isActive && !p.cumprido && "border-border-strong",
              )}
            >
              {p.cumprido && !isActive ? <Check size={11} weight="bold" /> : i + 1}
            </span>
            <span className="min-w-0">{t(p.rotulo)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Abaixo de `lg`: barra fina e "Passo N de M · rótulo". Decorativa para o
 * leitor de tela — a lista acima continua no DOM com o `aria-current`.
 */
export function ProgressoCompacto({ passos }: { passos: PassoVisivel[] }) {
  const t = useT();
  const idx = usePassoAtual(passos);
  const total = passos.length;
  // Fora de um passo (a tela final), a barra mostra o que foi cumprido.
  const feitos = idx >= 0 ? idx : passos.filter((p) => p.cumprido).length;
  const atual = idx >= 0 ? passos[idx] : null;

  return (
    <div aria-hidden className="space-y-1.5 px-4 pb-3">
      <div className="h-1 overflow-hidden rounded-full bg-pressed">
        <div
          className="h-full rounded-full bg-text transition-[width] duration-slow ease-out"
          style={{ width: `${total ? ((feitos + (atual ? 1 : 0)) / total) * 100 : 0}%` }}
        />
      </div>
      {atual ? (
        <p className="truncate text-xs text-text-muted">
          {t("Passo")} {idx + 1} {t("de")} {total} · <span className="text-text">{t(atual.rotulo)}</span>
        </p>
      ) : null}
    </div>
  );
}
