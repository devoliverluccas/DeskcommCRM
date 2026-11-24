/**
 * O SLA DE UMA CONVERSA — a conta do selo, pura e com `agora` por parâmetro.
 *
 * ## Duas metas, uma de cada vez
 *
 * - **primeira resposta**: o atendimento corrente ainda não teve resposta e o
 *   cliente está esperando. A espera parte de `esperaDaConversa` — o MESMO
 *   instante que ordena a Fila e que a pílula "Aguardando há…" mostra. Uma
 *   segunda régua aqui seria a linha dizendo "faltam 3 min" ao lado de uma
 *   pílula dizendo "aguardando há 2 horas".
 * - **resolução**: depois da primeira resposta (ou quando só há meta de
 *   resolução), o relógio corre desde o começo do atendimento
 *   (`service_started_at`, ou a criação para o primeiro atendimento da conversa,
 *   que o banco não carimba).
 *
 * ## O expediente
 *
 * O tempo fora do horário do setor não conta. O horário é o MESMO objeto que a
 * fila usa para rotear (`attendant_sectors.schedule`, avaliado por
 * `isWithinSchedule` / `localMoment` em `lib/routing/eligibility.ts`): janela
 * vazia é 24/7, como lá.
 *
 * ## Quando não há selo (`null`)
 *
 * Sem meta aplicável, conversa encerrada, SLA ignorado por um gestor, ou cliente
 * que nunca escreveu. "Sem selo" é o comportamento de antes desta fatia.
 */
import type { AvailabilitySchedule } from "@/lib/schemas/routing";
import type { MetasDoPar } from "@/lib/schemas/settings";
import { localMoment } from "@/lib/routing/eligibility";

import { esperaDaConversa, STATUS_ENCERRADOS } from "./comando-da-conversa";

export type Expediente = Pick<AvailabilitySchedule, "timezone" | "windows"> | null | undefined;

/** A partir de que fração do prazo o selo aparece ainda dentro do prazo. */
export const FRACAO_PERTO_DE_ESTOURAR = 0.8;

const MINUTO = 60_000;
const MINUTOS_NA_SEMANA = 7 * 24 * 60;
/** Teto de passos do laço do expediente — ~2 por janela por dia, folgado. */
const MAX_PASSOS = 5_000;

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Quanto tempo de EXPEDIENTE há entre `inicio` e `fim`, em ms.
 *
 * Anda de fronteira em fronteira, não de minuto em minuto: dentro de uma janela
 * pula até o fim dela; fora, pula até o começo da próxima. Cada passo custa um
 * `localMoment` (um `Intl.DateTimeFormat`), e uma semana inteira de espera é
 * uma dúzia de passos — a lista monta isto para 50 linhas por render.
 *
 * Na virada do horário de verão o salto pode errar por até uma hora num passo;
 * o passo seguinte relê o relógio local e se corrige. Nunca anda para trás.
 */
export function tempoDeExpedienteMs(inicio: Date, fim: Date, expediente: Expediente): number {
  const total = fim.getTime() - inicio.getTime();
  if (total <= 0) return 0;
  const janelas = expediente?.windows ?? [];
  if (janelas.length === 0) return total;
  const fuso = expediente?.timezone || "America/Sao_Paulo";

  let t = inicio.getTime();
  const alvo = fim.getTime();
  let util = 0;
  for (let passo = 0; t < alvo && passo < MAX_PASSOS; passo++) {
    const { dow, hhmm } = localMoment(new Date(t), fuso);
    const agoraNaSemana = dow * 1440 + minutos(hhmm);
    // O que sobra do minuto corrente: o relógio local só tem hora e minuto.
    const noMinuto = ((t % MINUTO) + MINUTO) % MINUTO;

    const dentro = janelas.find((j) => {
      const ini = j.dow * 1440 + minutos(j.start);
      const fimJ = j.dow * 1440 + minutos(j.end);
      return agoraNaSemana >= ini && agoraNaSemana < fimJ;
    });
    if (dentro) {
      const fimDaJanela = t + (dentro.dow * 1440 + minutos(dentro.end) - agoraNaSemana) * MINUTO - noMinuto;
      const ate = Math.min(fimDaJanela, alvo);
      util += ate - t;
      t = ate;
      continue;
    }
    let proxima = Infinity;
    for (const j of janelas) {
      const ini = j.dow * 1440 + minutos(j.start);
      const delta = (ini - agoraNaSemana + MINUTOS_NA_SEMANA) % MINUTOS_NA_SEMANA;
      if (delta > 0 && delta < proxima) proxima = delta;
    }
    if (!Number.isFinite(proxima)) break;
    t = Math.min(t + proxima * MINUTO - noMinuto, alvo);
  }
  return util;
}

/** "5d 6h", "3h 20min", "12min" — dois termos no máximo, sem segundos. */
export function duracaoCurta(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / MINUTO));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

/** As colunas de que o selo precisa — todas já vêm na linha da lista. */
export interface FatosDoSla {
  status: string;
  sector_id?: string | null;
  awaiting_since?: string | null;
  last_inbound_at?: string | null;
  last_outbound_at?: string | null;
  created_at?: string | null;
  service_started_at?: string | null;
  /** Ausente (cache antigo, coluna fora do SELECT) = conta. */
  sla_ignorado_em?: string | null;
}

export type TipoDoSla = "primeira_resposta" | "resolucao";

export interface EstadoDoSla {
  tipo: TipoDoSla;
  estourado: boolean;
  /** Já passou de `FRACAO_PERTO_DE_ESTOURAR` do prazo (inclui o estourado). */
  perto: boolean;
  /** Fração do prazo consumida (1 = no limite). */
  fracao: number;
  /** Quanto falta, quando dentro do prazo (0 quando estourado). */
  restanteMs: number;
  /** Quanto passou do prazo, quando estourado (0 quando dentro). */
  excedidoMs: number;
  /** "+5d 6h" estourado; "faltam 12min" dentro. */
  rotulo: string;
}

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const v = new Date(iso).getTime();
  return Number.isNaN(v) ? null : v;
};

/**
 * Em que pé está o SLA desta conversa, ou `null` quando não há selo a mostrar.
 */
export function estadoDoSla({
  conversa,
  metas,
  agora,
  expediente,
  t = (texto) => texto,
}: {
  conversa: FatosDoSla;
  /** As metas que valem para a conversa (`metasDoSetor`). */
  metas: MetasDoPar;
  agora: Date;
  expediente?: Expediente;
  t?: (texto: string) => string;
}): EstadoDoSla | null {
  if (metas.primeira_resposta_min == null && metas.resolucao_horas == null) return null;
  if (STATUS_ENCERRADOS.has(conversa.status)) return null;
  if (conversa.sla_ignorado_em) return null;
  // Sem mensagem do cliente não há o que cumprir.
  if (!conversa.last_inbound_at && !conversa.awaiting_since) return null;

  const comeco = ms(conversa.service_started_at) ?? ms(conversa.created_at);
  const ultimaResposta = ms(conversa.last_outbound_at);
  const respondidaNoAtendimento =
    ultimaResposta !== null && (comeco === null || ultimaResposta >= comeco);

  let tipo: TipoDoSla;
  let desde: number | null;
  let prazoMs: number;
  if (!respondidaNoAtendimento && metas.primeira_resposta_min != null) {
    tipo = "primeira_resposta";
    desde = ms(esperaDaConversa(conversa));
    prazoMs = metas.primeira_resposta_min * MINUTO;
  } else if (metas.resolucao_horas != null) {
    tipo = "resolucao";
    desde = comeco;
    prazoMs = metas.resolucao_horas * 60 * MINUTO;
  } else {
    return null;
  }
  if (desde === null) return null;

  const gasto = tempoDeExpedienteMs(new Date(desde), agora, expediente);
  const fracao = gasto / prazoMs;
  const estourado = gasto > prazoMs;
  const restanteMs = estourado ? 0 : prazoMs - gasto;
  const excedidoMs = estourado ? gasto - prazoMs : 0;
  return {
    tipo,
    estourado,
    perto: fracao >= FRACAO_PERTO_DE_ESTOURAR,
    fracao,
    restanteMs,
    excedidoMs,
    rotulo: estourado ? `+${duracaoCurta(excedidoMs)}` : `${t("faltam")} ${duracaoCurta(restanteMs)}`,
  };
}
