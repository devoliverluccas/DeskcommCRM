import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const Corpo = z.object({ motivo: z.string().trim().min(1).max(500) });

const COLUNAS = "id, display_name, phone_number, is_blocked, blocked_reason, blocked_at";

/**
 * POST /api/v1/contacts/[id]/bloquear — BLOQUEIA O CONTATO pela tela (item 3.7).
 *
 * ## O que o bloqueio faz
 *
 * Grava a MESMA trava que o pedido de descadastro grava na ingestão
 * (`lib/channels/pos-entrada.ts`): `is_blocked = true`, `blocked_reason`,
 * `blocked_at`. Quem já obedece a ela continua obedecendo, sem regra nova:
 * `before-send.ts` recusa o envio (`is_blocked or force_human`), a guarda das
 * automações (`lib/automation/guarda-do-contato.ts`) devolve `contact_blocked`,
 * follow-up, campanha, e-mail e o modo "IA com o dono" param. As mensagens que o
 * contato manda continuam CHEGANDO — bloquear é parar de falar com ele, não
 * apagar o que ele diz.
 *
 * O par desta rota é `POST /contacts/[id]/unblock` (admin), que limpa os mesmos
 * três campos. Por isso o motivo vai para `blocked_reason`, ao lado do
 * `stop_keyword` do descadastro: é o porquê que fica no contato.
 *
 * ## Por que `manager`, e o desbloqueio `admin`
 *
 * Bloquear FECHA um canal — decisão operacional (spam, abuso, cliente que pediu
 * por outro meio), do mesmo nível de "marcar como pessoal". Desbloquear REABRE um
 * canal que pode ter sido fechado pelo próprio cliente (direito de oposição), e
 * por isso é do admin. Dois gestos parecidos, dois gates, cada um com seu motivo.
 *
 * ## O que NÃO faz
 *
 * Não fecha negócio nem demanda (o descadastro fecha; um bloqueio manual pode
 * ser temporário, e o desbloqueio não teria como reabrir o que fechasse). Contato
 * já bloqueado devolve a linha como está, sem segunda auditoria.
 */
export async function POST(req: NextRequest, ctx: Context): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("manager", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", t("Contato inválido."), 422, { requestId });
  }
  const corpo = Corpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", t("Informe o motivo do bloqueio."), 422, { requestId });
  }

  const admin = createAdminClient();
  // Admin client bypassa RLS: o filtro por organização é PROGRAMÁTICO e
  // obrigatório (CLAUDE.md, anti-pattern 10).
  const { data: atual, error: erroDaLeitura } = await admin
    .from("contacts")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (erroDaLeitura) {
    return fail("internal_error", t("Não foi possível bloquear o contato."), 500, { requestId });
  }
  if (!atual) return fail("not_found", t("Contato não encontrado."), 404, { requestId });
  if ((atual as { is_blocked?: boolean }).is_blocked === true) return ok(atual, { requestId });

  const { data, error } = await admin
    .from("contacts")
    .update({ is_blocked: true, blocked_reason: corpo.data.motivo, blocked_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS)
    .maybeSingle();
  if (error) {
    return fail("internal_error", t("Não foi possível bloquear o contato."), 500, { requestId });
  }
  if (!data) return fail("not_found", t("Contato não encontrado."), 404, { requestId });

  // Espelha o registro do descadastro (`contact.blocked`, mesmo `resourceType` e
  // `contact_id` no metadata). O TEXTO do motivo não entra: ele fica na ficha
  // (`blocked_reason`), e a auditoria não é lugar de texto livre.
  await audit({
    action: "contact.blocked",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "contact",
    resourceId: id,
    requestId,
    metadata: { reason: "manual", contact_id: id, origem: "tela_da_conversa" },
  });

  return ok(data, { requestId });
}
