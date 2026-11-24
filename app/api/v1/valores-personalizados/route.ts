import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/valores-personalizados — os valores da empresa (`{{empresa.x}}`).
 * POST /api/v1/valores-personalizados — cria um valor.
 *
 * Fase 4, item 4.6 (migration 9491). Ler é `agent` (quem escreve a mensagem
 * precisa ver o que `{{empresa.pix}}` vai virar); criar, editar e apagar é
 * `manager` — quem troca a chave PIX troca para onde vai o dinheiro.
 *
 * A sessão só tem SELECT na tabela: a escrita vai pelo service role, com
 * `organization_id` do contexto autenticado como filtro explícito — nunca do
 * corpo (o schema é `.strict()` e recusa o campo).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  COLUNAS_DO_VALOR,
  MAXIMO_DE_VALORES,
  criarValorSchema,
  ordenarValores,
  type ValorPersonalizado,
} from "@/lib/variaveis/valores-personalizados";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. */
const ENDPOINT = "POST /api/v1/valores-personalizados";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "valores_personalizados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  // Pela SESSÃO: a RLS isola a organização, e o filtro explícito diz qual.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("valores_personalizados")
    .select(COLUNAS_DO_VALOR)
    .eq("organization_id", authz.org.orgId)
    .limit(MAXIMO_DE_VALORES);
  if (error) return fail("internal_error", t("Não foi possível carregar os valores agora."), 500, { requestId });
  return ok({ valores: ordenarValores((data ?? []) as ValorPersonalizado[]) }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "valores_personalizados" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const parsed = criarValorSchema.safeParse(await req.json().catch(() => null));
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
  const admin = createAdminClient();

  /** O efeito. Lança em falha, para a idempotência não gravar recibo de erro. */
  async function criar(): Promise<ValorPersonalizado> {
    const { count, error: erroDaConta } = await admin
      .from("valores_personalizados")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    if (erroDaConta) throw new Error(erroDaConta.message);
    if ((count ?? 0) >= MAXIMO_DE_VALORES) throw Object.assign(new Error("limite"), { code: "limite" });

    const { data, error } = await admin
      .from("valores_personalizados")
      .insert({
        organization_id: org.orgId,
        chave: entrada.chave,
        valor: entrada.valor,
        descricao: entrada.descricao ?? null,
      })
      .select(COLUNAS_DO_VALOR)
      .single();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const valor = data as ValorPersonalizado;

    // Metadata só com a CHAVE: o valor pode ser dado sensível da empresa (conta,
    // PIX) e a trilha de auditoria não precisa dele para dizer quem mudou o quê.
    await audit({
      action: "valor_personalizado.criado",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "valor_personalizado",
      resourceId: valor.id,
      requestId,
      metadata: { chave: valor.chave },
    });
    return valor;
  }

  const recusa = (erro: unknown): Response => {
    const code = (erro as { code?: string } | null)?.code;
    if (code === "23505") {
      return fail("conflict", t("Já existe um valor com essa chave."), 409, { requestId });
    }
    if (code === "limite") {
      return fail("limit_reached", t("Limite de 200 valores por empresa."), 422, { requestId });
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
    const supabase = await createClient();
    const desfecho = await comIdempotencia({
      db: supabase,
      organizationId: org.orgId,
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
