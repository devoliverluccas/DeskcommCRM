/**
 * GET /api/v1/channels/official/saude — a saúde do número oficial (item 5.5).
 *
 * Devolve a última leitura guardada (nota, limite de conversas, último evento da
 * conta e quando foi lida). Quando a leitura envelheceu — ou `?atualizar=1` —,
 * pergunta à Graph antes de responder: é o "ler o estado atual ao abrir a tela".
 * A pergunta é limitada no tempo e nunca derruba a resposta: se a Graph falhar,
 * volta a leitura guardada com o motivo em `leitura.erro`.
 *
 * Só leitura do ponto de vista de quem chama (o espelho das colunas é cache do
 * que a Meta diz), por isso não há auditoria nem `requireSupportWrite`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  atualizarSaudePelaGraph,
  leituraEnvelheceu,
  saudeDaConexaoOficial,
} from "@/lib/channels/meta/saude-do-numero";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  let conexao = await saudeDaConexaoOficial(admin, orgId);
  if (!conexao) return ok({ conectado: false, saude: null, leitura: null }, { requestId });

  const forcar = req.nextUrl.searchParams.get("atualizar") === "1";
  let leitura: { origem: "guardada" | "graph"; erro: string | null } = { origem: "guardada", erro: null };

  if (forcar || leituraEnvelheceu(conexao.atualizadaEm, new Date())) {
    const r = await atualizarSaudePelaGraph(admin, {
      organizationId: orgId,
      channelSessionId: conexao.channelSessionId,
      phoneNumberId: conexao.phoneNumberId,
    });
    if (r.desfecho === "saude:falhou" || r.desfecho === "graph:sem_credencial") {
      leitura = { origem: "guardada", erro: r.motivo ?? r.desfecho };
    } else {
      leitura = { origem: "graph", erro: null };
      conexao = (await saudeDaConexaoOficial(admin, orgId)) ?? conexao;
    }
  }

  if (!conexao) return fail("not_found", "Conexão oficial não encontrada.", 404, { requestId });
  const { channelSessionId, qualidade, limite, conversasPorDia, eventoDaConta, atualizadaEm } = conexao;
  return ok(
    {
      conectado: true,
      saude: {
        channel_session_id: channelSessionId,
        qualidade,
        limite,
        conversas_por_dia: conversasPorDia === undefined ? null : conversasPorDia,
        sem_limite: conversasPorDia === null,
        evento_da_conta: eventoDaConta,
        atualizada_em: atualizadaEm,
      },
      leitura,
    },
    { requestId },
  );
}
