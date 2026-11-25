import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/perfis-de-tela — os perfis de tela da organização (item 5.6).
 * POST /api/v1/perfis-de-tela — cria um perfil (nome + portas do catálogo).
 *
 * `admin` nas duas pontas: é quem desenha o que cada pessoa vê. A sessão só tem
 * SELECT na tabela (migration 9497); a escrita vai pelo service role com
 * `organization_id` do contexto autenticado — nunca do corpo (`.strict()`).
 *
 * O perfil é APRESENTAÇÃO: estreita menu, hub e busca. Não concede nem nega rota.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  COLUNAS_DO_PERFIL,
  MAXIMO_DE_PERFIS,
  criarPerfilSchema,
  type PerfilDeTela,
} from "@/lib/navigation/perfis-de-tela";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ENDPOINT = "POST /api/v1/perfis-de-tela";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("perfis_de_tela")
    .select(COLUNAS_DO_PERFIL)
    .eq("organization_id", authz.org.orgId)
    .order("nome", { ascending: true })
    .limit(MAXIMO_DE_PERFIS);
  if (error) return fail("internal_error", t("Não foi possível carregar os perfis agora."), 500, { requestId });
  return ok({ perfis: (data ?? []) as PerfilDeTela[] }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const parsed = criarPerfilSchema.safeParse(await req.json().catch(() => null));
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

  async function criar(): Promise<PerfilDeTela> {
    const { count, error: erroDaConta } = await admin
      .from("perfis_de_tela")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.orgId);
    if (erroDaConta) throw new Error(erroDaConta.message);
    if ((count ?? 0) >= MAXIMO_DE_PERFIS) throw Object.assign(new Error("limite"), { code: "limite" });

    const { data, error } = await admin
      .from("perfis_de_tela")
      .insert({
        organization_id: org.orgId,
        nome: entrada.nome,
        destinos: entrada.destinos,
        created_by: user.id,
      })
      .select(COLUNAS_DO_PERFIL)
      .single();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const perfil = data as PerfilDeTela;

    await audit({
      action: "perfil_de_tela.criado",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "perfil_de_tela",
      resourceId: perfil.id,
      requestId,
      metadata: { nome: perfil.nome, destinos: perfil.destinos.length },
    });
    return perfil;
  }

  const recusa = (erro: unknown): Response => {
    const code = (erro as { code?: string } | null)?.code;
    if (code === "23505") return fail("conflict", t("Já existe um perfil com esse nome."), 409, { requestId });
    if (code === "limite") return fail("limit_reached", t("Limite de 50 perfis por empresa."), 422, { requestId });
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
