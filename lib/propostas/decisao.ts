// lib/propostas/decisao.ts
//
// A DECISÃO SOBRE UMA PROPOSTA ENVIADA — um caminho só, duas portas.
//
// A equipe decide por `POST /api/v1/proposals/[id]/decide` (sessão, RLS e a
// guarda `fn_crm_proposals_transicao_da_sessao`); o cliente decide pelo link
// público (`/o/<token>`, cliente de serviço, sem sessão nenhuma). As duas
// chamam ESTA função, e por isso o efeito no negócio é o mesmo por construção:
// a mesma atividade na linha do tempo, o mesmo cancelamento do retorno
// automático, a mesma ação de auditoria. O que muda é só quem decidiu —
// `decided_via` e `decided_by_user_id`.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { cancelaRetornoNoCrm } from "@/lib/followup/retorno-crm";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";

export type Decisao = "aceita" | "recusada";

export type QuemDecidiu =
  /**
   * A equipe decide por sessão (`userId`) ou por token de integração (Spec 33):
   * aí `userId` é null, `ator` é o ator do token e `apiTokenId` vai à auditoria.
   */
  | { via: "equipe"; userId: string | null; ator?: Actor; apiTokenId?: string | null }
  | { via: "cliente"; linkId: string };

export interface EntradaDaDecisao {
  orgId: string;
  propostaId: string;
  decisao: Decisao;
  motivo: string | null;
  quem: QuemDecidiu;
  requestId: string;
}

export type ResultadoDaDecisao =
  | { ok: true; id: string; status: Decisao }
  | { ok: false; motivo: "nao_enviada" | "erro" };

/** O ator da linha do tempo e do retorno. O cliente não é usuário do sistema. */
function atorDe(quem: QuemDecidiu): Actor {
  if (quem.via === "cliente") return { type: "webhook_source", id: `proposal_link:${quem.linkId}` };
  return quem.ator ?? { type: "user", id: quem.userId ?? "" };
}

/**
 * Grava a decisão, só sobre proposta `enviada` (o UPDATE filtra o status: uma
 * corrida entre o cliente e a equipe deixa exatamente UMA decisão valer, e a
 * outra recebe `nao_enviada`). Depois do UPDATE, nada derruba o resultado: a
 * decisão já vale, e o que vem depois é efeito best-effort.
 */
export async function registrarDecisao(db: SupabaseClient, e: EntradaDaDecisao): Promise<ResultadoDaDecisao> {
  const { data: proposta, error } = await db
    .from("crm_proposals")
    .update({
      status: e.decisao,
      decided_at: new Date().toISOString(),
      decided_by_user_id: e.quem.via === "equipe" ? e.quem.userId : null,
      decision_reason: e.motivo,
      // A sessão nunca escreve `decided_via` (a guarda a reserva ao servidor);
      // a decisão da equipe herda o padrão `equipe` da coluna.
      ...(e.quem.via === "cliente" ? { decided_via: "cliente" } : {}),
    })
    .eq("organization_id", e.orgId)
    .eq("id", e.propostaId)
    .eq("status", "enviada")
    .select("id, lead_id, contact_id, retorno_id")
    .maybeSingle();
  if (error) return { ok: false, motivo: "erro" };
  if (!proposta) return { ok: false, motivo: "nao_enviada" };

  const linha = proposta as { id: string; lead_id: string | null; contact_id: string | null; retorno_id: string | null };
  const ator = atorDe(e.quem);
  const peloCliente = e.quem.via === "cliente";

  // value_cents do lead NÃO muda aqui (spec §16.2 — negócio perdido guarda
  // quanto valia; zerar apagaria o histórico de quanto se deixou na mesa).
  // D10: proposta órfã (negócio apagado, `lead_id` nulo) decide normalmente —
  // só não há negócio para registrar atividade nele.
  if (linha.lead_id) {
    await emitLeadActivity(db, {
      organizationId: e.orgId,
      leadId: linha.lead_id,
      contactId: linha.contact_id,
      type: e.decisao === "aceita" ? "proposal_accepted" : "proposal_declined",
      sourceModule: "proposals",
      sourceId: e.propostaId,
      actor: ator,
      reason:
        e.decisao === "aceita"
          ? peloCliente
            ? "Proposta aceita pelo cliente pelo link"
            : "Proposta aceita pelo cliente"
          : `Proposta recusada${peloCliente ? " pelo cliente pelo link" : ""}${e.motivo ? `: ${e.motivo}` : ""}`,
      payload: { decided_via: e.quem.via },
    });
  }

  // N2 — a decisão resolve a proposta: o retorno automático agendado no envio
  // não é mais necessário. Best-effort de verdade: a decisão JÁ foi gravada.
  if (linha.retorno_id) {
    try {
      await cancelaRetornoNoCrm(
        { admin: db, orgId: e.orgId, actor: ator },
        linha.retorno_id,
        { motivo: `Proposta ${e.decisao} — retorno automático não é mais necessário` },
      );
    } catch (erro) {
      logger.warn("proposal.decide: cancelamento do retorno automático falhou sem bloquear a decisão", {
        propostaId: e.propostaId,
        organizationId: e.orgId,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  void audit({
    action: e.decisao === "aceita" ? "proposal.aceita" : "proposal.recusada",
    actorUserId: e.quem.via === "equipe" ? e.quem.userId : null,
    actorApiTokenId: e.quem.via === "equipe" ? (e.quem.apiTokenId ?? null) : null,
    organizationId: e.orgId,
    resourceType: "crm_proposals",
    resourceId: e.propostaId,
    requestId: e.requestId,
    ...(e.quem.via === "cliente" ? { metadata: { decided_via: "cliente", link_id: e.quem.linkId } } : {}),
  });

  return { ok: true, id: e.propostaId, status: e.decisao };
}
