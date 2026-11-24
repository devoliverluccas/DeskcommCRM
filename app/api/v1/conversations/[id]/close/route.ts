import { z } from "zod";
import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/[id]/close — fecha a conversa.
 *
 * Não bloqueia por assignee — qualquer membro com permissão (RLS) pode fechar.
 *
 * ## Fechar deixava a trava de humano para trás (#3313, item 1)
 *
 * A trava de humano mora no CONTATO (`contacts.force_human`), não na conversa.
 * Quem fechava para limpar a fila achava que tinha encerrado o atendimento, mas
 * a trava continuava: a próxima mensagem daquele cliente, dias depois, era
 * pulada pela IA (`skip("force_human")`) e ninguém percebia até o cliente
 * reclamar. Medido pela operação que abriu a issue.
 *
 * O corpo aceita `devolver_ao_automatico` — a escolha que a tela apresenta ao
 * fechar uma conversa de contato travado, com "devolver" MARCADO por padrão.
 * Ligado, a rota chama `devolverAtendimentoAoAgente`, a MESMA função do botão
 * "Devolver ao automático" e do cron `handoff-devolucao`: solta as três travas,
 * grava o checkpoint da retomada, emite `ai.handoff_resolved` e a atividade na
 * linha do tempo. Uma segunda regra aqui seria o defeito que `retomada.ts`
 * existe para consertar.
 *
 * `ai_opt_out` (contato "sempre atendimento humano") continua mandando: a
 * função recusa antes de escrever e a conversa fecha do mesmo jeito — o que
 * muda é só a resposta, que diz que a equipe segue com o contato.
 *
 * DESLIGADO (ausente ou `false`) é o comportamento de sempre: fecha e não toca
 * em trava nenhuma. Quem fecha uma conversa sem contato travado não vê escolha
 * nenhuma na tela e não manda a chave — fechar continua sendo só fechar.
 *
 * ## A ORDEM (CR do #3323): devolver ANTES, fechar DEPOIS
 *
 * A primeira versão fechava e devolvia em seguida. Numa conversa COM dono humano
 * isso criava um atendimento fantasma, medido no Postgres com o `baseline.sql`:
 * o release de `fn_conversation_assign` grava `status='open'`, e gravar `open`
 * numa conversa já `closed` é REABERTURA para `fn_service_stamp_status` —
 * revisão +2, `service_started_at` regravado, `current_demanda_id` anulado e um
 * `conversation.routing_requested` emitido para uma conversa encerrada.
 *
 * Devolver primeiro não reabre nada: a conversa ainda está viva, então a escrita
 * do release (`claimed → open`) não carimba atendimento nenhum, e o fechamento
 * que vem depois é a ÚNICA transição que conta.
 *
 * ## O MOTIVO DE ENCERRAMENTO (fase 3, item 3.2)
 *
 * `motivo_id` é opcional e, quando vem, tem de ser um motivo ATIVO desta
 * organização (422 `motivo_invalido`). Quando a organização liga
 * `settings.atendimento.motivo_obrigatorio_ao_encerrar` e tem ao menos um
 * motivo ativo, ele passa a ser obrigatório: 422 `motivo_required` com a lista
 * em `details.motivos`, para a tela oferecer na hora. As duas recusas saem
 * ANTES de qualquer escrita — nem devolução, nem fechamento.
 *
 * O motivo é gesto da SESSÃO: `fn_demanda_aplicar_motivo` exige uma pessoa como
 * autor. Por token, `motivo_id` é recusado (422) e a exigência não se aplica —
 * a integração fecha como antes do #4517.
 *
 * Depois de fechar, o motivo vai para a demanda do atendimento
 * (`fn_demanda_aplicar_motivo`): grava `motivo_de_encerramento_id` e, se ela
 * ainda não tinha desfecho, encerra com o desfecho da categoria. Falha aqui não
 * desfaz o fechamento — viaja no corpo em `motivo_de_encerramento`.
 *
 * ## #4517 — a MESMA transição, agora por token
 *
 * Fechar por integração tem de ser o mesmo `fn_service_status` da tela: a
 * revisão, o carimbo de atendimento e a demanda são regras do BANCO, e uma
 * segunda implementação (um UPDATE em `status`) as pularia em silêncio. A
 * sequência inteira mora em `./_handler.ts` (`fecharConversaHandler`), chamada
 * por esta rota e pela ferramenta do agente.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { ESCOPO_CONVERSAS_ESCRITA } from "@/lib/api/escopos-do-token";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation } from "@/lib/types/messaging";
import {
  decidirMotivo,
  type DecisaoDoMotivo,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";
import {
  aplicarMotivoNaDemanda,
  lerExigenciaDeMotivo,
  lerMotivosAtivos,
} from "@/lib/atendimento/motivos-de-encerramento-server";
import { traduzir } from "@/lib/i18n/dicionario";
import { fecharConversaHandler } from "../_handler";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/**
 * O desfecho da devolução, como a tela precisa lê-lo. `null` = ninguém pediu
 * devolução (conversa sem contato travado, ou cliente antigo da API): o corpo
 * sai igual ao de antes deste item.
 */
export type DesfechoDaDevolucao = { ok: true } | { ok: false; motivo: string };

/**
 * O que aconteceu com o motivo escolhido. Ausente = ninguém escolheu motivo.
 * `registrado: false` = a conversa fechou, mas o motivo não chegou à demanda
 * (`sem_demanda`: o atendimento não tinha demanda vigente).
 */
export type MotivoNoFechamento =
  | { id: string; nome: string; registrado: true; demanda_id: string; desfecho: string | null; protocolo: string | null }
  | { id: string; nome: string; registrado: false; erro: string };

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  let body: unknown = {};
  const text = await req.text();
  try { body = text ? JSON.parse(text) : {}; } catch { return fail("validation_failed", "Corpo inválido.", 422, { requestId }); }
  const parsed = z.object({
    expected_revision: z.number().int().positive().optional(),
    devolver_ao_automatico: z.boolean().optional(),
    motivo_id: z.uuid().optional(),
  }).safeParse(body);
  if (!parsed.success) return fail("validation_failed", "Revisão inválida.", 422, { requestId });

  const { id } = await ctx.params;

  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "conversations",
    role: "agent",
    scope: ESCOPO_CONVERSAS_ESCRITA,
    tokenRole: "agent",
  });
  if (!authz.ok) return authz.response;
  // #1999 — rota de `PUBLIC_PATHS`: o `proxy.ts` não decide sobre ela e nada a
  // montante conta as chamadas. Sem este teto, o Bearer escreve sem cota. A
  // sessão passa sem contagem (quem digita é uma pessoa).
  const teto = await tetoDeEscritaDoToken(authz, "conversations", requestId);
  if (teto) return teto;
  const t = (texto: string) => traduzir(texto, authz.idioma ?? "pt-BR");

  // (1b) O MOTIVO, ANTES DE QUALQUER ESCRITA (fase 3, item 3.2). Motivo de outra
  // organização ou inativo, ou motivo exigido e ausente: 422 sem tocar em nada —
  // nem devolução, nem fechamento. Só a sessão escolhe motivo: a demanda precisa
  // de uma pessoa como autor (`fn_demanda_aplicar_motivo`).
  const pessoa = authz.actor.type === "user" ? authz.actor.id : null;
  if (pessoa === null && parsed.data.motivo_id) {
    return fail("validation_failed", t("O motivo de encerramento só pode ser escolhido pela sessão."), 422, { requestId });
  }
  let motivoEscolhido: MotivoDeEncerramento | null = null;
  if (pessoa !== null) {
    const motivo = await conferirMotivo(authz.supabase, authz.organizationId, parsed.data.motivo_id, requestId);
    if (motivo.tipo === "motivo_invalido") {
      return fail("motivo_invalido", t("Escolha um motivo de encerramento válido."), 422, { requestId });
    }
    if (motivo.tipo === "motivo_required") {
      return fail("motivo_required", t("Escolha o motivo do encerramento."), 422, {
        requestId,
        details: { motivos: motivo.motivos },
      });
    }
    if (motivo.tipo === "falha") {
      return fail("internal_error", motivo.detalhe, 500, { requestId });
    }
    motivoEscolhido = motivo.motivo;
  }

  try {
    const { conversation, devolucao } = await fecharConversaHandler(
      authz.supabase,
      {
        organization_id: authz.organizationId,
        // O papel da sessão vai no ator: o handler decide por ele se um gerente
        // devolve ao automático a conversa de um colega (#3436).
        actor: authz.papelDaSessao && authz.actor.type === "user"
          ? { ...authz.actor, role: authz.papelDaSessao }
          : authz.actor,
        requestId,
        idioma: authz.idioma,
        ...(authz.apiTokenId !== undefined ? { apiTokenId: authz.apiTokenId } : {}),
      },
      id,
      {
        ...(parsed.data.expected_revision !== undefined
          ? { expectedRevision: parsed.data.expected_revision }
          : {}),
        ...(parsed.data.devolver_ao_automatico !== undefined
          ? { devolverAoAutomatico: parsed.data.devolver_ao_automatico }
          : {}),
      },
    );

    // (4) O MOTIVO NA DEMANDA, depois do fechamento — que já aconteceu e não é
    // desfeito por falha aqui. O resultado viaja no corpo.
    const motivoNoFechamento =
      motivoEscolhido && pessoa !== null
        ? await registrarMotivo(conversation, motivoEscolhido, pessoa, requestId)
        : null;

    return ok(
      {
        ...conversation,
        ...(devolucao === null ? {} : { devolucao }),
        ...(motivoNoFechamento === null ? {} : { motivo_de_encerramento: motivoNoFechamento }),
      },
      { requestId },
    );
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, t(err.message), err.status, { requestId });
    throw err;
  }
}

/** Grava o motivo na demanda do atendimento recém-fechado, com auditoria. */
async function registrarMotivo(
  conversa: Conversation,
  motivo: MotivoDeEncerramento,
  actorUserId: string,
  requestId: string,
): Promise<MotivoNoFechamento> {
  const aplicado = await aplicarMotivoNaDemanda(createAdminClient(), {
    organizationId: conversa.organization_id,
    demandaId: conversa.current_demanda_id ?? null,
    motivoId: motivo.id,
    actorUserId,
  });
  if (aplicado.ok) {
    await audit({
      action: "demanda.motivo_registrado",
      actorUserId,
      organizationId: conversa.organization_id,
      resourceType: "demanda",
      resourceId: aplicado.demandaId,
      requestId,
      metadata: { motivo_id: motivo.id, categoria: motivo.categoria, conversation_id: conversa.id },
    });
    return {
      id: motivo.id, nome: motivo.nome, registrado: true,
      demanda_id: aplicado.demandaId, desfecho: aplicado.desfecho, protocolo: aplicado.protocolo,
    };
  }
  if (aplicado.erro === "falha") {
    logger.error("[conversations.close] motivo não chegou à demanda", {
      conversation_id: conversa.id,
      organization_id: conversa.organization_id,
      detalhe: aplicado.detalhe,
      requestId,
    });
  }
  return { id: motivo.id, nome: motivo.nome, registrado: false, erro: aplicado.erro };
}

/**
 * A conferência do motivo, com uma assimetria deliberada:
 *
 *   - `motivo_id` no pedido e a lista não pôde ser lida → 500. Gravar um motivo
 *     que ninguém conferiu seria pior que não fechar agora.
 *   - nenhum `motivo_id` e a EXIGÊNCIA não pôde ser lida → fecha (com aviso no
 *     log). A exigência é política de qualidade do registro, não de segurança:
 *     uma leitura que falhou não pode impedir a equipe de encerrar o atendimento,
 *     que é o gesto pedido.
 */
async function conferirMotivo(
  supabase: SupabaseClient,
  organizationId: string,
  motivoId: string | undefined,
  requestId: string,
): Promise<DecisaoDoMotivo | { tipo: "falha"; detalhe: string }> {
  if (motivoId) {
    try {
      const ativos = await lerMotivosAtivos(supabase, organizationId);
      return decidirMotivo({ motivoId, exigido: false, ativos });
    } catch (erro) {
      return { tipo: "falha", detalhe: erro instanceof Error ? erro.message : "motivos_de_encerramento" };
    }
  }
  try {
    if (!(await lerExigenciaDeMotivo(supabase, organizationId))) return { tipo: "ok", motivo: null };
    const ativos = await lerMotivosAtivos(supabase, organizationId);
    return decidirMotivo({ motivoId: undefined, exigido: true, ativos });
  } catch (erro) {
    logger.warn("[conversations.close] exigência de motivo não pôde ser lida; fechando sem motivo", {
      organization_id: organizationId,
      erro: erro instanceof Error ? erro.message : String(erro),
      requestId,
    });
    return { tipo: "ok", motivo: null };
  }
}
