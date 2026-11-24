/**
 * GET/POST /api/v1/cron/encerrar-inativas — ENCERRAMENTO AUTOMÁTICO POR
 * INATIVIDADE (fase 3, item 3.8). De hora em hora.
 *
 * Desligado de fábrica: só age na organização que preencheu
 * `settings.atendimento.encerrar_inativas_apos_horas` (Configurações ›
 * Distribuição de atendimento). Ali, encerra a conversa VIVA em que:
 *
 *   - a última palavra foi da EQUIPE ou da IA (`last_outbound_at` depois do
 *     último `last_inbound_at`) e o cliente não respondeu em N horas;
 *   - NINGUÉM do lado do cliente espera resposta (`awaiting_since` nulo) — a
 *     conversa que espera a equipe nunca é encerrada por aqui;
 *   - não está marcada como PENDENTE nem LEMBRADA para depois (`snooze_until`
 *     no futuro): as duas são a equipe dizendo "tenho algo a fazer aqui";
 *   - não é grupo.
 *
 * ENCERRA PELA MESMA PORTA DO BOTÃO "Fechar": `fn_service_status(…, 'closed',
 * revisão lida)` — o mesmo RPC que `conversations/[id]/close` chama. O CAS da
 * revisão recusa (`PT409`) se alguém mexeu na conversa entre a leitura e aqui, e
 * aí ela fica aberta (próxima rodada reavalia). O desfecho de sistema vai para a
 * DEMANDA corrente, pela porta do botão "encerrar" da demanda
 * (`fn_demanda_encerrar`, `expirada_sem_resposta`, ator nulo = não foi uma
 * pessoa), e a auditoria nomeia o motivo: "Encerrada por inatividade".
 *
 * NÃO pede pesquisa de satisfação nem devolve trava de humano: quem some não é
 * consultado sobre o atendimento, e soltar a trava é decisão de gente.
 *
 * Idempotente: a conversa encerrada deixa de casar com a varredura. Audita UMA
 * linha por conversa encerrada, e só quando encerra (rodada vazia não escreve
 * na trilha — `tests/unit/cron-audita-so-quando-ha-efeito.test.ts`).
 * Organização parada (suspensa, arquivada) não é tocada (`idsDeOrgsParadas`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { encerrarInativasAposHoras } from "@/lib/schemas/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Status de atendimento vivo — os que podem ficar inativos. */
const VIVAS = ["open", "pending", "claimed", "ai_handling"] as const;
/** Teto por organização por rodada: a próxima hora pega o resto. */
const LIMITE_POR_ORG = 200;
/** O motivo de sistema, como a auditoria e o relatório o nomeiam. */
export const MOTIVO_DA_INATIVIDADE = "Encerrada por inatividade";
const DESFECHO_DA_DEMANDA = "expirada_sem_resposta";

type Admin = ReturnType<typeof createAdminClient>;

interface Candidata {
  id: string;
  service_revision: number;
  current_demanda_id: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  snooze_until: string | null;
}

export interface ResultadoDaRodada {
  organizacoes: number;
  examinadas: number;
  encerradas: number;
  falhas: number;
}

/** A última palavra foi da equipe/IA, e o cliente não respondeu depois. */
export function ultimaPalavraFoiDaEquipe(c: Pick<Candidata, "last_inbound_at" | "last_outbound_at">): boolean {
  if (!c.last_outbound_at) return false;
  return c.last_inbound_at === null || new Date(c.last_inbound_at) < new Date(c.last_outbound_at);
}

export async function encerrarInativas(admin: Admin, agora: Date, requestId: string): Promise<ResultadoDaRodada> {
  const resultado: ResultadoDaRodada = { organizacoes: 0, examinadas: 0, encerradas: 0, falhas: 0 };

  const { data: orgs, error: erroDasOrgs } = await admin
    .from("organizations")
    .select("id, settings")
    .not("settings->atendimento->>encerrar_inativas_apos_horas", "is", null);
  if (erroDasOrgs) throw new Error(`query_orgs_failed: ${erroDasOrgs.message}`);
  const ligadas = ((orgs ?? []) as Array<{ id: string; settings: unknown }>)
    .map((o) => ({ id: o.id, horas: encerrarInativasAposHoras(o.settings) }))
    .filter((o): o is { id: string; horas: number } => o.horas !== null);
  if (ligadas.length === 0) return resultado;

  const paradas = new Set(await idsDeOrgsParadas(admin));

  for (const org of ligadas) {
    if (paradas.has(org.id)) continue;
    resultado.organizacoes += 1;
    const corte = new Date(agora.getTime() - org.horas * 3_600_000).toISOString();

    const { data, error } = await admin
      .from("conversations")
      .select("id, service_revision, current_demanda_id, last_inbound_at, last_outbound_at, snooze_until")
      .eq("organization_id", org.id)
      .in("status", VIVAS as unknown as string[])
      .is("awaiting_since", null)
      .is("pendente_em", null)
      .eq("is_group", false)
      .lt("last_outbound_at", corte)
      .order("last_outbound_at", { ascending: true })
      .limit(LIMITE_POR_ORG);
    if (error) {
      logger.error("[encerrar-inativas] leitura falhou", { organization_id: org.id, detail: error.message, requestId });
      resultado.falhas += 1;
      continue;
    }

    const candidatas = ((data ?? []) as Candidata[]).filter(
      (c) => ultimaPalavraFoiDaEquipe(c) && !(c.snooze_until && new Date(c.snooze_until) > agora),
    );
    resultado.examinadas += candidatas.length;

    for (const c of candidatas) {
      const fechou = await encerrarUma(admin, org.id, c, requestId);
      if (fechou) {
        resultado.encerradas += 1;
        await audit({
          action: "conversation.encerrada_por_inatividade",
          organizationId: org.id,
          resourceType: "conversation",
          resourceId: c.id,
          requestId,
          bypassedRls: true,
          metadata: { motivo: MOTIVO_DA_INATIVIDADE, apos_horas: org.horas },
        });
      } else {
        resultado.falhas += 1;
      }
    }
  }
  return resultado;
}

/**
 * Encerra UMA conversa pela porta do botão "Fechar" e fecha a demanda corrente
 * com o desfecho de sistema. `false` = não encerrou (CAS recusou ou erro).
 */
async function encerrarUma(admin: Admin, organizationId: string, c: Candidata, requestId: string): Promise<boolean> {
  const { error } = await admin.rpc("fn_service_status", {
    p_org: organizationId,
    p_conversation: c.id,
    p_status: "closed",
    p_expected: c.service_revision,
  });
  if (error) {
    // PT409/40001: alguém mexeu na conversa — fica aberta, a próxima rodada reavalia.
    logger.warn("[encerrar-inativas] não encerrou", {
      organization_id: organizationId,
      conversation_id: c.id,
      code: error.code,
      requestId,
    });
    return false;
  }

  if (c.current_demanda_id) {
    const { data: demanda } = await admin
      .from("demandas")
      .select("id, revision, fechada_em")
      .eq("organization_id", organizationId)
      .eq("id", c.current_demanda_id)
      .maybeSingle();
    const d = demanda as { id: string; revision: number; fechada_em: string | null } | null;
    if (d && d.fechada_em === null) {
      const { error: erroDaDemanda } = await admin.rpc("fn_demanda_encerrar", {
        p_org: organizationId,
        p_demanda: d.id,
        p_expected: d.revision,
        p_desfecho: DESFECHO_DA_DEMANDA,
        // `null` = não foi uma pessoa (a mesma regra do opt-out).
        p_actor: null as unknown as string,
      });
      if (erroDaDemanda) {
        // A conversa JÁ está encerrada: a demanda fica com o "próximo passo" que o
        // encerramento grava, para a equipe registrar o desfecho à mão.
        logger.warn("[encerrar-inativas] demanda não recebeu o desfecho", {
          organization_id: organizationId,
          conversation_id: c.id,
          demanda_id: d.id,
          detail: erroDaDemanda.message.slice(0, 160),
          requestId,
        });
      }
    }
  }
  return true;
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  try {
    const resultado = await encerrarInativas(createAdminClient(), new Date(), requestId);
    return ok(resultado, { requestId });
  } catch (err) {
    logger.error("[encerrar-inativas] falhou", { error: err instanceof Error ? err.message : String(err), requestId });
    return fail("internal_error", "Failed to close inactive conversations.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> { return handle(req); }
export async function POST(req: NextRequest): Promise<Response> { return handle(req); }
