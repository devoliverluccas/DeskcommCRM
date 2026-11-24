/**
 * A RÉGUA DA PESQUISA E A CONTA DO NPS (3.4) — o pedaço PURO da pesquisa de
 * satisfação, sem banco e sem envio.
 *
 * Mora fora de `./satisfacao.ts` porque a tela também o usa (o cartão de
 * Configurações e a aba de Relatórios fazem a mesma conta), e aquele módulo
 * puxa o envio de mensagem e a janela do canal — nada que deva ir ao navegador.
 */

/**
 * A régua da pergunta: `csat_1_5` é a de sempre e o padrão; `nps_0_10` é o
 * NPS. A régua é gravada no PEDIDO (`satisfacao_do_atendimento.escala`):
 * trocar a opção não reinterpreta resposta de pergunta já feita.
 */
export const ESCALAS_DA_SATISFACAO = ["csat_1_5", "nps_0_10"] as const;
export type EscalaDaSatisfacao = (typeof ESCALAS_DA_SATISFACAO)[number];
export const ESCALA_PADRAO: EscalaDaSatisfacao = "csat_1_5";

/** Valor desconhecido (ou ausente, como em todo pedido anterior à 9484) é o padrão. */
export function escalaValida(valor: unknown): EscalaDaSatisfacao {
  return (ESCALAS_DA_SATISFACAO as readonly unknown[]).includes(valor)
    ? (valor as EscalaDaSatisfacao)
    : ESCALA_PADRAO;
}

/** O resultado de UMA régua no período. */
export interface ResumoDaEscala {
  respostas: number;
  /** Média das notas daquela régua; `null` sem resposta. */
  media: number | null;
  /** Nota (texto) → quantas respostas. */
  notas: Record<string, number>;
}

export interface ResumoDaSatisfacao {
  /** Média só do CSAT (1–5). Média que misturasse as duas réguas não mediria nada. */
  media: number | null;
  respostas: number;
  pedidos: number;
  sem_nota: number;
  aguardando: number;
  /** Distribuição do CSAT (1–5) — o que a tela de 1 a 5 sempre leu. */
  notas: Record<string, number>;
  /** As duas réguas separadas; o NPS sai de `calcularNps(por_escala.nps_0_10.notas)`. */
  por_escala: Record<EscalaDaSatisfacao, ResumoDaEscala>;
}

/**
 * O NPS de uma distribuição de notas 0–10: % de promotores (9–10) menos % de
 * detratores (0–6), inteiro de −100 a 100. Neutros (7–8) contam no total e em
 * nenhum dos lados — é o que faz o NPS cair quando a nota "boa mas morna"
 * cresce. Sem resposta, `nps` é `null`: "não medido" não é zero.
 */
export interface ResultadoNps {
  nps: number | null;
  respostas: number;
  promotores: number;
  neutros: number;
  detratores: number;
}

export function calcularNps(notas: Record<string, number> | null | undefined): ResultadoNps {
  let promotores = 0;
  let neutros = 0;
  let detratores = 0;
  for (const [chave, bruto] of Object.entries(notas ?? {})) {
    const nota = Number(chave);
    const quantidade = Number(bruto);
    if (!Number.isInteger(nota) || nota < 0 || nota > 10) continue;
    if (!Number.isFinite(quantidade) || quantidade <= 0) continue;
    if (nota >= 9) promotores += quantidade;
    else if (nota >= 7) neutros += quantidade;
    else detratores += quantidade;
  }
  const respostas = promotores + neutros + detratores;
  return {
    nps: respostas === 0 ? null : Math.round(((promotores - detratores) / respostas) * 100),
    respostas,
    promotores,
    neutros,
    detratores,
  };
}
