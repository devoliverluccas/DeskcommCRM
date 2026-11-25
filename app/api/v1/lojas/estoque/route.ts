import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET /api/v1/lojas/estoque?produto=<id> — a quantidade do produto em cada loja.
 * PUT /api/v1/lojas/estoque — grava a quantidade de um produto numa loja.
 *
 * Ler é `viewer` (quem atende precisa saber onde tem); gravar é `manager`, o
 * mesmo papel que edita o produto. As chaves compostas da migration 9495
 * recusam loja ou produto de outra organização (23503 → 404), mesmo pelo
 * cliente de serviço. A quantidade total do catálogo
 * (`catalog_products.quantidade`) não muda: o estoque por loja é a divisão que
 * a empresa registra, não uma segunda fonte do total.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { estoqueSchema, ordenarLojas, type Loja } from "@/lib/lojas/schemas";

export const dynamic = "force-dynamic";

export interface EstoqueDaLoja {
  loja_id: string;
  nome: string;
  ativa: boolean;
  padrao: boolean;
  quantidade: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const portao = await portaoDasLojas("viewer", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t } = portao;

  const produto = new URL(req.url).searchParams.get("produto");
  if (!z.uuid().safeParse(produto).success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });

  const [lojas, estoque] = await Promise.all([
    admin.from("lojas").select("id, nome, ativa, padrao").eq("organization_id", orgId).limit(500),
    admin
      .from("estoque_por_loja")
      .select("loja_id, quantidade")
      .eq("organization_id", orgId)
      .eq("product_id", produto as string),
  ]);
  if (lojas.error || estoque.error) {
    return fail("internal_error", t("Não consegui carregar as lojas."), 500, { requestId });
  }
  const porLoja = new Map(
    ((estoque.data ?? []) as Array<{ loja_id: string; quantidade: number }>).map((e) => [e.loja_id, e.quantidade]),
  );
  const linhas: EstoqueDaLoja[] = ordenarLojas((lojas.data ?? []) as Array<Pick<Loja, "id" | "nome" | "ativa" | "padrao">>).map(
    (l) => ({ loja_id: l.id, nome: l.nome, ativa: l.ativa, padrao: l.padrao, quantidade: porLoja.get(l.id) ?? 0 }),
  );
  return ok(linhas, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("manager", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const parsed = estoqueSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { loja_id, product_id, quantidade } = parsed.data;

  const { error } = await admin.from("estoque_por_loja").upsert(
    { organization_id: orgId, loja_id, product_id, quantidade, updated_at: new Date().toISOString() },
    { onConflict: "loja_id,product_id" },
  );
  if (error) {
    if (error.code === "23503") return fail("not_found", t("Loja ou produto não encontrado."), 404, { requestId });
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }

  await audit({
    action: "loja.estoque_alterado",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "loja",
    resourceId: loja_id,
    requestId,
    metadata: { product_id, quantidade },
  });
  return ok(parsed.data, { requestId });
}
