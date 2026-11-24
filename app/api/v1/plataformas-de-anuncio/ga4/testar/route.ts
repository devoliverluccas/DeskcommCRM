import { requireSupportWrite } from "@/lib/impersonate/support";
import { testarConexao } from "@/lib/plataformas-de-anuncio/rotas-da-conexao";

/**
 * POST /api/v1/plataformas-de-anuncio/ga4/testar — "Testar conexão" (9488).
 * Fala com a plataforma pelo caminho que não conta conversão. É efeito
 * externo, então passa pela guarda de suporte.
 */
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  return testarConexao("ga4");
}
