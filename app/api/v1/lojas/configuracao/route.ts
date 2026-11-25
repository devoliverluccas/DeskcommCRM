import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH /api/v1/lojas/configuracao — a empresa liga ou desliga o uso das lojas.
 *
 * Instalar é decisão do servidor (`/admin/modulos`); usar é decisão de cada
 * empresa — o desenho de `cadencias`. Esta é a única rota de lojas que responde
 * com o módulo instalado e a empresa ainda DESLIGADA: é por ela que se liga.
 * Desligar preserva lojas, estoques e vínculos; só esconde.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { configurarLojasSchema } from "@/lib/lojas/schemas";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("admin", requestId, { soInstalado: true });
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const parsed = configurarLojasSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });

  const { data, error } = await admin.rpc("fn_lojas_configurar", {
    p_organization_id: orgId,
    p_enabled: parsed.data.enabled,
  });
  if (error || data !== true) {
    return fail("internal_error", t("Não foi possível salvar a configuração."), 500, { requestId });
  }

  await audit({
    action: "loja.settings_updated",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { enabled: parsed.data.enabled },
  });
  return ok(parsed.data, { requestId });
}
