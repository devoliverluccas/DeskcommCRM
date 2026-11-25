import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET /api/v1/lojas/numeros — os números conectados e a loja de cada um.
 * PUT /api/v1/lojas/numeros — vincula um número a uma loja (ou tira o vínculo).
 *
 * `admin`, como o resto de Configurações › Lojas. Número sem vínculo usa a loja
 * padrão. As chaves compostas da migration 9495 recusam número ou loja de outra
 * organização (23503 → 404), mesmo pelo cliente de serviço.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { lojaDoNumeroSchema } from "@/lib/lojas/schemas";

export const dynamic = "force-dynamic";

export interface NumeroDaLoja {
  channel_session_id: string;
  nome: string | null;
  telefone: string | null;
  provider: string;
  loja_id: string | null;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const portao = await portaoDasLojas("admin", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t } = portao;

  const [numeros, vinculos] = await Promise.all([
    admin
      .from("channel_sessions")
      .select("id, display_name, phone_number, provider")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(200),
    admin.from("loja_do_numero").select("channel_session_id, loja_id").eq("organization_id", orgId),
  ]);
  if (numeros.error || vinculos.error) {
    return fail("internal_error", t("Não consegui carregar os números."), 500, { requestId });
  }
  const lojaDe = new Map(
    ((vinculos.data ?? []) as Array<{ channel_session_id: string; loja_id: string }>).map((v) => [
      v.channel_session_id,
      v.loja_id,
    ]),
  );
  const linhas: NumeroDaLoja[] = (
    (numeros.data ?? []) as Array<{ id: string; display_name: string | null; phone_number: string | null; provider: string }>
  ).map((n) => ({
    channel_session_id: n.id,
    nome: n.display_name,
    telefone: n.phone_number,
    provider: n.provider,
    loja_id: lojaDe.get(n.id) ?? null,
  }));
  return ok(linhas, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("admin", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const parsed = lojaDoNumeroSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  const { channel_session_id, loja_id } = parsed.data;

  const { error } =
    loja_id === null
      ? await admin
          .from("loja_do_numero")
          .delete()
          .eq("organization_id", orgId)
          .eq("channel_session_id", channel_session_id)
      : await admin.from("loja_do_numero").upsert(
          { organization_id: orgId, channel_session_id, loja_id, updated_at: new Date().toISOString() },
          { onConflict: "channel_session_id" },
        );
  if (error) {
    if (error.code === "23503") return fail("not_found", t("Loja ou número não encontrado."), 404, { requestId });
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }

  await audit({
    action: "loja.numero_vinculado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: channel_session_id,
    requestId,
    metadata: { loja_id },
  });
  return ok(parsed.data, { requestId });
}
