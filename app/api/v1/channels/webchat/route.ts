import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { configDoChatSchema, CONFIG_PADRAO, snippetDoChat, type ConfigDoChat } from "@/lib/channels/webchat/config";
import { acharConexaoDoChat, salvarConexaoDoChat, type ConexaoDoChat } from "@/lib/channels/webchat/sessao";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { basePublicaDaInstalacao } from "@/lib/webhooks/url-publica";

/**
 * GET /api/v1/channels/webchat — a configuração do chat do site e o snippet.
 * PUT /api/v1/channels/webchat — salva a configuração (cria a conexão na
 *     primeira vez, com a chave pública sorteada no servidor).
 *
 * `admin`, como as outras conexões: ligar um canal expõe a conta da empresa.
 * PUT e não POST: salvar duas vezes a mesma configuração dá no mesmo estado, e
 * a conexão é uma por organização — não há recurso novo a cada chamada.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function corpo(req: NextRequest, conexao: ConexaoDoChat | null) {
  const ativa = conexao && !conexao.archivedAt ? conexao : null;
  return {
    connected: Boolean(ativa),
    channel_session_id: ativa?.id ?? null,
    config: ativa?.config ?? CONFIG_PADRAO,
    chave: ativa?.chave ?? null,
    snippet: ativa ? snippetDoChat(basePublicaDaInstalacao(req), ativa.chave) : null,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_webchat" });
  if (!authz.ok) return authz.response;

  try {
    const conexao = await acharConexaoDoChat(createAdminClient(), authz.org.orgId);
    return ok(corpo(req, conexao), { requestId });
  } catch {
    return fail("internal_error", "Não foi possível ler o chat do site.", 500, { requestId });
  }
}

/** Os campos que mudaram — para a auditoria dizer O QUE, sem copiar texto livre. */
function camposMudados(antes: ConfigDoChat | null, depois: ConfigDoChat): string[] {
  if (!antes) return Object.keys(depois);
  return (Object.keys(depois) as (keyof ConfigDoChat)[]).filter(
    (k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]),
  );
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_webchat" });
  if (!authz.ok) return authz.response;

  const parsed = configDoChatSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Configuração inválida.", 422, {
      requestId,
      details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (parsed.data.ativo && parsed.data.dominios.length === 0) {
    return fail("validation_failed", "Informe ao menos um domínio para ligar o chat.", 422, { requestId });
  }

  const admin = createAdminClient();
  const orgId = authz.org.orgId;
  let existente: ConexaoDoChat | null;
  try {
    existente = await acharConexaoDoChat(admin, orgId);
  } catch {
    return fail("internal_error", "Não foi possível ler o chat do site.", 500, { requestId });
  }

  const salvo = await salvarConexaoDoChat(admin, {
    organizationId: orgId,
    existente,
    config: parsed.data,
    userId: authz.user.id,
    requestId,
  });
  if (!salvo.ok) return fail("internal_error", salvo.reason, salvo.status, { requestId });

  void audit({
    action: salvo.criada ? "channel.connected" : "channel.webchat_updated",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: salvo.conexao.id,
    requestId,
    metadata: {
      canal: "chat_do_site",
      campos: camposMudados(existente?.config ?? null, parsed.data),
      dominios: parsed.data.dominios.length,
      ativo: parsed.data.ativo,
    },
  });

  return ok(corpo(req, salvo.conexao), { requestId });
}
