/**
 * GET /l/<codigo> — o link curto de SAÍDA (fase 4, item 4.4, migration 9490).
 *
 * Quem chega aqui é o CONTATO, tocando no link que recebeu numa mensagem —
 * nunca tem, e não pode ter, sessão nossa. Por isso a rota é pública
 * (`lib/auth/public-paths.ts`, âncora no formato exato do código) e nada nela
 * depende de cookie. Mesmo molde de `/api/v1/rastreio/[id]` (0437):
 *
 *   - limite por IP + código ANTES de ler o banco;
 *   - a organização vem da LINHA do link, nunca da requisição;
 *   - 302 para o destino gravado (http/https conferido na criação e no CHECK);
 *   - clique registrado sem travar o redirecionamento.
 *
 * Código malformado, inexistente ou de contato anonimizado: a mesma página
 * "link indisponível" (404), sem dizer qual dos três.
 */
import { type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { comIdDaRequisicao, fail } from "@/lib/api/wrappers";
import { clientIp, paginaDeSaida } from "@/lib/plataformas-de-anuncio/pagina-de-captura";
import {
  FORMATO_DO_CODIGO,
  linkPeloCodigo,
  registrarClique,
} from "@/lib/plataformas-de-anuncio/rastreio/links-de-saida";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  if (!FORMATO_DO_CODIGO.test(codigo)) return comIdDaRequisicao(paginaDeSaida(null), req);

  const ip = clientIp(req);
  if (ip && !(await checkRateLimit(`link-de-saida:${codigo}:${ip}`, 30, 60)).allowed) {
    return fail("rate_limited", "Muitos acessos a este link. Tente de novo em um minuto.", 429, {
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }

  const admin = createAdminClient();
  const link = await linkPeloCodigo(admin, codigo);
  if (!link) return comIdDaRequisicao(paginaDeSaida(null), req);

  await registrarClique(admin, link, { userAgent: req.headers.get("user-agent"), ip });

  const response = comIdDaRequisicao(paginaDeSaida(link.destino_url), req);
  response.headers.set("Cache-Control", "no-store");
  // O destino não precisa saber de onde a pessoa veio (nem o código dela).
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}
