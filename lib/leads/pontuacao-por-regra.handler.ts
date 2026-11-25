/**
 * O CONSUMIDOR da pontuação por regra (fase 4, item 4.5).
 *
 * Lê fatos que o sistema já emite no `event_log` (mensagem recebida, agendamento
 * criado, etapa alterada, etiqueta acrescentada, orçamento enviado/aceito, clique
 * de gente num link rastreado de saída),
 * casa com as regras ATIVAS da organização e grava uma linha no extrato por
 * (regra, fato) — pela `fn_pontuacao_registrar`, que confere organização,
 * contato e teto sob trava e ignora a segunda chegada do mesmo fato.
 *
 * ─── Por que custa pouco para quem não usa ──────────────────────────────────
 *
 * `message.received` é o evento mais frequente do produto. A PRIMEIRA consulta
 * é "esta organização tem regra ativa para estes eventos?"; sem regra, o evento
 * sai `skipped` sem tocar em contato, negócio ou follow-up.
 *
 * ─── Falha ──────────────────────────────────────────────────────────────────
 *
 * Falha do banco é `error` (o dreno conta tentativa, aplica backoff e avisa no
 * teto). Reprocessar é seguro: a chave do extrato impede pontuar duas vezes.
 *
 * `roda` na organização parada: é escrita interna, não sai para fora nem custa
 * dinheiro — e o extrato que pulasse um fato nunca o recuperaria.
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  COLUNAS_DA_REGRA,
  EVENTOS_DO_EVENT_LOG,
  chaveDoFato,
  eventosDoTipo,
  pedidosDoEvento,
  regraCasa,
  type EventoDePontuacao,
  type FatoPontuavel,
  type PedidoDoFato,
  type RegraDePontuacao,
} from "./pontuacao-por-regra";

export const PONTUACAO_POR_REGRA_HANDLER_KEY = "leads.pontuacao-por-regra";

/** O que o consumidor precisa do banco — injetável, para a regra ser testada sem ele. */
export interface PontuacaoDb {
  regrasAtivas(organizationId: string, eventos: readonly EventoDePontuacao[]): Promise<RegraDePontuacao[]>;
  /** O contato do negócio, ou `null` se o negócio não é desta organização. */
  contatoDoNegocio(organizationId: string, leadId: string): Promise<string | null>;
  contatoDoAgendamento(organizationId: string, agendamentoId: string): Promise<string | null>;
  /**
   * A inscrição de follow-up que esta mensagem RESPONDEU: começou antes dela, já
   * deu pelo menos um passo e estava viva quando a mensagem chegou (aberta, ou
   * encerrada depois — o cancelamento "o cliente respondeu" acontece por causa
   * desta mesma mensagem).
   */
  inscricaoRespondida(organizationId: string, contactId: string, chegouEm: string): Promise<string | null>;
  registrar(entrada: {
    organizationId: string;
    regraId: string;
    contactId: string;
    leadId: string | null;
    chave: string;
    ocorridoEm: string;
  }): Promise<number>;
}

export interface ResumoDaPontuacao {
  /** Pares (regra, fato) que casaram. */
  casados: number;
  /** Linhas gravadas no extrato (o resto já existia ou bateu o teto). */
  gravados: number;
  /** Soma dos pontos gravados. */
  pontos: number;
}

/** Resolve o contato (e o negócio) de um pedido. `null` = o fato não tem a quem pontuar. */
async function resolverFato(
  db: PontuacaoDb,
  organizationId: string,
  pedido: PedidoDoFato,
  ocorridoEm: string,
): Promise<FatoPontuavel | null> {
  switch (pedido.evento) {
    case "mensagem_recebida":
      return {
        evento: pedido.evento,
        contactId: pedido.contactId,
        leadId: null,
        chave: `mensagem_recebida:${pedido.mensagemId}`,
        ocorridoEm,
        atributos: {},
      };
    case "respondeu_followup": {
      const inscricao = await db.inscricaoRespondida(organizationId, pedido.contactId, ocorridoEm);
      if (!inscricao) return null;
      // Uma vez por INSCRIÇÃO: o cliente que manda três mensagens seguidas
      // respondeu o follow-up uma vez.
      return {
        evento: pedido.evento,
        contactId: pedido.contactId,
        leadId: null,
        chave: `respondeu_followup:${inscricao}`,
        ocorridoEm,
        atributos: {},
      };
    }
    case "agendamento_marcado": {
      const contactId = await db.contatoDoAgendamento(organizationId, pedido.agendamentoId);
      if (!contactId) return null;
      return {
        evento: pedido.evento,
        contactId,
        leadId: null,
        chave: `agendamento_marcado:${pedido.agendamentoId}`,
        ocorridoEm,
        atributos: {},
      };
    }
    case "orcamento_enviado":
    case "orcamento_aceito": {
      const contactId =
        pedido.contactId ?? (pedido.leadId ? await db.contatoDoNegocio(organizationId, pedido.leadId) : null);
      if (!contactId) return null;
      // Uma vez por PROPOSTA: reenviar o mesmo orçamento não pontua de novo.
      return {
        evento: pedido.evento,
        contactId,
        leadId: pedido.leadId,
        chave: `${pedido.evento}:${pedido.propostaId}`,
        ocorridoEm,
        atributos: {},
      };
    }
    case "etapa_alcancada": {
      const contactId = await db.contatoDoNegocio(organizationId, pedido.leadId);
      if (!contactId) return null;
      // Uma vez por NEGÓCIO e etapa: ir e voltar da mesma etapa não acumula, e
      // o fato emitido duas vezes (gatilho do banco + rota de mover) também não.
      return {
        evento: pedido.evento,
        contactId,
        leadId: pedido.leadId,
        chave: `etapa_alcancada:${pedido.leadId}:${pedido.stageId}`,
        ocorridoEm,
        atributos: { stageId: pedido.stageId },
      };
    }
    case "tag_aplicada": {
      const contactId =
        pedido.contactId ?? (pedido.leadId ? await db.contatoDoNegocio(organizationId, pedido.leadId) : null);
      if (!contactId) return null;
      // Uma vez por CONTATO e tag (a tag entra na chave pela regra): a mesma
      // etiqueta no negócio e no contato é o mesmo fato para quem pontua.
      return {
        evento: pedido.evento,
        contactId,
        leadId: pedido.leadId,
        chave: `tag_aplicada:${contactId}`,
        ocorridoEm,
        atributos: { tags: pedido.tags },
      };
    }
    case "link_clicado":
      // Uma vez por LINK: o link de saída já é POR contato (único por
      // organização + contato + destino + rótulo), então isto é "uma vez por
      // link por contato". Clicar de novo — ou o mesmo contato abrir no celular
      // e no computador — não acumula: o interesse foi demonstrado uma vez. Quem
      // quer valorizar outro link manda outro link (outro destino ou rótulo).
      return {
        evento: pedido.evento,
        contactId: pedido.contactId,
        leadId: null,
        chave: `link_clicado:${pedido.linkId}`,
        ocorridoEm,
        atributos: { rotulo: pedido.rotulo },
      };
  }
}

/** A decisão inteira de UM evento. Lança em falha do banco (o handler vira `error`). */
export async function aplicarPontuacao(
  db: PontuacaoDb,
  row: Pick<EventRow, "id" | "organization_id" | "event_type" | "entity_kind" | "entity_id" | "payload" | "created_at">,
  agora: () => Date = () => new Date(),
): Promise<ResumoDaPontuacao> {
  const resumo: ResumoDaPontuacao = { casados: 0, gravados: 0, pontos: 0 };
  const candidatos = eventosDoTipo(row.event_type);
  if (!candidatos.length) return resumo;

  const regras = await db.regrasAtivas(row.organization_id, candidatos);
  if (!regras.length) return resumo;

  const escutados = new Set(regras.map((r) => r.evento));
  // ISO com `Z`: o valor entra num filtro `or(...)` do PostgREST, e o `+00:00`
  // que o banco devolve precisaria de escape.
  const emitido = row.created_at ? new Date(row.created_at) : null;
  const ocorridoEm = (emitido && !Number.isNaN(emitido.getTime()) ? emitido : agora()).toISOString();
  for (const pedido of pedidosDoEvento(row, escutados)) {
    const fato = await resolverFato(db, row.organization_id, pedido, ocorridoEm);
    if (!fato) continue;
    for (const regra of regras) {
      if (!regraCasa(regra, fato)) continue;
      resumo.casados += 1;
      const pontos = await db.registrar({
        organizationId: row.organization_id,
        regraId: regra.id,
        contactId: fato.contactId,
        leadId: fato.leadId,
        chave: chaveDoFato(fato, regra),
        ocorridoEm: fato.ocorridoEm,
      });
      if (pontos !== 0) {
        resumo.gravados += 1;
        resumo.pontos += pontos;
      }
    }
  }
  return resumo;
}

/** O adaptador do banco pelo service role — toda consulta com `organization_id` explícito. */
export function pontuacaoDbSupabase(admin: ReturnType<typeof createAdminClient>): PontuacaoDb {
  return {
    async regrasAtivas(organizationId, eventos) {
      const { data, error } = await admin
        .from("regras_de_pontuacao")
        .select(COLUNAS_DA_REGRA)
        .eq("organization_id", organizationId)
        .eq("ativo", true)
        .in("evento", [...eventos])
        .limit(200);
      if (error) throw new Error(`pontuação: regras — ${error.message}`);
      return (data ?? []) as unknown as RegraDePontuacao[];
    },
    async contatoDoNegocio(organizationId, leadId) {
      const { data, error } = await admin
        .from("crm_leads")
        .select("contact_id")
        .eq("organization_id", organizationId)
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new Error(`pontuação: negócio — ${error.message}`);
      return (data as { contact_id: string | null } | null)?.contact_id ?? null;
    },
    async contatoDoAgendamento(organizationId, agendamentoId) {
      const { data, error } = await admin
        .from("calendar_appointments")
        .select("contact_id")
        .eq("organization_id", organizationId)
        .eq("id", agendamentoId)
        .maybeSingle();
      if (error) throw new Error(`pontuação: agendamento — ${error.message}`);
      return (data as { contact_id: string | null } | null)?.contact_id ?? null;
    },
    async inscricaoRespondida(organizationId, contactId, chegouEm) {
      const { data, error } = await admin
        .from("followup_enrollments")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("contact_id", contactId)
        .lt("started_at", chegouEm)
        .gt("steps_taken", 0)
        .or(`completed_at.is.null,completed_at.gte.${chegouEm}`)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`pontuação: follow-up — ${error.message}`);
      return (data as { id: string } | null)?.id ?? null;
    },
    async registrar(e) {
      const { data, error } = await admin.rpc("fn_pontuacao_registrar", {
        p_org: e.organizationId,
        p_regra: e.regraId,
        p_contato: e.contactId,
        p_lead: e.leadId,
        p_chave: e.chave,
        p_ocorrido_em: e.ocorridoEm,
      });
      if (error) throw new Error(`pontuação: extrato — ${error.message}`);
      return typeof data === "number" ? data : 0;
    },
  };
}

export const pontuacaoPorRegraHandler: EventHandler = {
  key: PONTUACAO_POR_REGRA_HANDLER_KEY,
  naOrgParada: "roda",
  events: [...EVENTOS_DO_EVENT_LOG],
  async handle(row: EventRow): Promise<HandlerResult> {
    if (!eventosDoTipo(row.event_type).length) {
      return { consumer_key: PONTUACAO_POR_REGRA_HANDLER_KEY, status: "skipped", detail: "tipo_sem_regra" };
    }
    try {
      const resumo = await aplicarPontuacao(pontuacaoDbSupabase(createAdminClient()), row);
      return {
        consumer_key: PONTUACAO_POR_REGRA_HANDLER_KEY,
        status: resumo.gravados > 0 ? "ok" : "skipped",
        detail: `casados=${resumo.casados} gravados=${resumo.gravados} pontos=${resumo.pontos}`,
      };
    } catch (err) {
      return {
        consumer_key: PONTUACAO_POR_REGRA_HANDLER_KEY,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
