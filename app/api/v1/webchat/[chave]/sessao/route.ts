import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { contatoDoVisitante } from "@/lib/channels/webchat/ingest";
import { abrirPedidoDoChat, comCors, LIMITES, preflightDoChat, tokenDoPedido } from "@/lib/channels/webchat/publico";
import { novoTokenDoVisitante } from "@/lib/channels/webchat/visitante";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/v1/webchat/{chave}/sessao — PÚBLICA. Abre (ou confirma) a sessão do
 * visitante e devolve o token que o script guarda no `localStorage` do site.
 *
 * NÃO grava nada: o contato nasce na primeira MENSAGEM, não na visita. Uma
 * página aberta por mil pessoas não pode virar mil fichas no CRM.
 *
 * Com um token válido no cabeçalho, devolve o mesmo — a menos que a ficha dele
 * tenha sido anonimizada (LGPD): aí sorteia outro, e a conversa antiga não volta.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ chave: string }> };

export async function OPTIONS(req: NextRequest, ctx: Ctx): Promise<Response> {
  return preflightDoChat(createAdminClient(), req, (await ctx.params).chave);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();
  const pedido = await abrirPedidoDoChat(admin, req, (await ctx.params).chave, {
    requestId,
    balde: "sessao",
    limitePorIp: LIMITES.sessaoPorIp,
  });
  if (!pedido.ok) return pedido.response;

  const atual = tokenDoPedido(req);
  if (atual) {
    try {
      const contato = await contatoDoVisitante(admin, pedido.conexao.organizationId, pedido.conexao.id, atual);
      if (!contato?.is_anonymized) {
        return comCors(ok({ visitante: atual, nova: false }, { requestId }), pedido.origin);
      }
    } catch {
      return comCors(fail("internal_error", "Tente de novo em instantes.", 503, { requestId }), pedido.origin);
    }
  }
  return comCors(ok({ visitante: novoTokenDoVisitante(), nova: true }, { requestId, status: 201 }), pedido.origin);
}
