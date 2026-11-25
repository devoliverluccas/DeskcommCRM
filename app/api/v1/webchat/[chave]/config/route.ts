import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { traduzir } from "@/lib/i18n/dicionario";
import { abrirPedidoDoChat, comCors, idiomaDoPedido, LIMITES, MAX_TEXTO_DO_VISITANTE, preflightDoChat } from "@/lib/channels/webchat/publico";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/v1/webchat/{chave}/config — PÚBLICA. O que o script do site precisa
 * para desenhar a bolha: nome, saudação, cor, posição e os textos da janela no
 * idioma do navegador do visitante.
 *
 * Nada de organização, domínio permitido ou id de sessão sai daqui: o script
 * não precisa, e quem sonda não aprende. Chave inexistente, chat desligado e
 * Origin fora da lista respondem o mesmo 404 (`abrirPedidoDoChat`).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ chave: string }> };

export async function OPTIONS(req: NextRequest, ctx: Ctx): Promise<Response> {
  return preflightDoChat(createAdminClient(), req, (await ctx.params).chave);
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const pedido = await abrirPedidoDoChat(createAdminClient(), req, (await ctx.params).chave, {
    requestId,
    balde: "leitura",
    limitePorIp: LIMITES.leituraPorIp,
  });
  if (!pedido.ok) return pedido.response;

  const idioma = idiomaDoPedido(req);
  const t = (texto: string) => traduzir(texto, idioma);
  const { config } = pedido.conexao;
  return comCors(
    ok(
      {
        nome: config.nome,
        saudacao: config.saudacao,
        cor: config.cor,
        posicao: config.posicao,
        max_texto: MAX_TEXTO_DO_VISITANTE,
        intervalo_ms: 4000,
        textos: {
          abrir: t("Abrir conversa"),
          fechar: t("Fechar conversa"),
          mensagens: t("Mensagens da conversa"),
          placeholder: t("Escreva sua mensagem"),
          enviar: t("Enviar"),
          falha: t("Não foi possível enviar. Tente de novo."),
          arquivo: t("Arquivo"),
        },
      },
      { requestId },
    ),
    pedido.origin,
  );
}
