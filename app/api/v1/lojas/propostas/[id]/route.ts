import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET /api/v1/lojas/propostas/[id] — a loja registrada do orçamento.
 * PUT /api/v1/lojas/propostas/[id] — troca (ou tira) a loja do orçamento.
 *
 * `agent`, o mesmo piso de editar a proposta. A proposta precisa ser VISÍVEL
 * para esta sessão (lida pelo client da sessão, com a RLS das propostas) antes
 * de qualquer escrita; a loja precisa ser desta organização (chave composta,
 * 23503 → 404) e o gatilho `fn_lojas_conferir_proposta` confere a proposta de
 * novo no banco.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { lojaDaPropostaSchema } from "@/lib/lojas/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function propostaVisivel(orgId: string, id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_proposals")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  return Boolean(data);
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const portao = await portaoDasLojas("agent", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t } = portao;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !(await propostaVisivel(orgId, id))) {
    return fail("not_found", t("Proposta não encontrada."), 404, { requestId });
  }
  const { data, error } = await admin
    .from("proposta_da_loja")
    .select("loja_id")
    .eq("organization_id", orgId)
    .eq("proposal_id", id)
    .maybeSingle();
  if (error) return fail("internal_error", t("Não consegui carregar as lojas."), 500, { requestId });
  return ok({ loja_id: (data as { loja_id?: string } | null)?.loja_id ?? null }, { requestId });
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("agent", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !(await propostaVisivel(orgId, id))) {
    return fail("not_found", t("Proposta não encontrada."), 404, { requestId });
  }
  const parsed = lojaDaPropostaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  const { loja_id } = parsed.data;

  const { error } =
    loja_id === null
      ? await admin.from("proposta_da_loja").delete().eq("organization_id", orgId).eq("proposal_id", id)
      : await admin.from("proposta_da_loja").upsert(
          { organization_id: orgId, proposal_id: id, loja_id, updated_at: new Date().toISOString() },
          { onConflict: "proposal_id" },
        );
  if (error) {
    if (error.code === "23503") return fail("not_found", t("Loja não encontrada."), 404, { requestId });
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }

  await audit({
    action: "loja.proposta_vinculada",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_proposal",
    resourceId: id,
    requestId,
    metadata: { loja_id },
  });
  return ok({ loja_id }, { requestId });
}
