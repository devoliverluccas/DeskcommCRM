/**
 * Entrada do chat do site: mensagem do visitante → contato, conversa, mensagem.
 *
 * É a MESMA esteira dos outros canais, no molde da ingestão do robô
 * (`../bot/ingest.ts`): contato por `social_identity`, conversa pela RPC de
 * sempre, mensagem com `unique (organization_id, external_id)`, e então
 * `marcarConversaComMensagem` + `aplicarEfeitosPosEntrada` — opt-out, negócio,
 * demanda, rodízio e o despacho do agente de IA, exatamente como no WhatsApp.
 *
 * ─── O visitante não tem telefone ──────────────────────────────────────────
 *
 * O contato nasce sem `phone_number`, identificado por
 * `webchat:<sessão>:<sha256 do token>`. Nome e e-mail entram só se o visitante
 * informar, e nunca sobrescrevem o que o atendente já preencheu.
 *
 * ─── Idempotência ──────────────────────────────────────────────────────────
 *
 * O script sorteia um id por mensagem e o reenvia se a rede falhar. O
 * `external_id` é derivado dele (e do visitante), então o reenvio vira
 * `duplicate` no `23505` — não uma segunda bolha.
 *
 * ─── LGPD ──────────────────────────────────────────────────────────────────
 *
 * Anonimizar o contato redige as mensagens pela cascata de sempre
 * (`fn_lgpd_cascade_redact_contact`), e a identidade continua na linha. Um
 * visitante cuja ficha foi anonimizada recebe `encerrada`: o script descarta o
 * token e começa do zero, em vez de reabrir a conversa de quem pediu para ser
 * esquecido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ehCanalDeConversa } from "@/lib/channels/canais-de-conversa";
import { logger } from "@/lib/logger";

import { marcarConversaComMensagem } from "../marcar-conversa";
import { aplicarEfeitosPosEntrada } from "../pos-entrada";
import { hashDoVisitante, identidadeDoVisitante } from "./visitante";

/** `conversations.channel` deste canal. Ver `CANAIS_DE_CONVERSA`. */
export const CANAL_CHAT_DO_SITE = "webchat";

export interface EntradaDoVisitante {
  organizationId: string;
  channelSessionId: string;
  /** O token cru do visitante — só o hash sai daqui para o banco. */
  token: string;
  /** Id que o script sorteou para ESTA mensagem (uuid). */
  idDoCliente: string;
  texto: string;
  nome?: string | null;
  email?: string | null;
  requestId?: string;
}

export type DesfechoDaEntrada =
  | { status: "ingested"; conversationId: string; messageId: string; criadaEm: string }
  | { status: "duplicate"; conversationId: string }
  | { status: "encerrada" }
  | { status: "ignored"; reason: string };

interface ContatoDoVisitante {
  id: string;
  name: string | null;
  email: string | null;
  is_anonymized: boolean | null;
}

/**
 * O contato vivo (não fundido) deste visitante nesta conexão, ou `null`.
 * Exportada porque a leitura das mensagens faz a MESMA pergunta.
 */
export async function contatoDoVisitante(
  admin: SupabaseClient,
  organizationId: string,
  channelSessionId: string,
  token: string,
): Promise<ContatoDoVisitante | null> {
  const { data, error } = await admin
    .from("contacts")
    .select("id, name, email, is_anonymized")
    .eq("organization_id", organizationId)
    .eq("social_identity", identidadeDoVisitante(channelSessionId, token))
    .is("is_merged_into", null)
    .maybeSingle();
  if (error) throw new Error("webchat_contact_lookup_failed");
  return (data as ContatoDoVisitante | null) ?? null;
}

export async function ingerirMensagemDoVisitante(
  admin: SupabaseClient,
  input: EntradaDoVisitante,
): Promise<DesfechoDaEntrada> {
  // Clone com a imagem nova e o banco sem a 9494: o UPDATE da conversa
  // voltaria 23514. Recusar aqui troca o erro por uma linha de log que diz o que falta.
  if (!ehCanalDeConversa(CANAL_CHAT_DO_SITE)) {
    logger.error("webchat: canal sem valor correspondente no banco", {
      organization_id: input.organizationId,
    });
    return { status: "ignored", reason: "canal_desconhecido" };
  }

  const identidade = identidadeDoVisitante(input.channelSessionId, input.token);
  const nome = input.nome?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;

  let contato = await contatoDoVisitante(admin, input.organizationId, input.channelSessionId, input.token);
  if (contato?.is_anonymized) return { status: "encerrada" };
  if (!contato) {
    contato = await criarContato(admin, input.organizationId, identidade, nome, email);
  } else {
    await completarContato(admin, input.organizationId, contato, nome, email);
  }

  const conversationId = await abrirConversa(admin, {
    organizationId: input.organizationId,
    contactId: contato.id,
    channelSessionId: input.channelSessionId,
    visitante: hashDoVisitante(input.token),
  });

  const agora = new Date().toISOString();
  const externalId = `wc-in:${hashDoVisitante(input.token).slice(0, 16)}:${input.idDoCliente}`;
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversationId,
      contact_id: contato.id,
      channel_session_id: input.channelSessionId,
      external_id: externalId,
      direction: "inbound",
      // Chegou pela janela do site, não pelo composer: o default `'crm'` mentiria.
      sent_via: "external_device",
      status: "delivered",
      type: "text",
      body: input.texto,
      metadata: { webchat: true },
      sent_at: agora,
    })
    .select("id, created_at")
    .maybeSingle();
  if (error?.code === "23505") return { status: "duplicate", conversationId };
  if (error || !data) throw new Error(`webchat_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  const linha = data as { id: string; created_at: string };

  await marcarConversaComMensagem(admin, {
    organizationId: input.organizationId,
    conversationId,
    direction: "inbound",
    preview: input.texto.slice(0, 200),
    at: agora,
    canal: CANAL_CHAT_DO_SITE,
  });

  await aplicarEfeitosPosEntrada(admin, {
    organizationId: input.organizationId,
    contactId: contato.id,
    conversationId,
    messageId: linha.id,
    channelSessionId: input.channelSessionId,
    texto: input.texto,
    nomeDoContato: contato.name ?? nome,
    requestId: input.requestId,
    origem: "webchat",
    canal: CANAL_CHAT_DO_SITE,
  });

  return { status: "ingested", conversationId, messageId: linha.id, criadaEm: linha.created_at };
}

async function criarContato(
  admin: SupabaseClient,
  organizationId: string,
  identidade: string,
  nome: string | null,
  email: string | null,
): Promise<ContatoDoVisitante> {
  const { data, error } = await admin
    .from("contacts")
    .insert({
      organization_id: organizationId,
      social_identity: identidade,
      name: nome,
      display_name: nome,
      email,
      source: "webchat",
    })
    .select("id, name, email, is_anonymized")
    .single();
  // 23505 = duas mensagens simultâneas do mesmo visitante; quem perdeu procura o vivo.
  if (error?.code === "23505") {
    const { data: vencedor, error: erro2 } = await admin
      .from("contacts")
      .select("id, name, email, is_anonymized")
      .eq("organization_id", organizationId)
      .eq("social_identity", identidade)
      .is("is_merged_into", null)
      .single();
    if (erro2 || !vencedor) throw new Error("webchat_contact_race_failed");
    return vencedor as ContatoDoVisitante;
  }
  if (error || !data) throw new Error("webchat_contact_create_failed");
  return data as ContatoDoVisitante;
}

/** Nome/e-mail informados pelo visitante preenchem só o que está VAZIO. */
async function completarContato(
  admin: SupabaseClient,
  organizationId: string,
  contato: ContatoDoVisitante,
  nome: string | null,
  email: string | null,
): Promise<void> {
  const patch: Record<string, string> = {};
  if (nome && !contato.name) {
    patch.name = nome;
    patch.display_name = nome;
  }
  if (email && !contato.email) patch.email = email;
  if (Object.keys(patch).length === 0) return;
  const { error } = await admin
    .from("contacts")
    .update(patch)
    .eq("organization_id", organizationId)
    .eq("id", contato.id);
  // Completar a ficha é cortesia: falhar aqui não pode perder a mensagem.
  if (error) logger.warn("webchat: não consegui completar a ficha do visitante", { code: error.code });
  else Object.assign(contato, { name: patch.name ?? contato.name, email: patch.email ?? contato.email });
}

/**
 * A conversa deste visitante nesta conexão. A RPC de sempre nasce a linha com
 * `channel = 'whatsapp'`; o canal e o visitante entram no UPDATE logo depois,
 * sem condição (o `neq` não alcança NULL — a lição do canal intermediado).
 */
async function abrirConversa(
  admin: SupabaseClient,
  input: { organizationId: string; contactId: string; channelSessionId: string; visitante: string },
): Promise<string> {
  const { data, error } = await admin.rpc("fn_upsert_wa_conversation" as never, {
    p_org: input.organizationId,
    p_contact: input.contactId,
    p_session: input.channelSessionId,
  } as never);
  if (error || !data) throw new Error("webchat_conversation_upsert_failed");
  const conversationId = data as string;

  const { error: erroUpdate } = await admin
    .from("conversations")
    .update({ channel: CANAL_CHAT_DO_SITE, provider_conversation_id: input.visitante })
    .eq("organization_id", input.organizationId)
    .eq("id", conversationId);
  if (erroUpdate) throw new Error(`webchat_conversation_update_failed: ${erroUpdate.code ?? ""}`.trim());
  return conversationId;
}
