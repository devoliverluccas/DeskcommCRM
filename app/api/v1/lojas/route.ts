import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/lojas — as lojas da organização (item 5.4, módulo `lojas`).
 * POST /api/v1/lojas — cadastra uma loja.
 *
 * Ler é `agent` (é o seletor do orçamento e do relatório); cadastrar é `admin`
 * (é configuração da empresa, em Configurações › Lojas). Sem o módulo instalado
 * e ligado pela empresa, as duas respondem 404 (`portaoDasLojas`).
 *
 * A primeira loja cadastrada nasce PADRÃO: sem padrão, número sem vínculo e
 * orçamento sem conversa não teriam loja. Marcar outra como padrão depois troca
 * as duas numa transação (`fn_lojas_definir_padrao`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { portaoDasLojas } from "@/lib/lojas/rota";
import { COLUNAS_DA_LOJA, criarLojaSchema, ordenarLojas, type Loja } from "@/lib/lojas/schemas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ENDPOINT = "POST /api/v1/lojas";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const portao = await portaoDasLojas("agent", requestId);
  if (!portao.ok) return portao.response;

  const { data, error } = await portao.admin
    .from("lojas")
    .select(COLUNAS_DA_LOJA)
    .eq("organization_id", portao.orgId)
    .limit(500);
  if (error) return fail("internal_error", portao.t("Não consegui carregar as lojas."), 500, { requestId });
  return ok(ordenarLojas((data ?? []) as Loja[]), { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;

  const requestId = randomUUID();
  const portao = await portaoDasLojas("admin", requestId);
  if (!portao.ok) return portao.response;
  const { admin, orgId, t, authz } = portao;

  const parsed = criarLojaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }
  const entrada = parsed.data;

  /** O efeito. Lança em falha, para a idempotência não gravar recibo de erro. */
  async function criar(): Promise<Loja> {
    const { count, error: erroDaContagem } = await admin
      .from("lojas")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (erroDaContagem) throw new Error(erroDaContagem.message);
    const primeira = (count ?? 0) === 0;

    const { data, error } = await admin
      .from("lojas")
      .insert({
        organization_id: orgId,
        nome: entrada.nome,
        codigo: entrada.codigo ?? null,
        endereco: entrada.endereco ?? null,
        telefone: entrada.telefone ?? null,
        padrao: primeira,
      })
      .select(COLUNAS_DA_LOJA)
      .single();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    let loja = data as Loja;

    if (entrada.padrao === true && !loja.padrao) {
      const { data: trocou, error: erroDaPadrao } = await admin.rpc("fn_lojas_definir_padrao", {
        p_org: orgId,
        p_loja: loja.id,
      });
      if (erroDaPadrao || trocou !== true) throw new Error(erroDaPadrao?.message ?? "padrao");
      loja = { ...loja, padrao: true };
    }

    await audit({
      action: "loja.criada",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "loja",
      resourceId: loja.id,
      requestId,
      metadata: { nome: loja.nome, codigo: loja.codigo, padrao: loja.padrao },
    });
    return loja;
  }

  const recusa = (erro: unknown): Response => {
    // 23505: nome ou código repetido na organização (sem diferenciar maiúsculas).
    if ((erro as { code?: string } | null)?.code === "23505") {
      return fail("conflict", t("Já existe uma loja com esse nome ou código."), 409, { requestId });
    }
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  };

  if (chave === null) {
    try {
      return ok(await criar(), { requestId, status: 201 });
    } catch (erro) {
      return recusa(erro);
    }
  }

  try {
    const desfecho = await comIdempotencia({
      db: await createClient(),
      organizationId: orgId,
      endpoint: ENDPOINT,
      chave,
      corpo: entrada,
      executar: async () => ({ resposta: await criar(), status: 201 }),
    });
    if (desfecho.tipo === "conflito") {
      return fail("idempotency_conflict", t("Esta chave de idempotência já foi usada com outro conteúdo."), 409, { requestId });
    }
    if (desfecho.tipo === "em_curso") {
      return fail("idempotency_in_progress", t("A mesma requisição ainda está em curso. Tente de novo em instantes."), 409, { requestId });
    }
    return ok(desfecho.resposta, { requestId, status: 201 });
  } catch (erro) {
    return recusa(erro);
  }
}
