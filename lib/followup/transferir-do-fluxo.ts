/**
 * Os dois nós do fluxo de mensagens que mudam QUEM ATENDE (4.3):
 *
 *   - "Transferir" → a MESMA troca da tela. Atendente: `fn_conversation_assign`
 *     com `reason = 'transfer'` (o botão Transferir, rota
 *     `conversations/[id]/transfer`), com a mesma régua de destino (membro ativo
 *     da organização, nunca `viewer`), a mesma auditoria e a mesma linha no
 *     histórico. Setor: `definirSetorDaConversa` (rota
 *     `conversations/[id]/sector`), origem `automacao` — que respeita a fila que
 *     uma PESSOA escolheu.
 *   - "Passar para a IA" → `devolverAtendimentoAoAgente` (rota
 *     `conversations/[id]/reactivate-bot` e o cron de devolução), com a trava
 *     permanente de "só humano" valendo como vale para eles.
 *
 * Nenhum dos dois lança para o motor: o desfecho volta como `{ ok: false,
 * motivo }`, o motor grava a recusa na trilha da inscrição e o fluxo segue.
 * Transferência que falha não pode prender o contato num nó.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";
import { definirSetorDaConversa } from "@/lib/atendimento/setor-da-conversa";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import type { FlowNode } from "./graph-schema";

export type DesfechoDaTroca = { ok: true; detalhe?: string } | { ok: false; motivo: string };

type ConfigDeTransferir = Extract<FlowNode, { type: "transfer" }>["config"];

/**
 * A conversa da inscrição — ou, sem ela (inscrição armada por gatilho sem
 * conversa), a conversa ABERTA mais recente do contato. Nunca de outra
 * organização: o filtro vem da inscrição, que veio do banco.
 */
export async function conversaDaInscricao(
  admin: SupabaseClient,
  args: { organizationId: string; contactId: string; conversationId: string | null },
): Promise<string | null> {
  if (args.conversationId) return args.conversationId;
  const { data, error } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("contact_id", args.contactId)
    .in("status", ["open", "pending", "claimed", "ai_handling"])
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

export async function transferirConversaDoFluxo(
  admin: SupabaseClient,
  args: {
    organizationId: string;
    contactId: string;
    conversationId: string | null;
    enrollmentId: string;
    config: ConfigDeTransferir;
  },
): Promise<DesfechoDaTroca> {
  const conversa = await conversaDaInscricao(admin, args);
  if (!conversa) return { ok: false, motivo: "sem_conversa" };
  const origem = `followup:${args.enrollmentId}`;
  const destino = args.config.destino;

  if (destino.tipo === "setor") {
    const r = await definirSetorDaConversa({
      db: admin,
      organizationId: args.organizationId,
      conversationId: conversa,
      sectorId: destino.sector_id,
      origem: "automacao",
      ator: { tipo: "automacao", id: origem },
      requestId: origem,
    });
    return r.ok ? { ok: true, detalhe: r.mudou ? "setor_gravado" : "setor_igual" } : { ok: false, motivo: r.motivo };
  }

  // Mesma régua da rota: o destino é membro ATIVO desta organização, e atende.
  const { data: membro, error: membroErr } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", args.organizationId)
    .eq("user_id", destino.user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (membroErr) return { ok: false, motivo: "leitura_indisponivel" };
  if (!membro || (membro as { role: string }).role === "viewer") return { ok: false, motivo: "destino_invalido" };

  const { data, error } = await admin.rpc("fn_conversation_assign", {
    p_organization_id: args.organizationId,
    p_conversation_id: conversa,
    p_to_user_id: destino.user_id,
    p_reason: "transfer",
    p_enforce_expected: false,
  });
  if (error) return { ok: false, motivo: "falha_ao_gravar" };
  const linha = (Array.isArray(data) ? data[0] : null) as { id: string; contact_id: string | null } | null;
  if (!linha) return { ok: false, motivo: "conversa_nao_encontrada" };

  await audit({
    action: "conversation.transferred",
    actorUserId: null,
    organizationId: args.organizationId,
    resourceType: "conversation",
    resourceId: linha.id,
    requestId: origem,
    metadata: { to_user_id: destino.user_id, actor_type: "followup", actor_id: origem },
  });
  // A troca aparece no histórico da conversa, onde quem atende olha — o motivo
  // é canônico em português, traduzido na LEITURA, como o da rota.
  await registrarTrocaDeComando({
    supabase: admin,
    organizationId: args.organizationId,
    conversationId: conversa,
    contactId: linha.contact_id,
    tipo: "conversation_transferred",
    actor: { type: "webhook_source", id: origem },
    motivo: "Transferiu a conversa para outro atendente",
    payload: { to_user_id: destino.user_id, origem: "fluxo" },
  });
  return { ok: true };
}

export async function devolverConversaAIADoFluxo(
  admin: SupabaseClient,
  args: { organizationId: string; contactId: string; conversationId: string | null; enrollmentId: string },
): Promise<DesfechoDaTroca> {
  const conversa = await conversaDaInscricao(admin, args);
  if (!conversa) return { ok: false, motivo: "sem_conversa" };
  const origem = `followup:${args.enrollmentId}`;
  const r = await devolverAtendimentoAoAgente(
    {
      supabase: admin,
      organizationId: args.organizationId,
      actor: { type: "webhook_source", id: origem },
      requestId: origem,
    },
    { conversationId: conversa },
  );
  return r.ok ? { ok: true } : { ok: false, motivo: r.erro };
}
