/**
 * A aba "Origens" (3.6) lê a matriz origem × status que `calcularOrigem`
 * (`lib/metrics/funil.ts`) já monta para `/api/v1/metrics/funil` e a vira em
 * UMA linha por origem — a forma que a tabela e o CSV querem. Nenhuma conta
 * nova: o número é o da Análise do funil.
 */
import type { LinhaDeOrigem } from "@/lib/metrics/funil";

export interface OrigemResumida {
  origem: string;
  abertos: number;
  ganhos: number;
  perdidos: number;
  total: number;
  /** Valor GANHO por moeda — nunca somado entre moedas. */
  ganhoPorMoeda: Array<{ moeda: string; valor_cents: number }>;
}

export function origensPorLinha(linhas: readonly LinhaDeOrigem[]): OrigemResumida[] {
  const porOrigem = new Map<string, OrigemResumida>();
  for (const l of linhas) {
    const atual =
      porOrigem.get(l.origem) ??
      ({ origem: l.origem, abertos: 0, ganhos: 0, perdidos: 0, total: 0, ganhoPorMoeda: [] } as OrigemResumida);
    if (l.status === "won") {
      atual.ganhos += l.quantidade;
      for (const b of l.por_moeda) {
        if (b.valor_cents > 0) atual.ganhoPorMoeda.push({ moeda: b.moeda, valor_cents: b.valor_cents });
      }
    } else if (l.status === "lost") atual.perdidos += l.quantidade;
    else atual.abertos += l.quantidade;
    atual.total += l.quantidade;
    porOrigem.set(l.origem, atual);
  }
  return [...porOrigem.values()].sort((a, b) => b.total - a.total || b.ganhos - a.ganhos);
}
