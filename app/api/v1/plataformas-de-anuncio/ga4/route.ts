import type { NextRequest } from "next/server";

import { requireSupportWrite } from "@/lib/impersonate/support";
import { gravarConexao, lerConexao } from "@/lib/plataformas-de-anuncio/rotas-da-conexao";

/**
 * GET/PUT /api/v1/plataformas-de-anuncio/ga4 — a conexão de conversões do
 * Google Analytics 4 (9488): identificador, segredo cifrado, interruptor e regras de evento.
 * O corpo mora em `lib/plataformas-de-anuncio/rotas-da-conexao.ts`, comum ao
 * GA4 e ao TikTok.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return lerConexao("ga4");
}

export async function PUT(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  return gravarConexao(req, "ga4");
}
