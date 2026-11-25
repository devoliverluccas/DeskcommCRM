/**
 * A conexão do chat do site em `channel_sessions` — do lado de dentro do seam.
 *
 * A rota e a tela falam em "chave" e "configuração"; quem sabe que isto é a
 * linha `provider = 'webchat'` com `webchat_public_key`/`webchat_config` é este
 * módulo. Toda consulta leva `organization_id` à mão (client de service role),
 * exceto `conexaoPelaChave`, que é justamente a que DESCOBRE a organização a
 * partir da chave pública — e devolve só a linha ativa daquela chave.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_WEBCHAT } from "../capabilities";
import { reactivateChannelSession } from "../reactivate";
import { lerConfigDoChat, type ConfigDoChat } from "./config";
import { chavePublicaValida, novaChavePublica } from "./visitante";

/** O nome do provider para quem mora fora de `lib/channels/`. */
export const PROVIDER_DO_CHAT_DO_SITE = CHANNEL_PROVIDER_WEBCHAT;

export interface ConexaoDoChat {
  id: string;
  organizationId: string;
  chave: string;
  config: ConfigDoChat;
  archivedAt: string | null;
}

const COLUNAS = "id, organization_id, webchat_public_key, webchat_config, archived_at";

function paraConexao(row: Record<string, unknown> | null | undefined): ConexaoDoChat | null {
  if (!row || typeof row.webchat_public_key !== "string") return null;
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    chave: row.webchat_public_key,
    config: lerConfigDoChat(row.webchat_config),
    archivedAt: (row.archived_at as string | null) ?? null,
  };
}

/**
 * A conexão da organização — a ATIVA primeiro; sem ativa, a arquivada mais
 * recente (salvar de novo a traz de volta, com a MESMA chave: o snippet que já
 * está colado no site volta a funcionar).
 *
 * LANÇA quando a consulta falha: "não há" e "não deu para perguntar" levam a
 * gestos diferentes.
 */
export async function acharConexaoDoChat(
  admin: SupabaseClient,
  organizationId: string,
): Promise<ConexaoDoChat | null> {
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .eq("provider", CHANNEL_PROVIDER_WEBCHAT)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`webchat_session_lookup_failed: ${error.message}`);
  return paraConexao((data as Record<string, unknown>[] | null)?.[0]);
}

/**
 * A conexão ATIVA dona desta chave pública, ou `null`. A organização sai da
 * LINHA, nunca do pedido. Chave fora da forma nem vai ao banco.
 */
export async function conexaoPelaChave(
  admin: SupabaseClient,
  chave: string,
): Promise<ConexaoDoChat | null> {
  if (!chavePublicaValida(chave)) return null;
  const { data, error } = await admin
    .from("channel_sessions")
    .select(COLUNAS)
    .eq("provider", CHANNEL_PROVIDER_WEBCHAT)
    .eq("webchat_public_key", chave)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(`webchat_key_lookup_failed: ${error.message}`);
  return paraConexao(data as Record<string, unknown> | null);
}

export type DesfechoDoSalvar =
  | { ok: true; conexao: ConexaoDoChat; criada: boolean }
  | { ok: false; reason: string; status: number };

/**
 * Cria ou atualiza a conexão com a configuração já validada.
 *
 * Criar sorteia a chave pública. `webhook_secret_encrypted` é NOT NULL na
 * tabela, e este canal não tem webhook: grava um segredo aleatório cifrado só
 * para a linha existir — ninguém o lê (`acceptsInboundWebhook` não aceita este
 * provider, então o caminho do webhook recusa o token da linha).
 */
export async function salvarConexaoDoChat(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    existente: ConexaoDoChat | null;
    config: ConfigDoChat;
    userId: string;
    requestId: string;
  },
): Promise<DesfechoDoSalvar> {
  const patch = {
    webchat_config: input.config,
    display_name: input.config.nome,
    status: "WORKING",
  };

  if (input.existente) {
    const r = await reactivateChannelSession(
      admin,
      {
        organizationId: input.organizationId,
        channelSessionId: input.existente.id,
        archivedAt: input.existente.archivedAt,
      },
      patch,
      { userId: input.userId, requestId: input.requestId, metadata: { provider: CHANNEL_PROVIDER_WEBCHAT } },
    );
    if (r.error) return { ok: false, reason: "Não foi possível salvar o chat do site.", status: 500 };
    return {
      ok: true,
      criada: false,
      conexao: { ...input.existente, config: input.config, archivedAt: null },
    };
  }

  const segredo = await encryptWebhookSecret(admin, randomBytes(32).toString("hex"));
  if (!segredo) {
    return { ok: false, reason: "Cifra indisponível nesta instalação — o chat não foi criado.", status: 422 };
  }
  const chave = novaChavePublica();
  const { data, error } = await admin
    .from("channel_sessions")
    .insert({
      organization_id: input.organizationId,
      provider: CHANNEL_PROVIDER_WEBCHAT,
      webchat_public_key: chave,
      webhook_secret_encrypted: segredo,
      created_by: input.userId,
      metadata: metadataInicialDoCanal(),
      ...patch,
    })
    .select(COLUNAS)
    .maybeSingle();
  const conexao = paraConexao(data as Record<string, unknown> | null);
  if (error || !conexao) {
    // 23514 = o banco ainda não conhece o provider (clone sem a migration 9494).
    const falta = error?.code === "23514" ? " Atualize a instalação: falta a migration do chat do site." : "";
    return { ok: false, reason: `Não foi possível criar o chat do site.${falta}`, status: 500 };
  }
  return { ok: true, criada: true, conexao };
}
