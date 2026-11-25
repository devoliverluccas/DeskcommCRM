/**
 * Adapter do chat do site (fase 5, item 5.3).
 *
 * O mais burro dos adapters, e de propósito: não há plataforma do outro lado.
 * Quando o handler de envio chama `send`, a mensagem JÁ está gravada em
 * `messages` (o handler insere antes de chamar o canal); o visitante a busca
 * pela rota pública (`app/api/v1/webchat/[chave]/mensagens`). O que sobra ao
 * adapter é dizer "aceito" com um id próprio — sem ele, o handler gravaria
 * `sent` sem id e o eco/dedup não teria o que comparar.
 *
 * Mídia: imagem, vídeo, áudio e documento são aceitos porque a linha já guarda
 * o arquivo (`media_storage_path`/`media_url`) e a rota pública o entrega por
 * URL assinada. Contato, localização e figurinha não têm desenho na janela do
 * site — recusar nomeando o motivo é melhor que mandar uma bolha vazia.
 */
import { randomUUID } from "node:crypto";

import type { ChannelAdapter, OutboundEnvelope, OutboundKind, RecipientInput } from "../types";

/**
 * O marcador de destinatário. O endereço real é o visitante da CONVERSA (a
 * leitura é por conversa), e o contato não carrega nada que pareça endereço.
 */
const DESTINO_PELO_VISITANTE = "visitante-do-site";

const TIPOS_ACEITOS: ReadonlySet<OutboundKind> = new Set<OutboundKind>([
  "text",
  "image",
  "video",
  "audio",
  "document",
]);

/** Prefixo do id que este canal dá às mensagens que aceita. */
export const PREFIXO_DO_ID_DO_CHAT = "wc:";

export const webchatAdapter: ChannelAdapter = {
  provider: "webchat",

  resolveRecipient(input: RecipientInput): string | null {
    // Não há grupo no chat do site (`groups: "none"`).
    if (input.isGroup) return null;
    return DESTINO_PELO_VISITANTE;
  },

  /** Não há credencial: o "transporte" é o próprio banco. */
  isConfigured(): boolean {
    return true;
  },

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    if (!TIPOS_ACEITOS.has(envelope.kind)) {
      throw new Error(`webchat_kind_not_supported: o chat do site não mostra ${envelope.kind}.`);
    }
    if (envelope.kind === "text" && (!envelope.body || envelope.body.trim().length === 0)) {
      throw new Error("webchat_empty_body: mensagem de texto sem corpo.");
    }
    await envelope.beforeSend?.();
    return { externalId: `${PREFIXO_DO_ID_DO_CHAT}${randomUUID()}` };
  },

  codes: {
    notConfigured: "webchat_not_configured",
    sendFailed: "webchat_error",
    unknownError: "webchat_unknown",
  },
};
