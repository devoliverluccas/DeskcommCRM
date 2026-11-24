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

/**
 * /api/v1/feriados — os feriados da organização (fase 3, item 3.8, migration 9486).
 *
 * GET (qualquer membro): a lista, por data. É o que a tela mostra e o que o
 * roteamento lê (`lib/feriados/carregar.ts`, pela mesma tabela).
 * POST (`manager`+): cadastra um feriado. A organização vem da SESSÃO, nunca do
 * corpo. `unique (organization_id, data)` faz o cadastro idempotente por data: a
 * mesma data de novo é 409, sem segunda linha — por isso a rota não precisa de
 * `Idempotency-Key`.
 *
 * A escrita é pelo service role (a sessão só tem SELECT na tabela), com o
 * recorte de organização manual e o papel conferido aqui.
 */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)));

const Corpo = z.object({
  data: DATA,
  nome: z.string().trim().min(1).max(80),
  recorrente_anual: z.boolean().optional().default(false),
});

const COLUNAS = "id, data, nome, recorrente_anual, created_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "feriados", allowPlatformAdmin: "leitura" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("feriados")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("data", { ascending: true });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "feriados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const corpo = Corpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", t("Informe a data e o nome do feriado."), 422, { requestId });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("feriados")
    .insert({
      organization_id: authz.org.orgId,
      data: corpo.data.data,
      nome: corpo.data.nome,
      recorrente_anual: corpo.data.recorrente_anual,
      created_by: authz.user.id,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", t("Já existe um feriado nesta data."), 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "feriado.criado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "feriado",
    resourceId: (data as { id: string }).id,
    requestId,
    metadata: { data: corpo.data.data, nome: corpo.data.nome, recorrente_anual: corpo.data.recorrente_anual },
  });

  return ok(data, { requestId });
}
