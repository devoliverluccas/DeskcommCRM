/**
 * O MONITORAMENTO DO PAINEL (3.5) — as contas, separadas do React.
 *
 * O bloco "Fila por setor" não tem rota própria: ele pede a MESMA contagem do
 * Inbox (`GET /api/v1/conversations/counts`), uma vez para o total e uma vez
 * por setor (`?sector_id=`). É de propósito — a fila do painel e o número da
 * aba Fila têm de ser o mesmo número, e uma segunda régua de "quem espera"
 * divergiria na primeira correção (`tests/unit/fila-tem-uma-definicao-so.test.ts`).
 *
 * "Em atendimento" é o que sobra das conversas vivas depois de tirar quem
 * espera gente (Fila) e quem está com o automático: vivas = todas − fechadas −
 * arquivadas (os dois status terminais, `CONVERSATION_TERMINAL_STATUSES`).
 */

/** O pedaço da resposta de `/conversations/counts` que o monitoramento lê. */
export interface ContagemDaFila {
  fila?: number;
  automatico?: number;
  all?: number;
  closed?: number;
  archived?: number;
  fila_mais_antiga_desde?: string | null;
}

export interface LinhaDaFila {
  naFila: number;
  emAtendimento: number;
  /** Desde quando espera a conversa mais antiga da fila; `null` sem fila. */
  esperaDesde: string | null;
}

const n = (v: number | undefined) => (Number.isFinite(v) ? Math.max(0, Number(v)) : 0);

export function linhaDaFila(c: ContagemDaFila | null | undefined): LinhaDaFila {
  const vivas = n(c?.all) - n(c?.closed) - n(c?.archived);
  const naFila = n(c?.fila);
  return {
    naFila,
    // Nunca negativo: as contagens são consultas separadas, e uma conversa que
    // muda de estado entre elas não pode virar "-1 em atendimento".
    emAtendimento: Math.max(0, vivas - naFila - n(c?.automatico)),
    esperaDesde: naFila > 0 ? (c?.fila_mais_antiga_desde ?? null) : null,
  };
}

/** O pedaço do roster (`/attendants/availability`) que o bloco de operadores lê. */
export interface OperadorDoRoster {
  user_id: string;
  role: string | null;
  name: string | null;
  email: string | null;
  present: boolean;
  is_available: boolean;
  current_load: number;
}

/**
 * Quem atende: `viewer` fica fora (não atende). Online primeiro; dentro de
 * cada grupo, quem carrega mais conversas abertas em cima — é quem o gestor
 * procura quando a fila cresce.
 */
export function operadoresDoPainel<O extends OperadorDoRoster>(roster: readonly O[]): O[] {
  return roster
    .filter((o) => o.role !== "viewer")
    .sort((a, b) => {
      if (a.present !== b.present) return a.present ? -1 : 1;
      return (b.current_load ?? 0) - (a.current_load ?? 0);
    });
}
