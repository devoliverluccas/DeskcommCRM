/**
 * As lojas que uma TELA mostra (relatórios, propostas, produto).
 *
 * Vazia quando o módulo `lojas` não está instalado, a empresa não ligou, ou a
 * leitura falhou: a tela trata "nenhuma loja" como "o recurso não existe aqui"
 * e não desenha filtro, coluna nem seletor. Nunca lança — roda no servidor de
 * telas que existem sem o módulo e não podem cair por causa dele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { lojasLigadas } from "./modulo";
import { ordenarLojas } from "./schemas";

export interface LojaDoSeletor {
  id: string;
  nome: string;
  ativa: boolean;
  padrao: boolean;
}

export async function lojasDaTela(
  admin: SupabaseClient,
  orgId: string,
  { soAtivas = false }: { soAtivas?: boolean } = {},
): Promise<LojaDoSeletor[]> {
  try {
    if (!(await lojasLigadas(admin, orgId))) return [];
    let consulta = admin.from("lojas").select("id, nome, ativa, padrao").eq("organization_id", orgId);
    if (soAtivas) consulta = consulta.eq("ativa", true);
    const { data, error } = await consulta.limit(500);
    if (error) {
      logger.warn("lojas: leitura da tela recusada — tela sem lojas", { organization_id: orgId, codigo: error.code });
      return [];
    }
    return ordenarLojas((data ?? []) as LojaDoSeletor[]);
  } catch (erro) {
    logger.warn("lojas: leitura da tela falhou — tela sem lojas", {
      organization_id: orgId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return [];
  }
}
