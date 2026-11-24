/**
 * Ação `pause_ai` (fase 4, 4.1) — "Pausar a IA nesta conversa".
 *
 * ─── O mesmo gesto da rota `conversations/[id]/pause-ai` ───────────────────
 *
 * A rota grava `bot_silenced_until = 'infinity'` (o literal que os três guards
 * do motor de IA leem) e `last_handoff_reason`, e registra a troca de comando na
 * linha do tempo (`conversation_ai_paused`). Esta ação faz as MESMAS duas
 * escritas e a MESMA linha do tempo, com o client de serviço: a regra não tem
 * sessão, e quem autoriza é o motor (regra criada por manager+), com todo filtro
 * por `organization_id`.
 *
 * O que ela NÃO faz da rota é o claim: lá, quem clicou ASSUME a conversa sem
 * dono. Aqui não há pessoa nenhuma para assumir — e deixar a conversa
 * "atendida pela IA" com a IA calada seria uma demanda sem ator (invariante 4 do
 * Sistema Vivo). Por isso, sem dono e em `ai_handling`, ela volta para a fila
 * (`pending`), que é o que o handoff do agente faz. Com dono, nada muda além do
 * silêncio. Também não toca `contacts.force_human`, pelo mesmo motivo da rota:
 * pausar UMA conversa não pode virar bloqueio geral do cliente.
 *
 * ─── Qual conversa ─────────────────────────────────────────────────────────
 *
 * A do evento quando ele a traz (`message.received`, `message.keyword`); senão a
 * conversa aberta mais recente do contato. Sem nenhuma (ou com a conversa já
 * encerrada), é pulo nomeado: `pausa_sem_conversa_aberta`.
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { logger } from "@/lib/logger";

/** O mesmo literal da rota e do handoff: `bot_silenced_until > now()` é sempre verdadeiro. */
const SILENCIO_DURAVEL = "infinity";
/** Canônico em português: quem traduz é a leitura (`t(item.reason)`). */
export const MOTIVO_DA_PAUSA_PELA_AUTOMACAO = "Automático pausado por uma automação";
const ENCERRADAS = ["closed", "archived"];

function conversaDoEvento(ctx: ActionCtx): string | null {
  const doPayload = ctx.event.payload?.conversation_id;
  return typeof doPayload === "string" ? doPayload : null;
}

async function conversaAbertaDoContato(ctx: ActionCtx, contactId: string): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("conversations")
    .select("id")
    .eq("organization_id", ctx.organizationId)
    .eq("contact_id", contactId)
    .not("status", "in", `(${ENCERRADAS.join(",")})`)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn("[automation.pause_ai] não foi possível ler a conversa do contato", {
      organization_id: ctx.organizationId,
      error: error.message,
    });
    return null;
  }
  return (data as { id?: string } | null)?.id ?? null;
}

async function execute(ctx: ActionCtx): Promise<ActionResultDetail> {
  const doEvento = conversaDoEvento(ctx);
  const contactId = (ctx.context.contact as { id?: string } | undefined)?.id ?? null;
  const conversaId = doEvento ?? (contactId ? await conversaAbertaDoContato(ctx, contactId) : null);
  if (!conversaId) return { type: "pause_ai", status: "skipped", detail: { reason: "pausa_sem_conversa_aberta" } };

  const { data: atual, error: erroLeitura } = await ctx.admin
    .from("conversations")
    .select("id, contact_id, status, assigned_to_user_id, bot_silenced_until")
    .eq("id", conversaId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (erroLeitura) return { type: "pause_ai", status: "failed", error: erroLeitura.message };
  const conversa = atual as {
    id: string;
    contact_id: string | null;
    status: string;
    assigned_to_user_id: string | null;
    bot_silenced_until: string | null;
  } | null;
  if (!conversa) return { type: "pause_ai", status: "skipped", detail: { reason: "pausa_sem_conversa_aberta" } };
  if (ENCERRADAS.includes(conversa.status)) {
    return { type: "pause_ai", status: "skipped", detail: { reason: "pausa_sem_conversa_aberta", conversa_id: conversaId } };
  }

  // Já pausada para sempre: nada a fazer, e não é falha (repetir a regra é rotina).
  if (conversa.bot_silenced_until === SILENCIO_DURAVEL) {
    return { type: "pause_ai", status: "success", detail: { conversa_id: conversaId, mudou: false } };
  }

  const voltaParaAFila = conversa.assigned_to_user_id === null && conversa.status === "ai_handling";
  const { error: erroEscrita } = await ctx.admin
    .from("conversations")
    .update({
      bot_silenced_until: SILENCIO_DURAVEL,
      last_handoff_reason: MOTIVO_DA_PAUSA_PELA_AUTOMACAO,
      ...(voltaParaAFila ? { status: "pending" } : {}),
    })
    .eq("id", conversaId)
    .eq("organization_id", ctx.organizationId);
  if (erroEscrita) return { type: "pause_ai", status: "failed", error: erroEscrita.message };

  await registrarTrocaDeComando({
    supabase: ctx.admin,
    organizationId: ctx.organizationId,
    conversationId: conversaId,
    contactId: conversa.contact_id,
    tipo: "conversation_ai_paused",
    // O mesmo ator das outras ações do motor: a timeline o grava como sistema.
    actor: { type: "webhook_source", id: ctx.ruleId },
    motivo: MOTIVO_DA_PAUSA_PELA_AUTOMACAO,
    payload: { regra_id: ctx.ruleId, voltou_para_a_fila: voltaParaAFila },
  });

  return {
    type: "pause_ai",
    status: "success",
    detail: {
      conversa_id: conversaId,
      conversa_de: doEvento ? "evento" : "contato",
      mudou: true,
      voltou_para_a_fila: voltaParaAFila,
    },
  };
}

registerAction({ type: "pause_ai", execute: (ctx) => execute(ctx) });
