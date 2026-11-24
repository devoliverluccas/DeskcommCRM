import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET  /api/v1/motivos-de-encerramento — a lista da organização + a exigência.
 * POST /api/v1/motivos-de-encerramento — cria um motivo.
 *
 * Fase 3, item 3.2. Ler é `agent` (é o seletor do diálogo de fechar, no Inbox);
 * criar é `manager` (é configuração da organização, ao lado das Tags).
 *
 * A sessão só tem SELECT em `motivos_de_encerramento` (migration 9482): a escrita
 * vai pelo service role, com `organization_id` do contexto autenticado como
 * filtro explícito — nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  COLUNAS_DO_MOTIVO,
  criarMotivoSchema,
  motivoObrigatorioAoEncerrar,
  ordenarMotivos,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. */
const ENDPOINT = "POST /api/v1/motivos-de-encerramento";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "motivos_de_encerramento" });
  if (!authz.ok) return authz.response;

  // Pela SESSÃO: a RLS isola a organização, e o filtro explícito diz qual.
  const supabase = await createClient();
  const [motivos, org] = await Promise.all([
    supabase
      .from("motivos_de_encerramento")
      .select(COLUNAS_DO_MOTIVO)
      .eq("organization_id", authz.org.orgId)
      .order("ordem", { ascending: true })
      .limit(200),
    supabase.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle(),
  ]);
  if (motivos.error) return fail("internal_error", motivos.error.message, 500, { requestId });
  if (org.error) return fail("internal_error", org.error.message, 500, { requestId });

  return ok(
    {
      motivos: ordenarMotivos((motivos.data ?? []) as MotivoDeEncerramento[]),
      motivo_obrigatorio_ao_encerrar: motivoObrigatorioAoEncerrar(
        (org.data as { settings?: unknown } | null)?.settings,
      ),
    },
    { requestId },
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "motivos_de_encerramento" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org } = authz;

  const parsed = criarMotivoSchema.safeParse(await req.json().catch(() => null));
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

  const admin = createAdminClient();

  /** O efeito. Lança em falha, para a idempotência não gravar recibo de erro. */
  async function criar(): Promise<MotivoDeEncerramento> {
    const { data: ultimo, error: erroDaOrdem } = await admin
      .from("motivos_de_encerramento")
      .select("ordem")
      .eq("organization_id", org.orgId)
      .order("ordem", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (erroDaOrdem) throw new Error(erroDaOrdem.message);
    const ordem = ((ultimo as { ordem: number } | null)?.ordem ?? -1) + 1;

    const { data, error } = await admin
      .from("motivos_de_encerramento")
      .insert({ organization_id: org.orgId, nome: parsed.data!.nome, categoria: parsed.data!.categoria, ordem })
      .select(COLUNAS_DO_MOTIVO)
      .single();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const motivo = data as MotivoDeEncerramento;

    await audit({
      action: "motivo_de_encerramento.criado",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "motivo_de_encerramento",
      resourceId: motivo.id,
      requestId,
      metadata: { nome: motivo.nome, categoria: motivo.categoria },
    });
    return motivo;
  }

  const recusa = (erro: unknown): Response => {
    // 23505: já existe um motivo com esse nome (sem diferenciar maiúsculas).
    if ((erro as { code?: string } | null)?.code === "23505") {
      return fail("conflict", t("Já existe um motivo com esse nome."), 409, { requestId });
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
      corpo: parsed.data,
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
