import {
  probabilidadeDoLead,
  type EtapaDaPrevisao,
  type LeadDaPrevisao,
} from "@/lib/leads/previsao";
import { MOEDA_PADRAO, somaPorMoeda } from "@/lib/money";
import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

/**
 * O TOTAL DO FUNIL (fase 1, item 1.6): "N negócios · R$ total · ponderado R$ X".
 *
 * É a SOMA DAS COLUNAS, e não outra conta: a mesma moeda por negócio
 * (`currency` nulo conta como `MOEDA_PADRAO`, que é o que o card mostra), o
 * mesmo `somaPorMoeda` (moedas nunca se somam) e a mesma régua de chance —
 * `probabilidadeDoLead` com a fonte `etapa`, que dá 100 ao ganho, 0 à perda e o
 * `win_probability` à etapa de espera, exatamente o que `StageColumn` escreve
 * no "ponderado" de cada coluna. Arredonda por negócio, como a coluna.
 *
 * Negócio em etapa SEM chance calibrada não entra no ponderado (nem como zero):
 * a coluna dele também não mostra ponderado. `semChance` diz quantos ficaram de
 * fora, para a tela não apresentar a parte como o todo.
 */
export interface TotaisDoFunil {
  negocios: number;
  bruto: Map<string, number>;
  ponderado: Map<string, number>;
  /** Negócios com valor cuja etapa não tem chance calibrada. */
  semChance: number;
  /** A moeda que abre o texto — a com mais negócios com valor, como na coluna. */
  primeira: string | undefined;
}

function etapaDaPrevisao(stage: Stage): EtapaDaPrevisao {
  return {
    id: stage.id,
    name: stage.name,
    is_won: stage.is_won,
    is_lost: stage.is_lost,
    win_probability: stage.win_probability ?? null,
  };
}

/** A chance (0–100) que a coluna do negócio usa, ou `null` sem calibração. */
export function chanceDaEtapa(lead: Lead, stage: Stage | undefined): number | null {
  return probabilidadeDoLead(
    lead as unknown as LeadDaPrevisao,
    stage ? etapaDaPrevisao(stage) : undefined,
    "etapa",
  );
}

export function totaisDoFunil(leads: readonly Lead[], stages: readonly Stage[]): TotaisDoFunil {
  const porId = new Map(stages.map((s) => [s.id, s]));
  const moedaDoLead = (l: Lead) => l.currency ?? MOEDA_PADRAO;
  const bruto = somaPorMoeda(leads, (l) => l.value_cents, moedaDoLead);
  let semChance = 0;
  const ponderado = somaPorMoeda(
    leads,
    (l) => {
      if (l.value_cents == null) return null;
      const chance = chanceDaEtapa(l, porId.get(l.stage_id));
      if (chance === null) {
        semChance += 1;
        return null;
      }
      return Math.round((l.value_cents * chance) / 100);
    },
    moedaDoLead,
  );
  const primeira = [
    ...somaPorMoeda(leads, (l) => (l.value_cents == null ? null : 1), moedaDoLead),
  ].sort(([ma, na], [mb, nb]) => nb - na || ma.localeCompare(mb))[0]?.[0];
  return { negocios: leads.length, bruto, ponderado, semChance, primeira };
}
