/**
 * POST /o/[token]/decidir — O CLIENTE ACEITA OU RECUSA PELO LINK (9480).
 *
 * Rota pública (entrada em `lib/auth/public-paths.ts`), sem cookie e sem
 * sessão: a autoridade é o token do caminho, e a organização sai da linha do
 * link. Recebe o formulário HTML da página (`DecisaoDoOrcamento`) e responde
 * 303 de volta para ela — com `?r=` (decidiu) ou `?erro=` (não decidiu). Quem
 * grava é `decidirPeloLink` → `registrarDecisao`, o MESMO caminho da decisão
 * da equipe: atividade no negócio, retorno automático cancelado, auditoria.
 *
 * Sem `requireSupportWrite`: aquela guarda é de quem age DENTRO da organização
 * com sessão (o acompanhamento de suporte); aqui quem age é o cliente final,
 * sem sessão nenhuma. Sem CSRF pelo mesmo motivo — não há cookie para roubar.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { comIdDaRequisicao, fail } from "@/lib/api/wrappers";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { logger } from "@/lib/logger";
import { hashDoToken, tokenTemFormato } from "@/lib/propostas/link-publico";
import { decidirPeloLink } from "@/lib/propostas/orcamento-publico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Decisões por IP em 10 minutos, e por link — clique duplo e robô, não cliente. */
const POR_IP = 10;
const POR_LINK = 5;
const JANELA_S = 600;

const formSchema = z.object({
  decisao: z.enum(["aceita", "recusada"]),
  motivo: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((m) => (m ? m : null)),
});

type Ctx = { params: Promise<{ token: string }> };

/** 303 para a página do orçamento. `Location` relativo: vale atrás de qualquer proxy. */
function voltar(token: string, consulta: string, requestId: string): Response {
  return comIdDaRequisicao(
    new Response(null, {
      status: 303,
      headers: {
        Location: `/o/${encodeURIComponent(token)}?${consulta}`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Request-Id": requestId,
      },
    }),
    requestId,
  );
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { token } = await ctx.params;
  if (!tokenTemFormato(token)) {
    return fail("not_found", "Orçamento não encontrado", 404, { requestId });
  }

  const ip = ipDoCliente(req.headers);
  const porIp = ip ? await checkRateLimit(`orcamento-decidir:ip:${ip}`, POR_IP, JANELA_S) : { allowed: true };
  const porLink = await checkRateLimit(`orcamento-decidir:link:${hashDoToken(token).slice(0, 32)}`, POR_LINK, JANELA_S);
  if (!porIp.allowed || !porLink.allowed) return voltar(token, "erro=limite", requestId);

  const form = await req.formData().catch(() => null);
  const parsed = formSchema.safeParse({
    decisao: form?.get("decisao") ?? undefined,
    motivo: form?.get("motivo") ?? undefined,
  });
  if (!parsed.success) return voltar(token, "erro=falha", requestId);

  try {
    const r = await decidirPeloLink(createAdminClient(), {
      token,
      decisao: parsed.data.decisao,
      motivo: parsed.data.motivo,
      requestId,
    });
    if (r.ok) return voltar(token, `r=${r.decisao}`, requestId);
    if (r.motivo === "nao_encontrado") {
      return fail("not_found", "Orçamento não encontrado", 404, { requestId });
    }
    return voltar(token, r.motivo === "fechado" ? "erro=fechado" : "erro=falha", requestId);
  } catch (erro) {
    logger.error("orcamento-publico.decidir: falhou", {
      requestId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return voltar(token, "erro=falha", requestId);
  }
}
