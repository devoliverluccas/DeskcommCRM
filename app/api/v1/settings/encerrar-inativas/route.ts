import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { encerrarInativasAposHoras, encerrarInativasAposHorasSchema } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH /api/v1/settings/encerrar-inativas — o prazo do encerramento
 * automático por inatividade (fase 3, item 3.8):
 * `settings.atendimento.encerrar_inativas_apos_horas` (`null` = desligado).
 *
 * Ler é `manager`+ (Configurações › Distribuição de atendimento); MUDAR é de
 * quem administra a empresa (`admin`, o mesmo piso das outras opções daquela
 * tela): o cron passa a encerrar conversas em nome da empresa inteira.
 *
 * O merge preserva TODAS as outras chaves de `settings` e do bloco
 * `atendimento`. Quem age é o cron `encerrar-inativas`.
 */

const Corpo = z.object({ horas: encerrarInativasAposHorasSchema });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ horas: encerrarInativasAposHoras((data as { settings?: unknown } | null)?.settings) }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "settings", allowPlatformAdmin: true });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const corpo = Corpo.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", t("Informe um prazo entre 1 e 720 horas, ou desligue."), 422, { requestId });
  }

  const admin = createAdminClient();
  const { data: linha, error: erroDaLeitura } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  if (erroDaLeitura) return fail("internal_error", erroDaLeitura.message, 500, { requestId });

  const atuais = ((linha as { settings?: unknown } | null)?.settings ?? {}) as Record<string, unknown>;
  const bloco = (atuais.atendimento && typeof atuais.atendimento === "object" && !Array.isArray(atuais.atendimento)
    ? atuais.atendimento
    : {}) as Record<string, unknown>;
  const antes = encerrarInativasAposHoras(atuais);
  const horas = corpo.data.horas;
  if (antes === horas) return ok({ horas }, { requestId });

  const { error } = await admin
    .from("organizations")
    .update({ settings: { ...atuais, atendimento: { ...bloco, encerrar_inativas_apos_horas: horas } } })
    .eq("id", authz.org.orgId);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  await audit({
    action: "settings.encerrar_inativas_alterada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { antes, horas },
  });

  return ok({ horas }, { requestId });
}
