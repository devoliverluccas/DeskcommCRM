/**
 * Ação `send_ad_conversion` (fase 4, 4.1) — "Enviar conversão para plataforma
 * de anúncio".
 *
 * ─── Só CHAMA o envio das regras de conversão ──────────────────────────────
 *
 * Não há transporte aqui, nem leitura de credencial, nem livro-razão próprio:
 * a ação chama `processarConversao` (`lib/conversoes/envio.handler.ts`), o MESMO
 * envio das regras de venda e de etapa. Lá moram a atribuição do contato (qual
 * plataforma o trouxe), o registro de transportes, a credencial, as travas de
 * "já enviada", o livro-razão `ad_conversion_dispatches` e o reenvio pela tela
 * de Conversões. O vocabulário e o porquê estão em
 * `lib/automation/conversao-pela-automacao.ts`.
 *
 * ─── O desfecho, traduzido para o recibo ───────────────────────────────────
 *
 * O envio devolve um `HandlerResult` (feito para o `event_log`). Aqui ele vira:
 *  - `ok` → `success`;
 *  - `skipped` → `skipped` com motivo NOMEADO do recibo (`conversao_nao_enviada`)
 *    e o código do envio em `detail.motivo_do_envio` — a frase de cada código já
 *    mora na tela de Conversões, que é onde a pendência se resolve;
 *  - `retry` → `failed` (`conversao_adiada`): ninguém reexecuta a ação, e o
 *    livro-razão já guardou a pendência com reenvio pela tela de Conversões.
 */
import { registerAction } from "@/lib/automation/actions";
import type { ActionCtx, ActionResultDetail } from "@/lib/automation/types";
import {
  EVENTO_DA_VENDA,
  ehEventoDaConversaoNaAutomacao,
} from "@/lib/automation/conversao-pela-automacao";
import { processarConversao } from "@/lib/conversoes/envio.handler";

/** Só o CÓDIGO do envio (`sem_atribuicao`, `nao_e_ganho`…) vai ao recibo — nunca frase livre. */
function codigoDoEnvio(detalhe: string | undefined): string | null {
  return typeof detalhe === "string" && /^[a-z_]{1,60}$/.test(detalhe) ? detalhe : null;
}

async function execute(ctx: ActionCtx, config: Record<string, unknown>): Promise<ActionResultDetail> {
  const evento = config.evento;
  if (!ehEventoDaConversaoNaAutomacao(evento)) {
    return { type: "send_ad_conversion", status: "failed", error: "missing_config" };
  }
  const lead = ctx.context.lead as { id?: string } | undefined;
  if (!lead?.id) {
    return { type: "send_ad_conversion", status: "skipped", detail: { reason: "conversao_sem_negocio", evento } };
  }

  // A linha que o envio lê: o negócio como entidade, a organização do evento.
  // `event_type` próprio — o envio só trata diferente o `ad_conversion.retry_requested`.
  const linha = {
    ...ctx.event,
    event_type: "automation.ad_conversion",
    entity_kind: "crm_lead",
    entity_id: lead.id,
    organization_id: ctx.organizationId,
  };

  let resultado;
  try {
    resultado =
      evento === EVENTO_DA_VENDA
        ? await processarConversao(linha)
        : await processarConversao(linha, {
            ocorridoEm: new Date().toISOString(),
            evento: `MetaEtapa:${ctx.ruleId}`,
            eventoMeta: evento,
          });
  } catch {
    return {
      type: "send_ad_conversion",
      status: "failed",
      error: "conversao_adiada",
      // A mensagem do erro fica fora do recibo: ele sobrevive ao contato, e
      // texto livre de provedor não vai junto (`resultado-para-recibo.ts`).
      detail: { evento },
    };
  }

  if (resultado.status === "ok") {
    return { type: "send_ad_conversion", status: "success", detail: { evento, lead_id: lead.id } };
  }
  if (resultado.status === "retry") {
    return {
      type: "send_ad_conversion",
      status: "failed",
      error: "conversao_adiada",
      detail: { evento, lead_id: lead.id, motivo_do_envio: codigoDoEnvio(resultado.detail) },
    };
  }
  return {
    type: "send_ad_conversion",
    status: "skipped",
    detail: {
      reason: "conversao_nao_enviada",
      evento,
      lead_id: lead.id,
      motivo_do_envio: codigoDoEnvio(resultado.detail),
    },
  };
}

registerAction({ type: "send_ad_conversion", execute });
