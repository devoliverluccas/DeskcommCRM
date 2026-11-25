/**
 * A LOJA DE CADA ORÇAMENTO (item 5.4, `proposta_da_loja`).
 *
 * Na CRIAÇÃO a proposta registra a loja: a do número da conversa de onde o
 * orçamento saiu (`loja_do_numero`) e, sem conversa ou sem vínculo, a loja
 * padrão. Depois disso a loja é a que está gravada — trocar o número de loja
 * não reescreve de onde os orçamentos antigos saíram. A tela da proposta deixa
 * corrigir (`PUT /api/v1/lojas/propostas/[id]`).
 *
 * Nunca lança e nunca bloqueia a criação: sem o módulo, sem a empresa ter
 * ligado ou com o banco recusando, a proposta nasce exatamente como antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { lojasLigadas } from "./modulo";

/** A loja que vale para um número: a vinculada a ele, senão a padrão ativa. `null` = nenhuma. */
export async function lojaDoNumeroOuPadrao(
  db: SupabaseClient,
  orgId: string,
  channelSessionId: string | null,
): Promise<string | null> {
  if (channelSessionId) {
    const { data } = await db
      .from("loja_do_numero")
      .select("loja_id")
      .eq("organization_id", orgId)
      .eq("channel_session_id", channelSessionId)
      .maybeSingle();
    const loja = (data as { loja_id?: string } | null)?.loja_id;
    if (loja) return loja;
  }
  const { data: padrao } = await db
    .from("lojas")
    .select("id")
    .eq("organization_id", orgId)
    .eq("padrao", true)
    .eq("ativa", true)
    .maybeSingle();
  return (padrao as { id?: string } | null)?.id ?? null;
}

export async function registrarLojaDaPropostaNaCriacao(
  db: SupabaseClient,
  orgId: string,
  proposalId: string,
  conversationId: string | null,
): Promise<string | null> {
  try {
    if (!(await lojasLigadas(db, orgId))) return null;
    let numero: string | null = null;
    if (conversationId) {
      const { data } = await db
        .from("conversations")
        .select("channel_session_id")
        .eq("organization_id", orgId)
        .eq("id", conversationId)
        .maybeSingle();
      numero = (data as { channel_session_id?: string } | null)?.channel_session_id ?? null;
    }
    const loja = await lojaDoNumeroOuPadrao(db, orgId, numero);
    if (!loja) return null;
    const { error } = await db
      .from("proposta_da_loja")
      .upsert({ organization_id: orgId, proposal_id: proposalId, loja_id: loja }, { onConflict: "proposal_id", ignoreDuplicates: true });
    if (error) {
      logger.warn("lojas: não deu para registrar a loja da proposta", {
        organization_id: orgId,
        codigo: error.code,
        detalhe: error.message,
      });
      return null;
    }
    return loja;
  } catch (erro) {
    logger.warn("lojas: registro da loja da proposta falhou", {
      organization_id: orgId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}
