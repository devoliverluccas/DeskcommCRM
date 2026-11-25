/**
 * SAÚDE DO NÚMERO OFICIAL (fase 5, item 5.5) — qualidade e limite de conversas.
 *
 * ─── O que estava invisível ────────────────────────────────────────────────
 *
 * A Meta dá a cada número oficial uma NOTA de qualidade (verde, amarela,
 * vermelha) e um LIMITE de conversas que a empresa pode iniciar em 24 horas
 * (`TIER_1K`, `TIER_10K`…). Os dois mudam com o comportamento do envio: muita
 * gente bloqueando ou denunciando derruba a nota, e nota vermelha por dias
 * derruba o limite. O CRM não guardava nenhum dos dois — o operador descobria a
 * queda pelo disparo que parou de sair.
 *
 * ─── Duas fontes, um lugar ─────────────────────────────────────────────────
 *
 * - o EMPURRÃO: os webhooks `phone_number_quality_update` (limite e, quando a
 *   nota cai para baixa, `FLAGGED`) e `account_update` (restrição da conta);
 * - a PERGUNTA: `GET /{phone_number_id}?fields=quality_rating,messaging_limit_tier`
 *   na Graph, feita ao abrir a tela quando a última leitura envelheceu.
 *
 * As duas gravam nas MESMAS colunas de `channel_sessions` (migration 9496), por
 * `gravarSaudeDoNumero`, que também decide o aviso na Central. O porquê de
 * coluna e não `metadata` está no cabeçalho da migration.
 *
 * ─── O que NUNCA acontece aqui ─────────────────────────────────────────────
 *
 * Nada lança. Quem chama é o webhook (um throw vira 5xx e a Meta reentrega o
 * mesmo corpo por horas) ou a tela (um throw vira tela quebrada por causa de um
 * dado acessório). Falha vai ao log estruturado e ao desfecho devolvido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { ARCHIVED_AT, queryTolerantToMissingArchived } from "../archived";
import { CHANNEL_PROVIDER_META } from "../capabilities";
import { resolveMetaCreds } from "./credentials";
import { graphBaseUrl } from "./graph-base";

/** O vocabulário da nota — espelha o CHECK `channel_sessions_meta_quality_rating_check`. */
export const QUALIDADES_DO_NUMERO = ["GREEN", "YELLOW", "RED", "UNKNOWN"] as const;
export type QualidadeDoNumero = (typeof QUALIDADES_DO_NUMERO)[number];

/** Quanto a nota pesa: maior = pior. `UNKNOWN` não conta como queda nem como melhora. */
const GRAVIDADE: Record<QualidadeDoNumero, number> = { UNKNOWN: -1, GREEN: 0, YELLOW: 1, RED: 2 };

/**
 * A nota no vocabulário do banco. A Graph devolve `GREEN/YELLOW/RED/UNKNOWN`;
 * versões antigas e o Gerenciador falam `HIGH/MEDIUM/LOW` — os dois viram o
 * mesmo. Qualquer outro texto vira `UNKNOWN` (o CHECK recusaria, e o webhook
 * perderia a leitura inteira por causa de uma palavra nova). Ausente = `null`.
 */
export function normalizarQualidade(v: unknown): QualidadeDoNumero | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const s = v.trim().toUpperCase();
  if ((QUALIDADES_DO_NUMERO as readonly string[]).includes(s)) return s as QualidadeDoNumero;
  if (s === "HIGH") return "GREEN";
  if (s === "MEDIUM") return "YELLOW";
  if (s === "LOW") return "RED";
  return "UNKNOWN";
}

/**
 * O degrau do limite (`TIER_1K`, `TIER_UNLIMITED`…). Vocabulário ABERTO: a
 * coluna não tem CHECK e aqui só se exige a forma `TIER_<algo>`. Fora disso,
 * `null` — melhor não gravar do que gravar lixo que a tela não sabe ler.
 */
export function normalizarLimite(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  return /^TIER_[A-Z0-9]+$/.test(s) ? s : null;
}

/**
 * Quantas conversas por 24h o degrau permite. `null` = sem limite
 * (`TIER_UNLIMITED`); `undefined` = degrau que não sabemos ler (não inventamos
 * número para ele).
 */
export function conversasDoLimite(tier: string | null | undefined): number | null | undefined {
  const s = normalizarLimite(tier);
  if (!s) return undefined;
  if (s === "TIER_UNLIMITED") return null;
  const m = /^TIER_(\d+)(K?)$/.exec(s);
  if (!m) return undefined;
  return Number(m[1]) * (m[2] === "K" ? 1000 : 1);
}

/**
 * A nota que o evento de qualidade AFIRMA. `FLAGGED` = a nota caiu para baixa
 * (a referência da Meta). `UNFLAGGED` diz só que saiu da baixa — pode ter ido
 * para média ou alta, e afirmar uma das duas seria inventar: devolve `null` e a
 * rota pergunta à Graph. Os outros eventos (`UPGRADE`, `DOWNGRADE`,
 * `ONBOARDING`) falam do LIMITE, não da nota.
 */
export function qualidadeDoEvento(evento: string | null | undefined): QualidadeDoNumero | null {
  const e = (evento ?? "").toUpperCase();
  if (e === "FLAGGED") return "RED";
  return null;
}

/** Eventos de `account_update` que tiram o número do ar ou restringem o envio. */
const EVENTOS_GRAVES_DA_CONTA = new Set([
  "ACCOUNT_RESTRICTION",
  "ACCOUNT_VIOLATION",
  "DISABLED_UPDATE",
  "ACCOUNT_DELETED",
  "BUSINESS_PRIMARY_LOCATION_COUNTRY_UPDATE_REJECTED",
]);

export function eventoDaContaEhGrave(evento: string | null | undefined): boolean {
  return EVENTOS_GRAVES_DA_CONTA.has((evento ?? "").toUpperCase());
}

/** O que uma observação traz. Campo ausente = não mexer na coluna. */
export interface ObservacaoDaSaude {
  qualidade?: QualidadeDoNumero | null;
  limite?: string | null;
  eventoDaConta?: string | null;
  /** O número que a Meta disse no evento — confere com o da conexão. */
  numeroExibido?: string | null;
}

export interface SaudeDoNumero {
  qualidade: QualidadeDoNumero | null;
  limite: string | null;
  /** Conversas por 24h; `null` = sem limite; ausente quando o degrau é desconhecido. */
  conversasPorDia: number | null | undefined;
  eventoDaConta: string | null;
  atualizadaEm: string | null;
}

export function saudeDaLinha(linha: {
  meta_quality_rating?: string | null;
  meta_messaging_limit_tier?: string | null;
  meta_account_event?: string | null;
  meta_saude_atualizada_em?: string | null;
} | null | undefined): SaudeDoNumero {
  const limite = normalizarLimite(linha?.meta_messaging_limit_tier ?? null);
  return {
    qualidade: normalizarQualidade(linha?.meta_quality_rating ?? null),
    limite,
    conversasPorDia: conversasDoLimite(limite),
    eventoDaConta: linha?.meta_account_event ?? null,
    atualizadaEm: linha?.meta_saude_atualizada_em ?? null,
  };
}

/** Quando a leitura guardada envelheceu e vale perguntar à Graph de novo. */
export const IDADE_MAXIMA_DA_LEITURA_MS = 30 * 60 * 1000;

export function leituraEnvelheceu(atualizadaEm: string | null | undefined, agora: Date): boolean {
  if (!atualizadaEm) return true;
  const t = Date.parse(atualizadaEm);
  return !Number.isFinite(t) || agora.getTime() - t > IDADE_MAXIMA_DA_LEITURA_MS;
}

// ─── O aviso na Central ──────────────────────────────────────────────────────

/** Mesmo kind dos outros avisos de número (`lib/channels/health.ts`) — sem kind novo no CHECK. */
export const KIND_DO_AVISO_DE_SAUDE = "channel_number_alert";

export interface AvisoDeSaude {
  kind: typeof KIND_DO_AVISO_DE_SAUDE;
  severity: "warn" | "critical";
  title: string;
  body: string;
}

/** Os títulos que ESTE módulo abre — é por eles que o fechamento acha o que é seu. */
export function tituloDaQueda(qualidade: "YELLOW" | "RED", apelido: string): string {
  return qualidade === "RED"
    ? `A qualidade do número "${apelido}" caiu para baixa`
    : `A qualidade do número "${apelido}" caiu para média`;
}

export function tituloDaConta(apelido: string): string {
  return `A Meta restringiu a conta do número "${apelido}"`;
}

/**
 * O aviso da QUEDA de nota — só quando piora para amarela ou vermelha.
 *
 * `anterior` desconhecido (`null`/`UNKNOWN`) e nova amarela/vermelha CONTA como
 * queda: é a primeira leitura de um número que já está mal, e calar seria
 * esconder justamente o caso grave. Igual ou melhor não avisa.
 */
export function avisoDaQueda(
  anterior: QualidadeDoNumero | null,
  nova: QualidadeDoNumero | null,
  apelido: string,
): AvisoDeSaude | null {
  if (nova !== "YELLOW" && nova !== "RED") return null;
  if (anterior && GRAVIDADE[anterior] >= GRAVIDADE[nova]) return null;
  return {
    kind: KIND_DO_AVISO_DE_SAUDE,
    severity: nova === "RED" ? "critical" : "warn",
    title: tituloDaQueda(nova, apelido),
    body:
      nova === "RED"
        ? "Muitos clientes estão bloqueando ou denunciando as mensagens deste número. Pause disparos em massa, mande só para quem pediu contato e revise o texto dos modelos. Se a nota seguir baixa, a Meta reduz o limite de conversas por dia."
        : "A Meta notou mais bloqueios e denúncias que o normal. Reduza o volume, mande só para quem pediu contato e revise o texto dos modelos antes que a nota caia para baixa.",
  };
}

export function avisoDaConta(evento: string, apelido: string): AvisoDeSaude {
  return {
    kind: KIND_DO_AVISO_DE_SAUDE,
    severity: "critical",
    title: tituloDaConta(apelido),
    body: `A Meta avisou um problema na conta do WhatsApp Business (${evento}). Veja o motivo e peça a revisão no Gerenciador do WhatsApp, na Meta.`,
  };
}

// ─── Gravar ──────────────────────────────────────────────────────────────────

export type DesfechoDaSaude =
  | "saude"
  | "saude:aviso"
  | "saude:sem_mudanca"
  | "saude:outro_numero"
  | "saude:sem_conexao"
  | "saude:falhou";

export interface AlvoDaSaude {
  /** Da SESSÃO (token do webhook ou cookie), nunca do corpo. */
  organizationId: string;
  channelSessionId: string;
}

function soDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/**
 * Grava a observação e decide o aviso. NUNCA lança.
 *
 * Lê a linha ANTES (a nota anterior decide se é queda) e escreve só os campos
 * que a observação trouxe — o evento de limite não apaga a nota, e vice-versa.
 */
export async function gravarSaudeDoNumero(
  admin: SupabaseClient,
  alvo: AlvoDaSaude,
  obs: ObservacaoDaSaude,
  agora: Date = new Date(),
): Promise<DesfechoDaSaude> {
  try {
    const { data: linha, error: erroDeLeitura } = await admin
      .from("channel_sessions")
      .select("id, display_name, phone_number, meta_quality_rating")
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.channelSessionId)
      .maybeSingle();
    if (erroDeLeitura) {
      logger.error("[saude-do-numero] conexão não lida", {
        organization_id: alvo.organizationId,
        channel_session_id: alvo.channelSessionId,
        erro: erroDeLeitura.message,
      });
      return "saude:falhou";
    }
    if (!linha) return "saude:sem_conexao";

    const atual = linha as {
      id: string;
      display_name: string | null;
      phone_number: string | null;
      meta_quality_rating: string | null;
    };

    // O evento de qualidade chega pela WABA, e uma WABA pode ter vários números:
    // número dito no evento que não é o desta conexão é de outra conexão.
    const dito = soDigitos(obs.numeroExibido);
    const nosso = soDigitos(atual.phone_number);
    if (dito && nosso && !dito.endsWith(nosso) && !nosso.endsWith(dito)) return "saude:outro_numero";

    const mudanca: Record<string, string | null> = { meta_saude_atualizada_em: agora.toISOString() };
    if (obs.qualidade !== undefined && obs.qualidade !== null) mudanca.meta_quality_rating = obs.qualidade;
    if (obs.limite !== undefined && obs.limite !== null) mudanca.meta_messaging_limit_tier = obs.limite;
    if (obs.eventoDaConta !== undefined && obs.eventoDaConta !== null) {
      mudanca.meta_account_event = obs.eventoDaConta.toUpperCase();
    }

    const { error: erroDeEscrita } = await admin
      .from("channel_sessions")
      .update(mudanca)
      .eq("organization_id", alvo.organizationId)
      .eq("id", alvo.channelSessionId);
    if (erroDeEscrita) {
      logger.error("[saude-do-numero] saúde não gravada", {
        organization_id: alvo.organizationId,
        channel_session_id: alvo.channelSessionId,
        erro: erroDeEscrita.message,
      });
      return "saude:falhou";
    }

    const apelido = atual.display_name || atual.phone_number || "oficial";
    const anterior = normalizarQualidade(atual.meta_quality_rating);
    const avisos: AvisoDeSaude[] = [];
    const queda = avisoDaQueda(anterior, obs.qualidade ?? null, apelido);
    if (queda) avisos.push(queda);
    if (obs.eventoDaConta && eventoDaContaEhGrave(obs.eventoDaConta)) {
      avisos.push(avisoDaConta(obs.eventoDaConta.toUpperCase(), apelido));
    }

    // Voltou ao verde: os avisos de queda que ESTE módulo abriu fecham sozinhos.
    // Aviso que não fecha ensina que a Central mostra coisa velha.
    if (obs.qualidade === "GREEN" && anterior !== "GREEN") {
      await admin
        .from("agent_inbox_items")
        .update({ status: "resolved" })
        .eq("organization_id", alvo.organizationId)
        .eq("kind", KIND_DO_AVISO_DE_SAUDE)
        .eq("ref_kind", "channel_session")
        .eq("ref_id", alvo.channelSessionId)
        .in("title", [tituloDaQueda("YELLOW", apelido), tituloDaQueda("RED", apelido)])
        .eq("status", "open");
    }

    let avisou = false;
    for (const aviso of avisos) {
      if (await abrirAviso(admin, alvo, aviso)) avisou = true;
    }
    if (avisou) return "saude:aviso";
    return Object.keys(mudanca).length > 1 ? "saude" : "saude:sem_mudanca";
  } catch (erro) {
    logger.error("[saude-do-numero] falha inesperada", {
      organization_id: alvo.organizationId,
      channel_session_id: alvo.channelSessionId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return "saude:falhou";
  }
}

/** Abre o aviso, uma vez por (conexão, título) aberto. `true` = abriu agora. */
async function abrirAviso(admin: SupabaseClient, alvo: AlvoDaSaude, aviso: AvisoDeSaude): Promise<boolean> {
  const { data: jaAberto } = await admin
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", alvo.organizationId)
    .eq("kind", aviso.kind)
    .eq("ref_kind", "channel_session")
    .eq("ref_id", alvo.channelSessionId)
    .eq("title", aviso.title)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (jaAberto) return false;
  const { error } = await admin.from("agent_inbox_items").insert({
    organization_id: alvo.organizationId,
    kind: aviso.kind,
    severity: aviso.severity,
    title: aviso.title,
    body: aviso.body,
    ref_kind: "channel_session",
    ref_id: alvo.channelSessionId,
  });
  if (error) {
    logger.error("[saude-do-numero] aviso não gravado", {
      organization_id: alvo.organizationId,
      channel_session_id: alvo.channelSessionId,
      erro: error.message,
    });
    return false;
  }
  return true;
}

// ─── Perguntar à Graph ───────────────────────────────────────────────────────

export type LeituraDaGraph =
  | { ok: true; qualidade: QualidadeDoNumero | null; limite: string | null }
  | { ok: false; motivo: string };

/** `GET /{phone_number_id}?fields=quality_rating,messaging_limit_tier`. Não lança. */
export async function lerSaudeNaGraph(input: {
  phoneNumberId: string;
  token: string;
  graphVersion?: string;
  /** Teto da espera — a tela não pode ficar presa numa Graph lenta. */
  timeoutMs?: number;
}): Promise<LeituraDaGraph> {
  try {
    const res = await fetch(
      `${graphBaseUrl(input.graphVersion)}/${input.phoneNumberId}?fields=quality_rating,messaging_limit_tier`,
      {
        headers: { Authorization: `Bearer ${input.token}` },
        signal: AbortSignal.timeout(input.timeoutMs ?? 5000),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      quality_rating?: unknown;
      messaging_limit_tier?: unknown;
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      return { ok: false, motivo: body.error?.message ?? `http_${res.status}` };
    }
    return {
      ok: true,
      qualidade: normalizarQualidade(body.quality_rating),
      limite: normalizarLimite(body.messaging_limit_tier),
    };
  } catch (erro) {
    return { ok: false, motivo: `rede indisponível: ${erro instanceof Error ? erro.message : "erro"}` };
  }
}

/**
 * A conexão oficial ATIVA da organização com a saúde guardada. `null` = não há
 * conexão oficial (ou a base não tem as colunas — clone sem a 9496).
 */
export async function saudeDaConexaoOficial(
  admin: SupabaseClient,
  organizationId: string,
): Promise<({ channelSessionId: string; phoneNumberId: string | null } & SaudeDoNumero) | null> {
  const base = () =>
    admin
      .from("channel_sessions")
      .select(
        "id, meta_phone_number_id, meta_quality_rating, meta_messaging_limit_tier, meta_account_event, meta_saude_atualizada_em",
      )
      .eq("organization_id", organizationId)
      .eq("provider", CHANNEL_PROVIDER_META)
      .order("created_at", { ascending: true })
      .limit(1);
  const { data, error } = await queryTolerantToMissingArchived(
    () => base().is(ARCHIVED_AT, null).maybeSingle(),
    () => base().maybeSingle(),
  );
  if (error || !data) return null;
  const linha = data as {
    id: string;
    meta_phone_number_id: string | null;
    meta_quality_rating: string | null;
    meta_messaging_limit_tier: string | null;
    meta_account_event: string | null;
    meta_saude_atualizada_em: string | null;
  };
  return { channelSessionId: linha.id, phoneNumberId: linha.meta_phone_number_id, ...saudeDaLinha(linha) };
}

/**
 * Pergunta à Graph e grava. Usado pela tela (quando a leitura envelheceu ou o
 * operador pede) e depois de `UNFLAGGED`, que não diz a nota nova.
 */
export async function atualizarSaudePelaGraph(
  admin: SupabaseClient,
  /** Sem `phoneNumberId` (o webhook não o tem), ele é lido da própria conexão. */
  alvo: AlvoDaSaude & { phoneNumberId?: string | null },
  agora: Date = new Date(),
): Promise<{ desfecho: DesfechoDaSaude | "graph:sem_credencial"; motivo?: string }> {
  let creds;
  try {
    let phoneNumberId = alvo.phoneNumberId ?? null;
    if (!phoneNumberId) {
      const { data } = await admin
        .from("channel_sessions")
        .select("meta_phone_number_id")
        .eq("organization_id", alvo.organizationId)
        .eq("id", alvo.channelSessionId)
        .maybeSingle();
      phoneNumberId = (data as { meta_phone_number_id?: string | null } | null)?.meta_phone_number_id ?? null;
    }
    if (!phoneNumberId) return { desfecho: "graph:sem_credencial" };
    creds = await resolveMetaCreds(admin, {
      organizationId: alvo.organizationId,
      phoneNumberId,
    });
  } catch (erro) {
    return { desfecho: "saude:falhou", motivo: erro instanceof Error ? erro.message : String(erro) };
  }
  if (!creds) return { desfecho: "graph:sem_credencial" };
  const leitura = await lerSaudeNaGraph({
    phoneNumberId: creds.phoneNumberId,
    token: creds.token,
    graphVersion: creds.graphVersion,
  });
  if (!leitura.ok) return { desfecho: "saude:falhou", motivo: leitura.motivo };
  const desfecho = await gravarSaudeDoNumero(
    admin,
    alvo,
    { qualidade: leitura.qualidade, limite: leitura.limite },
    agora,
  );
  return { desfecho };
}
