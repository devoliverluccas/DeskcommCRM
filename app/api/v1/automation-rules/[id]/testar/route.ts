import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/automation-rules/[id]/testar — simula a regra contra um contato
 * (ou uma conversa) escolhido, SEM EFEITO (fase 4, 4.1).
 *
 * Avalia o gatilho quando dá (a palavra-chave contra o texto de exemplo), avalia
 * as condições de verdade e DESCREVE o que cada ação faria — nenhum executor é
 * chamado. A lógica mora em `lib/automation/simular-regra.ts`.
 *
 * A única escrita é a auditoria (`automation.rule_tested`): quem testou qual
 * regra contra qual contato. Por isso o `requireSupportWrite`, que o gate de
 * suporte exige de todo POST — e porque a leitura do contato de um cliente por
 * quem acompanha o suporte também é ato a registrar.
 *
 * Auth: manager+ (a mesma régua de criar e editar automação). As leituras usam o
 * client da sessão (RLS) — o teste não enxerga o que quem testa não enxerga — e
 * a organização vem da sessão, nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { simularRegra, type RegraParaSimular } from "@/lib/automation/simular-regra";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const corpoSchema = z
  .object({
    contact_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    /** A mensagem de exemplo — só o gatilho de palavra-chave e as condições de texto a leem. */
    texto: z.string().max(4000).optional(),
  })
  .refine((c) => Boolean(c.contact_id || c.conversation_id), {
    message: "Escolha o contato",
    path: ["contact_id"],
  });

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  const authz = await requireRole("manager", { requestId, resource: "automation_rules" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org: activeOrg } = authz;

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = corpoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("invalid_request", t(parsed.error.issues[0]?.message ?? "Dados inválidos."), 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const supabase = await createClient();
  const { data: regra, error: erroDaRegra } = await supabase
    .from("automation_rules")
    .select("id, trigger_event, trigger_config, conditions, actions")
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (erroDaRegra) return fail("internal_error", erroDaRegra.message, 500, { requestId });
  if (!regra) return fail("not_found", t("Regra não encontrada."), 404, { requestId });

  const resultado = await simularRegra({
    db: supabase,
    organizationId: activeOrg.orgId,
    regra: regra as unknown as RegraParaSimular,
    contactId: parsed.data.contact_id ?? null,
    conversationId: parsed.data.conversation_id ?? null,
    texto: parsed.data.texto ?? null,
  });
  if ("erro" in resultado) {
    const soConversa = Boolean(parsed.data.conversation_id && !parsed.data.contact_id);
    return fail("not_found", t(soConversa ? "Conversa não encontrada." : "Contato não encontrado."), 404, {
      requestId,
    });
  }

  await audit({
    action: "automation.rule_tested",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "automation_rule",
    resourceId: id,
    requestId,
    metadata: {
      contact_id: resultado.alvo.contato?.id ?? null,
      conversation_id: resultado.alvo.conversa_id,
      rodaria: resultado.rodaria,
    },
  });

  return ok(resultado, { requestId });
}
