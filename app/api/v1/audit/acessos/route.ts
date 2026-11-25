/**
 * GET /api/v1/audit/acessos — o registro de acessos da organização ativa:
 * entradas, saídas, segundo fator e trocas de senha (`ACOES_DE_ACESSO`).
 *
 * Auth: a MESMA porta de `GET /api/v1/audit` — sessão, papel manager+ (o piso
 * da tela de auditoria), ou o administrador da plataforma em leitura. O IP volta
 * inteiro só para quem administra a empresa; para os demais ele sai mascarado
 * DAQUI (ver `lib/audit/consulta-de-acessos.ts`).
 *
 * Filtros: `actor_id` (pessoa), `from`/`to` (período), `cursor`, `limit`.
 * Paginação: keyset sobre (created_at DESC, id DESC), o mesmo cursor da lista
 * geral.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import {
  acessosQuerySchema,
  apresentarAcesso,
  consultaDeAcessos,
  podeVerIpInteiro,
  type LinhaDeAcessoNoBanco,
} from "@/lib/audit/consulta-de-acessos";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { decodeAuditCursor, encodeAuditCursor } from "@/lib/schemas/audit";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "audit",
    allowPlatformAdmin: "leitura",
  });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = acessosQuerySchema.safeParse(params);
  if (!parsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const q = parsed.data;

  let query = consultaDeAcessos(await createClient(), authz.org.orgId, q).limit(q.limit + 1);
  if (q.cursor) {
    const c = decodeAuditCursor(q.cursor);
    if (!c) return fail("invalid_cursor", t("Cursor inválido."), 400, { requestId });
    query = query.or(
      `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const rows = (data ?? []) as unknown as LinhaDeAcessoNoBanco[];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeAuditCursor({ created_at: last.created_at, id: last.id }) : null;

  const ipInteiro = podeVerIpInteiro(
    authz.org.role,
    authz.user.is_platform_admin && !authz.user.support,
  );
  return ok(
    page.map((r) => apresentarAcesso(r, ipInteiro)),
    { requestId, meta: { cursor: nextCursor, has_more: hasMore } },
  );
}
