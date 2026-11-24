/**
 * GET /api/v1/relatorios/atribuicao — a aba "Atribuição" de `/app/relatorios` (3.6).
 *
 * Os cliques dos links rastreáveis (Configurações › Conversões › Links) no
 * período, por link: cliques, quantos viraram contato, negócios desses
 * contatos, ganhos e conversões enviadas à plataforma de anúncio. A conta é
 * `fn_relatorio_atribuicao` (migration 9484).
 *
 * Piso `manager`: é o funil inteiro da organização, como Perdas. As tabelas de
 * clique só têm GRANT para `service_role` (a mesma razão de
 * `fn_metricas_links_rastreaveis`), então o client é de serviço e a
 * organização vem da sessão — nunca da URL. Leitura ⇒ sem auditoria.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { fusoDoRelatorio } from "@/lib/relatorios/janela";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerPeriodo, MENSAGEM_DO_PERIODO } from "../_periodo";
import type { LinhaDeAtribuicao } from "../_tipos";

export const dynamic = "force-dynamic";

const numero = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "metrics" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  const { data: organizacao } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();
  const fuso = fusoDoRelatorio((organizacao as { timezone?: string | null } | null)?.timezone);

  const periodo = lerPeriodo(new URL(req.url).searchParams, fuso);
  if (!periodo.ok) return fail("validation_failed", t(MENSAGEM_DO_PERIODO[periodo.motivo]), 422, { requestId });
  const { janela } = periodo;

  const { data, error } = await admin.rpc("fn_relatorio_atribuicao", {
    p_org: orgId,
    p_de: janela.from,
    p_ate: janela.to,
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const links: LinhaDeAtribuicao[] = ((data ?? []) as Array<Record<string, unknown>>).map((b) => ({
    link_id: (b.link_id as string | null) ?? null,
    nome: (b.nome as string | null) ?? null,
    uso: (b.uso as string | null) ?? null,
    cliques: numero(b.cliques),
    contatos: numero(b.contatos),
    negocios: numero(b.negocios),
    ganhos: numero(b.ganhos),
    conversoes: numero(b.conversoes),
  }));

  return ok({ janela: { de: janela.de, ate: janela.ate, tz: janela.tz }, links }, { requestId });
}
