import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import type { FeriadoDaOrganizacao } from "./regra";

/**
 * Os feriados CADASTRADOS da organização (tabela `feriados`, migration 9486).
 *
 * NUNCA lança: quem lê é o roteamento (`lib/routing/eligibles.ts`), e uma falha
 * aqui não pode parar a distribuição de conversas. Falhou (ou a tabela ainda não
 * existe numa instalação que não aplicou a 9486), a organização fica sem
 * feriado cadastrado — o comportamento de antes desta entrega.
 *
 * O client é injetado: o roteador passa o admin (service role), e por isso o
 * recorte de organização é manual e obrigatório.
 */
export async function carregarFeriadosDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<FeriadoDaOrganizacao[]> {
  try {
    const { data, error } = await db
      .from("feriados")
      .select("data, nome, recorrente_anual")
      .eq("organization_id", organizationId);
    if (error) {
      logger.warn("[feriados] leitura falhou; segue sem feriado cadastrado", {
        organization_id: organizationId,
        detail: error.message.slice(0, 160),
      });
      return [];
    }
    return Array.isArray(data) ? (data as FeriadoDaOrganizacao[]) : [];
  } catch (err) {
    logger.warn("[feriados] leitura falhou; segue sem feriado cadastrado", {
      organization_id: organizationId,
      detail: err instanceof Error ? err.message.slice(0, 160) : "desconhecido",
    });
    return [];
  }
}
