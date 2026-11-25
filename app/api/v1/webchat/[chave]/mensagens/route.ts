import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { contatoDoVisitante, ingerirMensagemDoVisitante } from "@/lib/channels/webchat/ingest";
import { mensagensParaOVisitante } from "@/lib/channels/webchat/mensagens";
import {
  abrirPedidoDoChat,
  comCors,
  LIMITES,
  MAX_TEXTO_DO_VISITANTE,
  preflightDoChat,
  tokenDoPedido,
  visitanteDentroDoLimite,
} from "@/lib/channels/webchat/publico";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET  /api/v1/webchat/{chave}/mensagens?depois=ISO — PÚBLICA. O polling do
 *      script: as mensagens da conversa DESTE visitante a partir do cursor.
 * POST /api/v1/webchat/{chave}/mensagens — PÚBLICA. O visitante escreveu: a
 *      mensagem entra pela mesma esteira dos outros canais (Inbox, negócio,
 *      rodízio, agente de IA).
 *
 * As duas exigem o token do visitante no cabeçalho `X-Webchat-Visitante`
 * (nunca em query string). A organização sai da LINHA da chave, nunca do corpo;
 * o contato sai do hash do token, nunca de um id enviado pelo visitante.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ chave: string }> };

const envioSchema = z.object({
  /** Id que o script sorteou para esta mensagem — a chave do reenvio idempotente. */
  id: z.uuid(),
  texto: z.string().trim().min(1).max(MAX_TEXTO_DO_VISITANTE),
  nome: z.string().trim().max(80).optional().nullable(),
  email: z.email().max(200).optional().nullable().or(z.literal("")),
});

const cursorSchema = z.iso.datetime({ offset: true }).optional();

export async function OPTIONS(req: NextRequest, ctx: Ctx): Promise<Response> {
  return preflightDoChat(createAdminClient(), req, (await ctx.params).chave);
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();
  const pedido = await abrirPedidoDoChat(admin, req, (await ctx.params).chave, {
    requestId,
    balde: "leitura",
    limitePorIp: LIMITES.leituraPorIp,
  });
  if (!pedido.ok) return pedido.response;

  const token = tokenDoPedido(req);
  if (!token) return comCors(fail("unauthorized", "Sessão do visitante ausente.", 401, { requestId }), pedido.origin);
  const cursor = cursorSchema.safeParse(req.nextUrl.searchParams.get("depois") ?? undefined);
  if (!cursor.success) {
    return comCors(fail("invalid_request", "Cursor inválido.", 422, { requestId }), pedido.origin);
  }

  try {
    const contato = await contatoDoVisitante(admin, pedido.conexao.organizationId, pedido.conexao.id, token);
    if (!contato) return comCors(ok({ mensagens: [], encerrada: false }, { requestId }), pedido.origin);
    // LGPD: ficha anonimizada não devolve nada — o script descarta o token.
    if (contato.is_anonymized) return comCors(ok({ mensagens: [], encerrada: true }, { requestId }), pedido.origin);
    const mensagens = await mensagensParaOVisitante(admin, {
      organizationId: pedido.conexao.organizationId,
      channelSessionId: pedido.conexao.id,
      contactId: contato.id,
      depois: cursor.data ?? null,
    });
    return comCors(ok({ mensagens, encerrada: false }, { requestId }), pedido.origin);
  } catch (err) {
    logger.warn("webchat: leitura das mensagens falhou", { detalhe: err instanceof Error ? err.message : "?" });
    return comCors(fail("internal_error", "Tente de novo em instantes.", 503, { requestId }), pedido.origin);
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const admin = createAdminClient();
  const pedido = await abrirPedidoDoChat(admin, req, (await ctx.params).chave, {
    requestId,
    balde: "envio",
    limitePorIp: LIMITES.envioPorIp,
  });
  if (!pedido.ok) return pedido.response;

  const token = tokenDoPedido(req);
  if (!token) return comCors(fail("unauthorized", "Sessão do visitante ausente.", 401, { requestId }), pedido.origin);
  if (!(await visitanteDentroDoLimite(pedido.conexao.id, token))) {
    return comCors(
      fail("rate_limited", "Muitas mensagens em pouco tempo. Tente de novo em instantes.", 429, {
        requestId,
        headers: { "Retry-After": "60" },
      }),
      pedido.origin,
    );
  }

  const parsed = envioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return comCors(fail("validation_failed", "Mensagem inválida.", 422, { requestId }), pedido.origin);
  }

  try {
    const desfecho = await ingerirMensagemDoVisitante(admin, {
      organizationId: pedido.conexao.organizationId,
      channelSessionId: pedido.conexao.id,
      token,
      idDoCliente: parsed.data.id,
      texto: parsed.data.texto,
      nome: parsed.data.nome ?? null,
      email: parsed.data.email || null,
      requestId,
    });
    if (desfecho.status === "encerrada") {
      return comCors(ok({ aceita: false, encerrada: true }, { requestId }), pedido.origin);
    }
    if (desfecho.status === "ignored") {
      return comCors(fail("internal_error", "Chat indisponível nesta instalação.", 503, { requestId }), pedido.origin);
    }
    return comCors(
      ok(
        {
          aceita: true,
          encerrada: false,
          id: desfecho.status === "ingested" ? desfecho.messageId : null,
          criada_em: desfecho.status === "ingested" ? desfecho.criadaEm : null,
        },
        { requestId, status: desfecho.status === "ingested" ? 201 : 200 },
      ),
      pedido.origin,
    );
  } catch (err) {
    logger.error("webchat: entrada da mensagem falhou", { detalhe: err instanceof Error ? err.message : "?" });
    return comCors(fail("internal_error", "Tente de novo em instantes.", 503, { requestId }), pedido.origin);
  }
}
