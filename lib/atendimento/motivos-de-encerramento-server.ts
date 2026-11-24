/**
 * As leituras e a escrita dos motivos de encerramento que dependem do banco.
 * A regra pura (o que decidir) está em `motivos-de-encerramento.ts`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  COLUNAS_DO_MOTIVO,
  motivoObrigatorioAoEncerrar,
  ordenarMotivos,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";

/**
 * A exigência da organização (`settings.atendimento.motivo_obrigatorio_ao_encerrar`).
 * `organization_id` vem do contexto autenticado da rota. Lança em falha de
 * leitura; quem chama decide o que fazer com a falha.
 */
export async function lerExigenciaDeMotivo(db: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await db.from("organizations").select("settings").eq("id", organizationId).maybeSingle();
  if (error) throw new Error(error.message);
  return motivoObrigatorioAoEncerrar((data as { settings?: unknown } | null)?.settings);
}

/**
 * Os motivos ATIVOS da organização, na ordem da tela. Filtro explícito de
 * `organization_id` — vale também quando quem chama é o service role.
 */
export async function lerMotivosAtivos(db: SupabaseClient, organizationId: string): Promise<MotivoDeEncerramento[]> {
  const { data, error } = await db
    .from("motivos_de_encerramento")
    .select(COLUNAS_DO_MOTIVO)
    .eq("organization_id", organizationId)
    .eq("ativo", true)
    .order("ordem", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return ordenarMotivos((data ?? []) as MotivoDeEncerramento[]);
}

export type ResultadoDoMotivoNaDemanda =
  | { ok: true; demandaId: string; desfecho: string | null; protocolo: string | null }
  | { ok: false; erro: "sem_demanda" | "motivo_invalido" | "falha"; detalhe?: string };

/**
 * Grava o motivo na demanda do atendimento que acabou de fechar e, se ela ainda
 * não tinha desfecho, encerra com o desfecho da categoria — tudo dentro de
 * `fn_demanda_aplicar_motivo` (migration 9482), sob o lock do contato.
 */
export async function aplicarMotivoNaDemanda(
  admin: SupabaseClient,
  entrada: { organizationId: string; demandaId: string | null; motivoId: string; actorUserId: string },
): Promise<ResultadoDoMotivoNaDemanda> {
  if (!entrada.demandaId) return { ok: false, erro: "sem_demanda" };
  const { data, error } = await admin.rpc("fn_demanda_aplicar_motivo", {
    p_org: entrada.organizationId,
    p_demanda: entrada.demandaId,
    p_motivo: entrada.motivoId,
    p_actor: entrada.actorUserId,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, erro: "motivo_invalido" };
    if (error.code === "P0002") return { ok: false, erro: "sem_demanda" };
    return { ok: false, erro: "falha", detalhe: error.message };
  }
  const linha = (data ?? null) as { id?: string; desfecho?: string | null; protocolo?: string | null } | null;
  return {
    ok: true,
    demandaId: linha?.id ?? entrada.demandaId,
    desfecho: linha?.desfecho ?? null,
    protocolo: linha?.protocolo ?? null,
  };
}

/**
 * O protocolo da demanda vigente da conversa (`conversations.current_demanda_id`),
 * para o cabeçalho do Inbox. Nunca lança: sem demanda, ou leitura que falhou,
 * é `null` — o protocolo é informação a mais na tela, e a conversa tem de abrir
 * mesmo sem ele.
 */
export async function protocoloDaDemanda(
  db: SupabaseClient,
  organizationId: string,
  demandaId: string | null | undefined,
): Promise<string | null> {
  if (!demandaId) return null;
  try {
    const { data, error } = await db
      .from("demandas")
      .select("protocolo")
      .eq("id", demandaId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) return null;
    const protocolo = (data as { protocolo?: unknown }).protocolo;
    return typeof protocolo === "string" && protocolo ? protocolo : null;
  } catch {
    return null;
  }
}
