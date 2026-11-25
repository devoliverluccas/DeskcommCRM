/**
 * O que as três rotas PÚBLICAS do chat do site têm em comum: achar a conexão
 * pela chave, conferir o `Origin` contra os domínios permitidos, limitar por IP
 * e devolver CORS só para quem passou.
 *
 * Nada aqui depende de cookie: a rota pública é chamada de OUTRO domínio (o
 * site da empresa), sem credencial, e o proxy global a deixa passar pela
 * entrada em `lib/auth/public-paths.ts`. "Público" ali quer dizer "o proxy não
 * decide" — quem decide é este módulo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { parseAcceptLanguage, IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";

import { origemPermitida } from "./config";
import { conexaoPelaChave, type ConexaoDoChat } from "./sessao";
import { CABECALHO_DO_VISITANTE, hashDoVisitante, tokenDoVisitanteValido } from "./visitante";

/** Teto de caracteres de uma mensagem do visitante. */
export const MAX_TEXTO_DO_VISITANTE = 2000;

/** Limites por janela de 60 s. */
export const LIMITES = {
  /** Leitura de config e polling, por IP e conexão: o polling de 4 s dá 15/min por aba. */
  leituraPorIp: 120,
  /** Abrir sessão nova, por IP e conexão. */
  sessaoPorIp: 10,
  /** Envio, por IP e conexão. */
  envioPorIp: 30,
  /** Envio, por visitante. */
  envioPorVisitante: 12,
} as const;

/** Os cabeçalhos de CORS para um Origin JÁ conferido. Sem credencial, nunca `*`. */
export function cabecalhosDeCors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": `content-type, ${CABECALHO_DO_VISITANTE}`,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function comCors<T extends Response>(res: T, origin: string | null): T {
  if (origin) for (const [k, v] of Object.entries(cabecalhosDeCors(origin))) res.headers.set(k, v);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Recusa SEM CORS: o navegador do site não lê o corpo, e quem não é o site não
 * aprende nada além do status. 404 serve para chave inexistente, conexão
 * desligada e origem fora da lista — dizer qual seria ensinar a quem sonda.
 */
function naoEncontrado(requestId: string): NextResponse {
  const res = fail("not_found", "Not found", 404, { requestId });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Vary", "Origin");
  return res;
}

export type PedidoDoChat =
  | { ok: true; conexao: ConexaoDoChat; origin: string; ip: string | null }
  | { ok: false; response: NextResponse };

/**
 * A porta das rotas públicas: chave → conexão ativa e ligada → Origin na lista
 * → limite por IP. Devolve a conexão (a organização sai DELA) ou a resposta de
 * recusa pronta.
 */
export async function abrirPedidoDoChat(
  admin: SupabaseClient,
  req: Request,
  chave: string,
  opts: { requestId: string; balde: string; limitePorIp: number },
): Promise<PedidoDoChat> {
  let conexao: ConexaoDoChat | null;
  try {
    conexao = await conexaoPelaChave(admin, chave);
  } catch {
    const res = fail("internal_error", "Tente de novo em instantes.", 503, { requestId: opts.requestId });
    res.headers.set("Retry-After", "5");
    return { ok: false, response: res };
  }
  if (!conexao || !conexao.config.ativo) return { ok: false, response: naoEncontrado(opts.requestId) };

  const origin = req.headers.get("origin");
  if (!origemPermitida(origin, conexao.config.dominios)) {
    return { ok: false, response: naoEncontrado(opts.requestId) };
  }

  const ip = ipDoCliente(req.headers);
  const limite = await checkRateLimit(
    `webchat:${opts.balde}:${conexao.id}:${ip ?? "sem-ip"}`,
    opts.limitePorIp,
    60,
  );
  if (!limite.allowed) {
    const res = fail("rate_limited", "Muitas mensagens em pouco tempo. Tente de novo em instantes.", 429, {
      requestId: opts.requestId,
      headers: { "Retry-After": "60" },
    });
    return { ok: false, response: comCors(res, origin!) };
  }
  return { ok: true, conexao, origin: origin!, ip };
}

/** Resposta do preflight: CORS só se a chave existe, está ligada e o Origin é da lista. */
export async function preflightDoChat(admin: SupabaseClient, req: Request, chave: string): Promise<Response> {
  let conexao: ConexaoDoChat | null = null;
  try {
    conexao = await conexaoPelaChave(admin, chave);
  } catch {
    conexao = null;
  }
  const origin = req.headers.get("origin");
  if (!conexao || !conexao.config.ativo || !origemPermitida(origin, conexao.config.dominios)) {
    return new Response(null, { status: 204, headers: { Vary: "Origin" } });
  }
  return new Response(null, { status: 204, headers: cabecalhosDeCors(origin!) });
}

/** O token do visitante do cabeçalho, quando tem a forma certa. */
export function tokenDoPedido(req: Request): string | null {
  const bruto = req.headers.get(CABECALHO_DO_VISITANTE);
  return tokenDoVisitanteValido(bruto) ? bruto : null;
}

/** O idioma dos textos da janela: o do navegador do visitante, quando servido. */
export function idiomaDoPedido(req: Request): Idioma {
  return parseAcceptLanguage(req.headers.get("accept-language")) ?? IDIOMA_PADRAO;
}

/** Limite por visitante — o segundo balde do envio. */
export async function visitanteDentroDoLimite(conexaoId: string, token: string): Promise<boolean> {
  const r = await checkRateLimit(
    `webchat:visitante:${conexaoId}:${hashDoVisitante(token).slice(0, 24)}`,
    LIMITES.envioPorVisitante,
    60,
  );
  return r.allowed;
}
