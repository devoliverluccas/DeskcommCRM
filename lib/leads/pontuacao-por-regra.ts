/**
 * PONTUAÇÃO POR REGRA (fase 4, item 4.5) — a regra num lugar só.
 *
 * "Pontos" é um número SEPARADO do score. O score (`lib/leads/score-formula.ts`)
 * continua sendo a fórmula de probabilidade de fechar, com a frase derivada do
 * cálculo; os pontos são o que a ORGANIZAÇÃO decidiu valorizar ("respondeu o
 * follow-up vale 10", "foi para a etapa Proposta vale 20"), cada parcela com
 * linha própria no extrato (`pontuacao_extrato`). Misturar os dois faria o score
 * perder o porquê que o torna discutível, e faria a regra da organização mudar
 * uma probabilidade que ela não calcula.
 *
 * ─── Quem pontua ─────────────────────────────────────────────────────────────
 *
 * Um consumidor do `event_log` (`pontuacao-por-regra.handler.ts`), sobre fatos
 * que JÁ são emitidos. Nunca um trigger: pontuar é ler regra, contato e negócio,
 * e isso não cabe dentro da transação de quem gravou a mensagem.
 *
 * ─── Idempotência ────────────────────────────────────────────────────────────
 *
 * Cada fato tem uma CHAVE (`chaveDoFato`) e o extrato é único por
 * (organização, regra, chave). O mesmo `lead.stage_changed` chega duas vezes (o
 * gatilho do banco e a rota de mover emitem o mesmo fato), o dreno reprocessa
 * depois de uma queda — e o contato continua com UMA linha. A chave também é a
 * regra de negócio: a etapa alcançada pontua uma vez por negócio, a etiqueta uma
 * vez por contato, o orçamento uma vez por proposta, o link uma vez por link (e
 * o link de saída já é POR contato — ver `links_de_saida_idempotencia_uniq`).
 */
import { z } from "zod";

/**
 * O vocabulário FECHADO de eventos que uma regra escuta — o MESMO do CHECK de
 * `regras_de_pontuacao.evento` (migrations 9492 e 9499). Só entra aqui fato que
 * o sistema já emite. `link_clicado` é o clique de GENTE num link rastreado de
 * saída (`/l/<codigo>`, migration 9490) que tem contato; a conversão de anúncio
 * por clique é outra coisa (é a origem da conversa, não um clique num link nosso).
 */
export const EVENTOS_DE_PONTUACAO = [
  "mensagem_recebida",
  "respondeu_followup",
  "agendamento_marcado",
  "orcamento_enviado",
  "orcamento_aceito",
  "etapa_alcancada",
  "tag_aplicada",
  "link_clicado",
] as const;

export type EventoDePontuacao = (typeof EVENTOS_DE_PONTUACAO)[number];

/** O rótulo de cada evento, para a tela e o extrato (passa por `t()` na exibição). */
export const ROTULO_DO_EVENTO: Readonly<Record<EventoDePontuacao, string>> = {
  mensagem_recebida: "Mensagem recebida",
  respondeu_followup: "Respondeu o follow-up",
  agendamento_marcado: "Agendamento marcado",
  orcamento_enviado: "Orçamento enviado",
  orcamento_aceito: "Orçamento aceito",
  etapa_alcancada: "Etapa alcançada",
  tag_aplicada: "Tag aplicada",
  link_clicado: "Clicou num link",
};

/**
 * Os tipos do `event_log` que alimentam cada evento de pontuação. É a lista que
 * o handler assina — derivada daqui para não existir uma segunda.
 *
 * `proposal.sent` / `proposal.accepted` nascem do gatilho
 * `trg_crm_lead_activities_fato_de_proposta` (migration 9492), que transforma a
 * atividade `proposal_sent` / `proposal_accepted` da timeline em fato do
 * `event_log` — a atividade é gravada por três caminhos (rota de enviar, decisão
 * da equipe, link público), e o gatilho pega os três.
 */
export const TIPOS_DO_EVENT_LOG: Readonly<Record<EventoDePontuacao, readonly string[]>> = {
  mensagem_recebida: ["message.received"],
  respondeu_followup: ["message.received"],
  agendamento_marcado: ["appointment.created"],
  orcamento_enviado: ["proposal.sent"],
  orcamento_aceito: ["proposal.accepted"],
  etapa_alcancada: ["lead.stage_changed"],
  tag_aplicada: ["lead.tag_added", "contact.tag_added"],
  // Nasce `pending` em `fn_registrar_clique_de_saida` (9499) só quando o clique
  // é de gente E o link tem contato; sem contato o fato nasce `done`.
  link_clicado: ["link.clicked"],
};

export const EVENTOS_DO_EVENT_LOG: readonly string[] = [
  ...new Set(Object.values(TIPOS_DO_EVENT_LOG).flat()),
];

/** Os eventos de pontuação que um tipo do `event_log` pode produzir. */
export function eventosDoTipo(eventType: string): EventoDePontuacao[] {
  return EVENTOS_DE_PONTUACAO.filter((e) => TIPOS_DO_EVENT_LOG[e].includes(eventType));
}

// ─── A condição: schema central por evento ───────────────────────────────────

const semCondicao = z.object({}).strict();

/**
 * O schema da condição de cada evento — a ÚNICA definição, lida pela rota (na
 * porta), pela tela (para saber o que perguntar) e pelo handler (para casar).
 * Evento sem condição recebe `{}`; os dois com alvo exigem o alvo.
 */
export const CONDICAO_POR_EVENTO = {
  mensagem_recebida: semCondicao,
  respondeu_followup: semCondicao,
  agendamento_marcado: semCondicao,
  orcamento_enviado: semCondicao,
  orcamento_aceito: semCondicao,
  etapa_alcancada: z.object({ stage_id: z.uuid() }).strict(),
  tag_aplicada: z.object({ tag: z.string().trim().min(1).max(60) }).strict(),
  // Opcional: sem rótulo, qualquer link pontua; com rótulo, só o link marcado
  // com ele (`{{link:https://…|rótulo}}` — o rótulo é a "campanha" do link). O
  // limite é o do CHECK `links_de_saida_rotulo_valido`.
  link_clicado: z.object({ rotulo: z.string().trim().min(1).max(60).optional() }).strict(),
} as const satisfies Record<EventoDePontuacao, z.ZodType>;

export type CondicaoDe<E extends EventoDePontuacao> = z.infer<(typeof CONDICAO_POR_EVENTO)[E]>;

/** A condição gravada, já lida pelo schema do evento — `null` quando não serve. */
export function lerCondicao(evento: EventoDePontuacao, bruta: unknown): Record<string, string> | null {
  const r = CONDICAO_POR_EVENTO[evento].safeParse(bruta ?? {});
  return r.success ? (r.data as Record<string, string>) : null;
}

export const MENSAGEM_DA_CONDICAO: Readonly<Partial<Record<EventoDePontuacao, string>>> = {
  etapa_alcancada: "Escolha a etapa que vale pontos.",
  tag_aplicada: "Escreva a tag que vale pontos.",
};

/** Limites da regra — os mesmos do CHECK da tabela. */
export const PONTOS_MAXIMOS = 1000;
export const TETO_MAXIMO = 100_000;

const pontosSchema = z
  .number()
  .int()
  .min(-PONTOS_MAXIMOS)
  .max(PONTOS_MAXIMOS)
  .refine((n) => n !== 0, { message: "Uma regra que vale zero pontos não muda nada." });

const tetoSchema = z.number().int().min(1).max(TETO_MAXIMO).nullable();

function exigirCondicaoDoEvento(
  regra: { evento?: EventoDePontuacao; condicao?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (!regra.evento) return;
  if (lerCondicao(regra.evento, regra.condicao) !== null) return;
  ctx.addIssue({
    code: "custom",
    path: ["condicao"],
    message: MENSAGEM_DA_CONDICAO[regra.evento] ?? "Este evento não tem condição.",
  });
}

export const criarRegraSchema = z
  .object({
    nome: z.string().trim().min(1).max(80),
    evento: z.enum(EVENTOS_DE_PONTUACAO),
    condicao: z.record(z.string(), z.unknown()).default({}),
    pontos: pontosSchema,
    ativo: z.boolean().default(true),
    teto_por_contato: tetoSchema.default(null),
  })
  .strict()
  .superRefine(exigirCondicaoDoEvento);

/**
 * Editar NÃO troca o evento: o extrato já gravado diz "Etapa alcançada", e a
 * mesma regra passar a ouvir mensagens faria a linha antiga mentir sobre a
 * regra que a gerou. Quem quer outro evento cria outra regra. A condição, essa
 * sim, muda — e a rota a confere contra o evento GRAVADO.
 */
export const editarRegraSchema = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    condicao: z.record(z.string(), z.unknown()).optional(),
    pontos: pontosSchema.optional(),
    ativo: z.boolean().optional(),
    teto_por_contato: tetoSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "Nada para alterar." });

export interface RegraDePontuacao {
  id: string;
  nome: string;
  evento: EventoDePontuacao;
  condicao: Record<string, unknown>;
  pontos: number;
  ativo: boolean;
  teto_por_contato: number | null;
  created_at: string;
  updated_at: string;
}

export const COLUNAS_DA_REGRA =
  "id, nome, evento, condicao, pontos, ativo, teto_por_contato, created_at, updated_at";

export interface LinhaDoExtrato {
  id: string;
  contact_id: string;
  lead_id: string | null;
  regra_id: string;
  evento: EventoDePontuacao;
  pontos: number;
  motivo: string;
  ocorrido_em: string;
}

export const COLUNAS_DO_EXTRATO = "id, contact_id, lead_id, regra_id, evento, pontos, motivo, ocorrido_em";

/** "+10" / "−5": o sinal É o número (o mesmo desenho do `ScoreSlot`). */
export function comSinal(pontos: number): string {
  return pontos > 0 ? `+${pontos}` : pontos < 0 ? `−${Math.abs(pontos)}` : "0";
}

/** Ativas primeiro, depois por nome — a ordem da tela. */
export function ordenarRegras<T extends Pick<RegraDePontuacao, "ativo" | "nome">>(regras: readonly T[]): T[] {
  return [...regras].sort((a, b) =>
    a.ativo === b.ativo ? a.nome.localeCompare(b.nome, "pt-BR") : a.ativo ? -1 : 1,
  );
}

// ─── O fato e o casamento ────────────────────────────────────────────────────

/**
 * Um fato pontuável, já com o contato resolvido. `atributos` é o que a condição
 * compara: a etapa de destino, as etiquetas acrescentadas.
 */
export interface FatoPontuavel {
  evento: EventoDePontuacao;
  contactId: string;
  leadId: string | null;
  /** A chave de idempotência do FATO (sem a regra — o banco junta os dois). */
  chave: string;
  ocorridoEm: string;
  atributos: { stageId?: string; tags?: readonly string[]; rotulo?: string | null };
}

/** A tag como o casamento a compara: sem espaço nas pontas, sem caixa. */
export function normalizarTag(tag: string): string {
  return tag.trim().toLocaleLowerCase("pt-BR");
}

/** O rótulo do link como o casamento o compara — mesma régua da tag. */
export const normalizarRotulo = normalizarTag;

/**
 * A chave do fato para UMA regra.
 *
 * Na etiqueta, a chave leva a TAG da regra — o mesmo fato "acrescentou vip e
 * novo" pontua uma vez por tag, e cada regra só olha a própria. Nos outros
 * eventos a chave do fato basta.
 */
export function chaveDoFato(fato: FatoPontuavel, regra: Pick<RegraDePontuacao, "evento" | "condicao">): string {
  if (regra.evento === "tag_aplicada") {
    const c = lerCondicao("tag_aplicada", regra.condicao);
    return `${fato.chave}:${normalizarTag(c?.tag ?? "")}`;
  }
  return fato.chave;
}

/** A regra vale para este fato? Regra inativa ou condição torta nunca casa. */
export function regraCasa(
  regra: Pick<RegraDePontuacao, "evento" | "condicao" | "ativo">,
  fato: FatoPontuavel,
): boolean {
  if (!regra.ativo || regra.evento !== fato.evento) return false;
  const condicao = lerCondicao(regra.evento, regra.condicao);
  if (condicao === null) return false;
  if (regra.evento === "etapa_alcancada") return fato.atributos.stageId === condicao.stage_id;
  if (regra.evento === "tag_aplicada") {
    const alvo = normalizarTag(condicao.tag ?? "");
    return (fato.atributos.tags ?? []).some((t) => normalizarTag(t) === alvo);
  }
  if (regra.evento === "link_clicado") {
    if (condicao.rotulo === undefined) return true;
    const doLink = fato.atributos.rotulo;
    return typeof doLink === "string" && normalizarRotulo(doLink) === normalizarRotulo(condicao.rotulo);
  }
  return true;
}

/**
 * Quantos pontos a regra ainda pode dar, respeitado o teto por contato.
 *
 * O teto é sobre o MÓDULO acumulado daquela regra para aquele contato: uma regra
 * de −5 com teto 20 tira no máximo 20. A última parcela é cortada para caber —
 * "chegou a 18, a próxima vale 5" vira 2, e o extrato mostra os 2. Zero = nada a
 * gravar. É a mesma conta que `fn_pontuacao_registrar` faz no banco, sob trava;
 * esta existe para ser testada sem banco e para a tela explicar o teto.
 */
export function pontosDentroDoTeto(pontos: number, teto: number | null, acumuladoAbsoluto: number): number {
  if (teto === null) return pontos;
  const resta = Math.max(0, teto - acumuladoAbsoluto);
  const aplicado = Math.min(Math.abs(pontos), resta);
  return pontos < 0 ? -aplicado : aplicado;
}

// ─── Do `event_log` ao fato ──────────────────────────────────────────────────

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * O que o evento CARREGA, antes de o handler ir ao banco resolver o contato.
 *
 * Puro: lê só o payload e o `entity_id`. Quem precisa de consulta (contato do
 * negócio, contato do agendamento, inscrição de follow-up) recebe aqui o
 * ponteiro e a resolução fica com o handler.
 */
export type PedidoDoFato =
  | { evento: "mensagem_recebida" | "respondeu_followup"; contactId: string; mensagemId: string }
  | { evento: "agendamento_marcado"; agendamentoId: string }
  | { evento: "orcamento_enviado" | "orcamento_aceito"; propostaId: string; leadId: string | null; contactId: string | null }
  | { evento: "etapa_alcancada"; leadId: string; stageId: string }
  | { evento: "tag_aplicada"; leadId: string | null; contactId: string | null; tags: string[] }
  | { evento: "link_clicado"; linkId: string; contactId: string; rotulo: string | null };

export interface LinhaDoEvento {
  id: string;
  event_type: string;
  entity_kind: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
}

/** Os pedidos que UM evento gera, só para os eventos que alguma regra ativa escuta. */
export function pedidosDoEvento(row: LinhaDoEvento, escutados: ReadonlySet<EventoDePontuacao>): PedidoDoFato[] {
  const p = row.payload ?? {};
  const pedidos: PedidoDoFato[] = [];
  switch (row.event_type) {
    case "message.received": {
      const contactId = texto(p.contact_id);
      const mensagemId = texto(p.message_id) ?? texto(row.entity_id) ?? row.id;
      if (!contactId) break;
      if (escutados.has("mensagem_recebida")) pedidos.push({ evento: "mensagem_recebida", contactId, mensagemId });
      if (escutados.has("respondeu_followup")) pedidos.push({ evento: "respondeu_followup", contactId, mensagemId });
      break;
    }
    case "appointment.created": {
      const agendamentoId = texto(row.entity_id) ?? texto(p.appointment_id);
      if (agendamentoId && escutados.has("agendamento_marcado")) {
        pedidos.push({ evento: "agendamento_marcado", agendamentoId });
      }
      break;
    }
    case "proposal.sent":
    case "proposal.accepted": {
      const evento = row.event_type === "proposal.sent" ? "orcamento_enviado" : "orcamento_aceito";
      const propostaId = texto(row.entity_id) ?? texto(p.proposal_id);
      if (propostaId && escutados.has(evento)) {
        pedidos.push({ evento, propostaId, leadId: texto(p.lead_id), contactId: texto(p.contact_id) });
      }
      break;
    }
    case "lead.stage_changed": {
      const leadId = texto(p.lead_id) ?? texto(row.entity_id);
      const stageId = texto(p.to_stage_id);
      if (leadId && stageId && escutados.has("etapa_alcancada")) {
        pedidos.push({ evento: "etapa_alcancada", leadId, stageId });
      }
      break;
    }
    case "lead.tag_added":
    case "contact.tag_added": {
      const tags = Array.isArray(p.added_tags) ? p.added_tags.filter((t): t is string => typeof t === "string") : [];
      if (!tags.length || !escutados.has("tag_aplicada")) break;
      const doNegocio = row.event_type === "lead.tag_added";
      pedidos.push({
        evento: "tag_aplicada",
        leadId: doNegocio ? texto(row.entity_id) : null,
        contactId: doNegocio ? null : texto(row.entity_id),
        tags,
      });
      break;
    }
    case "link.clicked": {
      // Só o fato com contato pontua; o sem contato nem deveria chegar aqui
      // (nasce `done`), e se chegar sai sem pedido.
      const linkId = texto(row.entity_id) ?? texto(p.link_id);
      const contactId = texto(p.contact_id);
      if (linkId && contactId && escutados.has("link_clicado")) {
        pedidos.push({ evento: "link_clicado", linkId, contactId, rotulo: texto(p.rotulo) });
      }
      break;
    }
  }
  return pedidos;
}
