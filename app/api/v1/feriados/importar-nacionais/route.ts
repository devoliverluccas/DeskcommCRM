import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { nacionaisDoAno } from "@/lib/feriados/regra";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { PRIMEIRO_ANO_COBERTO, ULTIMO_ANO_COBERTO } from "@/lib/lgpd/holidays-br";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const Corpo = z.object({ ano: z.number().int().min(PRIMEIRO_ANO_COBERTO).max(ULTIMO_ANO_COBERTO) });

/**
 * POST /api/v1/feriados/importar-nacionais — grava os feriados nacionais de um
 * ano como feriados DA organização (manager+).
 *
 * As datas vêm da régua única de feriado nacional (`lib/lgpd/holidays-br.ts`,
 * via `nacionaisDoAno`). Importar é o gesto que faz o nacional fechar o
 * expediente das jornadas e filas: sem ele o roteamento não muda no feriado
 * (cabeçalho da migration 9486).
 *
 * Idempotente: `upsert` com `ignoreDuplicates` sobre `(organization_id, data)` —
 * importar duas vezes, ou num ano em que a organização já cadastrou um dos dias
 * com outro nome, não duplica nem sobrescreve o que ela escreveu. A resposta diz
 * quantos entraram; zero entradas não audita.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "feriados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const corpo = Corpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Ano inválido."), 422, { requestId });
  const { ano } = corpo.data;

  const linhas = nacionaisDoAno(ano).map((f) => ({
    organization_id: authz.org.orgId,
    data: f.data,
    nome: f.nome,
    recorrente_anual: false,
    created_by: authz.user.id,
  }));

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("feriados")
    .upsert(linhas, { onConflict: "organization_id,data", ignoreDuplicates: true })
    .select("id");
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const importados = (data ?? []).length;
  if (importados > 0) {
    await audit({
      action: "feriados.nacionais_importados",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "feriado",
      requestId,
      metadata: { ano, importados },
    });
  }

  return ok({ ano, importados, total: linhas.length }, { requestId });
}
