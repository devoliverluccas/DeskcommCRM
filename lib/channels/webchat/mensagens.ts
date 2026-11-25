/**
 * O que o VISITANTE vê da própria conversa — a leitura da rota pública.
 *
 * Três recortes, e cada um é uma trava:
 *   1. só conversas DESTA conexão e deste contato (`channel_session_id` +
 *      `contact_id` + `channel = 'webchat'`): se um atendente fundir a ficha do
 *      visitante com uma de WhatsApp, o histórico do WhatsApp não vaza para o site;
 *   2. só mensagens que o visitante deveria ver: as dele e as nossas que SAÍRAM
 *      (`sent`/`delivered`/`read`) — nada em fila, falhado, de sistema ou reação;
 *   3. só os campos que a janela desenha. Nunca `metadata`, autor, custo ou id
 *      de outra coisa.
 *
 * Mídia sai por URL ASSINADA de 10 minutos (bucket privado), gerada aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { CANAL_CHAT_DO_SITE } from "./ingest";

/** Teto por leitura: o polling pede só o que chegou depois do cursor. */
export const LIMITE_DA_LEITURA = 50;

const STATUS_VISIVEIS = ["sent", "delivered", "read"];
const TIPOS_VISIVEIS = ["text", "image", "video", "audio", "document", "template"];

export interface MensagemParaOVisitante {
  id: string;
  /** `visitante` = quem está no site; `empresa` = atendente, IA ou automação. */
  autor: "visitante" | "empresa";
  tipo: string;
  texto: string | null;
  midia: { url: string; mime: string | null } | null;
  criada_em: string;
}

interface Linha {
  id: string;
  direction: string;
  status: string;
  type: string;
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  media_storage_path: string | null;
  created_at: string;
  revoked_at: string | null;
}

export async function mensagensParaOVisitante(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    contactId: string;
    /** ISO-8601: o que foi criado a partir daqui. Ausente = as últimas. */
    depois?: string | null;
  },
): Promise<MensagemParaOVisitante[]> {
  const { data: conversas, error: erroConv } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("contact_id", input.contactId)
    .eq("channel_session_id", input.channelSessionId)
    .eq("channel", CANAL_CHAT_DO_SITE);
  if (erroConv) throw new Error("webchat_conversations_lookup_failed");
  const ids = ((conversas as { id: string }[] | null) ?? []).map((c) => c.id);
  if (ids.length === 0) return [];

  let q = admin
    .from("messages")
    .select("id, direction, status, type, body, media_url, media_mime, media_storage_path, created_at, revoked_at")
    .eq("organization_id", input.organizationId)
    .in("conversation_id", ids)
    .in("type", TIPOS_VISIVEIS)
    .is("revoked_at", null);
  if (input.depois) {
    // `gte`, não `gt`: duas linhas no mesmo instante não se perdem — o script
    // descarta pelo id o que já mostrou.
    q = q.gte("created_at", input.depois).order("created_at", { ascending: true }).limit(LIMITE_DA_LEITURA);
  } else {
    q = q.order("created_at", { ascending: false }).limit(LIMITE_DA_LEITURA);
  }
  const { data, error } = await q;
  if (error) throw new Error("webchat_messages_lookup_failed");

  let linhas = ((data as Linha[] | null) ?? []).filter(
    (m) => m.direction === "inbound" || STATUS_VISIVEIS.includes(m.status),
  );
  if (!input.depois) linhas = linhas.reverse();

  const saida: MensagemParaOVisitante[] = [];
  for (const m of linhas) {
    saida.push({
      id: m.id,
      autor: m.direction === "inbound" ? "visitante" : "empresa",
      tipo: m.type,
      texto: m.body,
      midia: await midiaDaMensagem(admin, input.organizationId, m),
      criada_em: m.created_at,
    });
  }
  return saida;
}

async function midiaDaMensagem(
  admin: SupabaseClient,
  organizationId: string,
  m: Linha,
): Promise<MensagemParaOVisitante["midia"]> {
  // Só arquivo sob a pasta da própria organização entra na assinatura.
  if (m.media_storage_path && m.media_storage_path.startsWith(`${organizationId}/`)) {
    const { data } = await admin.storage.from("whatsapp-media").createSignedUrl(m.media_storage_path, 600);
    return data?.signedUrl ? { url: data.signedUrl, mime: m.media_mime } : null;
  }
  if (m.media_url && /^https:\/\//i.test(m.media_url)) return { url: m.media_url, mime: m.media_mime };
  return null;
}
