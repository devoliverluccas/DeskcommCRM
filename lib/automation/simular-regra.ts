/**
 * O "TESTAR" DO EDITOR DE AUTOMAÇÕES — a regra contra um contato real, SEM
 * EFEITO (fase 4, 4.1).
 *
 * ─── O que é avaliado, e o que é só descrito ───────────────────────────────
 *
 * - O GATILHO, quando dá para avaliar: a palavra-chave é conferida contra o
 *   texto de exemplo, pelo MESMO `palavraQueCasa` do motor. Os outros gatilhos
 *   são fatos que não se reproduzem sem acontecer (um negócio ganho, um horário
 *   marcado): o teste SUPÕE que aconteceu, e diz isso (`suposto`).
 * - As CONDIÇÕES, de verdade: o contexto é montado como o motor monta o de
 *   mensagem recebida (contato, conversa, negócio aberto mais recente, idioma e
 *   fuso da empresa, rótulos do funil) e passa pelo MESMO `evaluateConditions`,
 *   com os fatos do contato quando alguma condição os usa.
 * - As AÇÕES, só descritas: para cada uma, se rodaria e o aviso que a impediria
 *   (sem telefone, canal desconectado, sem negócio, sem conversa…), com a prévia
 *   do texto quando a ação escreve. NENHUM executor é chamado.
 *
 * ─── Nada é escrito ────────────────────────────────────────────────────────
 *
 * Esta função só LÊ, e lê pelo client que a rota entregar — a rota usa o da
 * sessão (RLS), então o teste não enxerga o que quem testa não enxerga. A única
 * escrita do "Testar" é a auditoria, na rota.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { actionSchema, acoesQueFechamLaco } from "@/lib/schemas/webhooks";
import { contarCondicoes, condicoesDeCampo, evaluateConditions, usaFatosDoContato, type Conditions } from "@/lib/automation/conditions";
import { carregarFatosDoContato } from "@/lib/automation/fatos-do-contato";
import { hidratarCamposDoFunil } from "@/lib/automation/campos-do-render";
import { anexarOpcoesDoRender } from "@/lib/automation/opcoes-do-render";
import { renderTemplate } from "@/lib/automation/template";
import { GATILHO_PALAVRA_CHAVE, configDaPalavraChave, palavraQueCasa } from "@/lib/automation/gatilho-palavra-chave";
import { ACOES_QUE_ENVIAM_PELO_CANAL, canalEstaAtivo, type CanalParaProntidao } from "@/lib/automation/prontidao-da-regra";
import { EVENTO_DA_VENDA } from "@/lib/automation/conversao-pela-automacao";
import { ocultarProvaMetaNaResposta } from "@/lib/leads/prova-meta-lead-submitted";

export type SituacaoDoGatilho = "casou" | "nao_casou" | "suposto" | "falta_texto" | "nao_configurado";
export type SituacaoDasCondicoes = "passam" | "nao_passam" | "sem_condicoes";

/** Por que a ação NÃO rodaria (ou rodaria pela metade). A tela traduz cada código. */
export type AvisoDaAcao =
  | "acao_invalida"
  | "fecharia_laco"
  | "sem_contato"
  | "sem_telefone"
  | "sem_email"
  | "canal_inativo"
  | "sem_negocio"
  | "negocio_nao_ganho"
  | "sem_conversa";

export interface AcaoSimulada {
  indice: number;
  type: string;
  rodaria: boolean;
  aviso: AvisoDaAcao | null;
  /** O texto que a ação escreveria (mensagem, assunto), já com as variáveis. */
  previa: string | null;
}

export interface ResultadoDaSimulacao {
  gatilho: { situacao: SituacaoDoGatilho; palavra: string | null };
  condicoes: { situacao: SituacaoDasCondicoes; usam_dados_do_evento: boolean };
  acoes: AcaoSimulada[];
  /** O gatilho casou (ou foi suposto) e as condições passam. */
  rodaria: boolean;
  alvo: {
    contato: { id: string; name: string | null } | null;
    conversa_id: string | null;
    negocio: { id: string; title: string | null } | null;
  };
}

export interface RegraParaSimular {
  trigger_event: string;
  trigger_config: Record<string, unknown> | null;
  conditions: Conditions;
  actions: Array<{ type: string; config?: Record<string, unknown> }>;
}

const ENCERRADAS = "(closed,archived)";

/** Os campos do evento que o teste conhece: só o texto da mensagem de exemplo. */
const CAMPOS_DO_EVENTO_SIMULADOS = new Set(["event.body_preview"]);

export async function simularRegra(entrada: {
  db: SupabaseClient;
  organizationId: string;
  regra: RegraParaSimular;
  contactId: string | null;
  conversationId: string | null;
  texto: string | null;
}): Promise<ResultadoDaSimulacao | { erro: "alvo_nao_encontrado" }> {
  const { db, organizationId, regra } = entrada;

  // ── O alvo: conversa e contato, sempre filtrados pela organização ─────────
  type Conversa = { id: string; contact_id: string | null };
  let conversa: Conversa | null = null;
  if (entrada.conversationId) {
    const { data } = await db
      .from("conversations")
      .select("id, contact_id")
      .eq("id", entrada.conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    conversa = (data as Conversa | null) ?? null;
    if (!conversa) return { erro: "alvo_nao_encontrado" };
  }
  const contactId = entrada.contactId ?? conversa?.contact_id ?? null;

  let contato: Record<string, unknown> | null = null;
  if (contactId) {
    const { data } = await db
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    contato = (data as Record<string, unknown> | null) ?? null;
    if (!contato) return { erro: "alvo_nao_encontrado" };
  }
  if (!contato && !conversa) return { erro: "alvo_nao_encontrado" };

  if (!conversa && contactId) {
    const { data } = await db
      .from("conversations")
      .select("id, contact_id")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .not("status", "in", ENCERRADAS)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    conversa = (data as Conversa | null) ?? null;
  }

  let negocio: Record<string, unknown> | null = null;
  if (contactId) {
    const { data } = await db
      .from("crm_leads")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    negocio = data ? ocultarProvaMetaNaResposta(data as Record<string, unknown>) : null;
  }

  // ── O contexto, no molde do `buildContext` da mensagem recebida ───────────
  const texto = entrada.texto?.trim() ? entrada.texto : null;
  const context: Record<string, unknown> = {
    event: {
      contact_id: contactId,
      conversation_id: conversa?.id ?? null,
      direction: "inbound",
      ...(texto ? { body_preview: texto.slice(0, 280) } : {}),
      ...(negocio ? { lead_id: negocio.id } : {}),
    },
  };
  const { data: organizacao } = await db
    .from("organizations")
    .select("locale, timezone")
    .eq("id", organizationId)
    .maybeSingle();
  anexarOpcoesDoRender(context, {
    idioma: (organizacao as { locale?: string | null } | null)?.locale,
    fuso: (organizacao as { timezone?: string | null } | null)?.timezone,
  });
  if (contato) context.contact = contato;
  if (negocio) {
    context.lead = negocio;
    await hidratarCamposDoFunil(context, db, organizationId);
  }

  // ── O gatilho ────────────────────────────────────────────────────────────
  let gatilho: ResultadoDaSimulacao["gatilho"] = { situacao: "suposto", palavra: null };
  if (regra.trigger_event === GATILHO_PALAVRA_CHAVE) {
    const config = configDaPalavraChave(regra.trigger_config);
    if (!config) gatilho = { situacao: "nao_configurado", palavra: null };
    else if (!texto) gatilho = { situacao: "falta_texto", palavra: null };
    else {
      const palavra = palavraQueCasa(texto, config);
      gatilho = { situacao: palavra ? "casou" : "nao_casou", palavra };
    }
  }

  // ── As condições ─────────────────────────────────────────────────────────
  const conditions = regra.conditions ?? [];
  let situacaoDasCondicoes: SituacaoDasCondicoes = "sem_condicoes";
  if (contarCondicoes(conditions) > 0) {
    const fatos =
      contactId && usaFatosDoContato(conditions)
        ? await carregarFatosDoContato(db, organizationId, contactId)
        : null;
    situacaoDasCondicoes = evaluateConditions(conditions, context, fatos) ? "passam" : "nao_passam";
  }
  const usamDadosDoEvento = condicoesDeCampo(conditions).some(
    (c) => c.field.startsWith("event.") && !CAMPOS_DO_EVENTO_SIMULADOS.has(c.field),
  );

  // ── As ações, só descritas ───────────────────────────────────────────────
  const precisaDeCanais = regra.actions.some((a) => (ACOES_QUE_ENVIAM_PELO_CANAL as readonly string[]).includes(a.type));
  let canais: CanalParaProntidao[] = [];
  if (precisaDeCanais) {
    const { data } = await db
      .from("channel_sessions")
      .select("id, status, metadata")
      .eq("organization_id", organizationId);
    canais = (data ?? []) as CanalParaProntidao[];
  }

  const telefone = typeof contato?.phone_number === "string" && contato.phone_number ? contato.phone_number : null;
  const email = typeof contato?.email === "string" && contato.email ? contato.email : null;
  const acoes = regra.actions.map((acao, indice): AcaoSimulada => {
    const config = acao.config ?? {};
    const descrever = (aviso: AvisoDaAcao | null, previa: string | null = null): AcaoSimulada => ({
      indice,
      type: acao.type,
      rodaria: aviso === null,
      aviso,
      previa,
    });
    if (!actionSchema.safeParse({ type: acao.type, config }).success) return descrever("acao_invalida");
    if (acoesQueFechamLaco(regra.trigger_event, [acao]).length) return descrever("fecharia_laco");

    const canalOk = () => canalEstaAtivo(canais.find((c) => c.id === config.channel_session_id));
    switch (acao.type) {
      case "send_whatsapp_message": {
        const previa = renderTemplate(String(config.template ?? ""), context);
        if (!contato) return descrever("sem_contato", previa);
        if (!telefone) return descrever("sem_telefone", previa);
        if (!canalOk()) return descrever("canal_inativo", previa);
        return descrever(null, previa);
      }
      case "send_ai_message":
        if (!contato) return descrever("sem_contato");
        if (!telefone) return descrever("sem_telefone");
        if (!canalOk()) return descrever("canal_inativo");
        return descrever(null);
      case "send_email": {
        const previa = renderTemplate(String(config.assunto ?? ""), context);
        if (config.destinatario === "contato" && !email) return descrever(contato ? "sem_email" : "sem_contato", previa);
        if (config.destinatario === "dono_do_lead" && !negocio) return descrever("sem_negocio", previa);
        return descrever(null, previa);
      }
      case "assign_owner":
      case "set_lead_date_field":
        return descrever(negocio ? null : "sem_negocio");
      case "send_ad_conversion":
        if (!negocio) return descrever("sem_negocio");
        // A venda só sai de negócio ganho — e o teste usa o negócio ABERTO do contato.
        if (config.evento === EVENTO_DA_VENDA) return descrever("negocio_nao_ganho");
        return descrever(null);
      case "pause_ai":
      case "define_sector":
        return descrever(conversa ? null : "sem_conversa");
      default:
        return descrever(contato || negocio ? null : "sem_contato");
    }
  });

  const gatilhoVale = gatilho.situacao === "casou" || gatilho.situacao === "suposto";
  return {
    gatilho,
    condicoes: { situacao: situacaoDasCondicoes, usam_dados_do_evento: usamDadosDoEvento },
    acoes,
    rodaria: gatilhoVale && situacaoDasCondicoes !== "nao_passam",
    alvo: {
      contato: contato
        ? { id: String(contato.id), name: typeof contato.name === "string" ? contato.name : null }
        : null,
      conversa_id: conversa?.id ?? null,
      negocio: negocio
        ? { id: String(negocio.id), title: typeof negocio.title === "string" ? negocio.title : null }
        : null,
    },
  };
}
