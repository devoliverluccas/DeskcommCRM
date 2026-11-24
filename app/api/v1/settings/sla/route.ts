import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { metasDoSla, SLA_CHAVE, slaWriteSchema } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET/PATCH /api/v1/settings/sla — as metas de SLA do atendimento (fase 3, 3.3).
 *
 * GET é de quem atende (`viewer`+): a lista de conversas precisa das metas e do
 * horário de cada setor para desenhar o selo, e é a mesma pessoa que lê a lista.
 * Devolve `{ metas, expedientes }` — `expedientes` é o `schedule` de cada setor,
 * o mesmo objeto que a fila usa para rotear.
 *
 * PATCH é de quem gerencia (`manager`+), o piso de Configurações › Atendimento.
 * Substitui o bloco `settings.sla` inteiro (a tela manda o formulário todo) e
 * preserva as outras chaves de `settings`.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "settings" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const [org, setores] = await Promise.all([
    supabase.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle(),
    supabase.from("attendant_sectors").select("id, schedule").eq("organization_id", authz.org.orgId),
  ]);
  if (org.error) return fail("internal_error", org.error.message, 500, { requestId });
  // Sem setores legíveis o selo ainda funciona (24/7): o horário é refinamento.
  const expedientes: Record<string, unknown> = {};
  for (const s of (setores.data ?? []) as Array<{ id: string; schedule: unknown }>) {
    expedientes[s.id] = s.schedule ?? null;
  }

  return ok(
    { metas: metasDoSla((org.data as { settings?: unknown } | null)?.settings), expedientes },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings", allowPlatformAdmin: true });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const corpo = await req.json().catch(() => undefined);
  if (corpo === undefined) return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  const parsed = slaWriteSchema.safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", t("Configuração inválida."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  // `organizations` só aceita escrita do service role (a RLS dá escrita só ao
  // super-admin): o papel foi conferido acima, e o filtro é o org da sessão.
  const admin = createAdminClient();
  const { data: orgRow, error: erroDaLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (erroDaLeitura) return fail("internal_error", erroDaLeitura.message, 500, { requestId });

  const atuais = ((orgRow as { settings?: unknown } | null)?.settings ?? {}) as Record<string, unknown>;
  const bloco = {
    primeira_resposta_min: parsed.data.primeira_resposta_min,
    resolucao_horas: parsed.data.resolucao_horas,
    por_setor: parsed.data.por_setor ?? {},
  };

  const { data: gravada, error: erroAoGravar } = await admin
    .from("organizations")
    .update({ settings: { ...atuais, [SLA_CHAVE]: bloco } })
    .eq("id", authz.org.orgId)
    .select("id")
    .maybeSingle();
  if (erroAoGravar) return fail("internal_error", erroAoGravar.message, 500, { requestId });
  if (!gravada) return fail("not_found", t("Organização não encontrada."), 404, { requestId });

  void audit({
    action: "settings.sla_alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: {
      primeira_resposta_min: bloco.primeira_resposta_min,
      resolucao_horas: bloco.resolucao_horas,
      setores_com_meta: Object.keys(bloco.por_setor).length,
    },
  });

  return ok({ metas: metasDoSla({ [SLA_CHAVE]: bloco }) }, { requestId });
}
