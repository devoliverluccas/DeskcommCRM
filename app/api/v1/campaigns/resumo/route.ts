/**
 * POST /api/v1/campaigns/resumo — o resumo antes de enviar (fase 4, item 4.7).
 *
 * Quantos recebem (pela MESMA régua da preparação — `preverAudiencia`), a
 * categoria do modelo, o limite do número hoje, a janela de disparo, o ritmo e a
 * duração estimada. Não grava nada; é POST porque o pedido é um objeto, irmão de
 * `/api/v1/campaigns/preview` (que continua respondendo só a contagem).
 *
 * O custo não é estimado: não há tabela de preço por mensagem neste produto, e
 * a resposta leva `custo: null` para a tela dizer isso em vez de inventar um.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { conferirModeloDaCampanha } from "@/lib/campanhas/modelo-da-conexao";
import type { ModeloPreparado } from "@/lib/campanhas/preparacao";
import { resumirEnvio, resumoDoEnvioSchema } from "@/lib/campanhas/resumo-do-envio";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  // Guarda de suporte num handler que NÃO escreve — a mesma decisão da prévia:
  // o gate `tests/unit/suporte-cobertura-de-efeitos.test.ts` mede por MÉTODO.
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "campaigns" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = resumoDoEnvioSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Escolha pelo menos um critério de público."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  // Admin client com filtro explícito de organização (do papel, nunca do corpo):
  // a contagem varre a organização inteira, como a preparação.
  const admin = createAdminClient();
  try {
    let modelo: ModeloPreparado | undefined;
    if (parsed.data.modelo) {
      const m = parsed.data.modelo;
      const conferencia = await conferirModeloDaCampanha(
        admin,
        { organizationId: authz.org.orgId, channelSessionId: m.channel_session_id, name: m.name, language: m.language },
        m.variables,
      );
      if (conferencia.ok) {
        modelo = { definicao: conferencia.definicao, contrato: conferencia.contrato, variaveis: m.variables };
      }
    }
    const resumo = await resumirEnvio(admin, {
      organizationId: authz.org.orgId,
      pedido: parsed.data,
      ...(modelo ? { modelo } : {}),
      agora: new Date(),
    });
    return ok(resumo, { requestId });
  } catch (err) {
    return fail("internal_error", err instanceof Error ? t(err.message) : String(err), 500, { requestId });
  }
}
