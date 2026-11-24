import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/motivos-de-encerramento/config — o interruptor "Exigir motivo
 * ao encerrar" (`settings.atendimento.motivo_obrigatorio_ao_encerrar`).
 *
 * Nasce DESLIGADO (chave ausente ⇒ não exige). `manager`, o mesmo piso da lista
 * que a exigência usa. Merge não-destrutivo: preserva as outras chaves de
 * `settings` e as outras do bloco `atendimento`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  configDosMotivosSchema,
  motivoObrigatorioAoEncerrar,
  settingsComExigencia,
} from "@/lib/atendimento/motivos-de-encerramento";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = configDosMotivosSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Configuração inválida."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const admin = createAdminClient();
  const { data: orgRow, error: erroDaLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (erroDaLeitura) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });

  const ligado = parsed.data.motivo_obrigatorio_ao_encerrar;
  const proximo = settingsComExigencia((orgRow as { settings?: unknown } | null)?.settings, ligado);
  const { error: erroAoGravar } = await admin
    .from("organizations")
    .update({ settings: proximo })
    .eq("id", authz.org.orgId);
  if (erroAoGravar) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });

  await audit({
    action: "settings.motivo_obrigatorio_alterado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { ligado },
  });

  return ok({ motivo_obrigatorio_ao_encerrar: motivoObrigatorioAoEncerrar(proximo) }, { requestId });
}
