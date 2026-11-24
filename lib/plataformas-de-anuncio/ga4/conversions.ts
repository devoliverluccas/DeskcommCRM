/**
 * O transporte de conversões do Google Analytics 4 — Measurement Protocol (9488).
 *
 * Único arquivo do repo que conhece o endereço e o formato do fio do GA4.
 *
 * ─── EXCEÇÃO DECLARADA: o segredo vai na query string ───────────────────────
 *
 * A doutrina da casa (CLAUDE.md, "API key NUNCA em query string") existe porque
 * URL vaza: log de proxy, Sentry, histórico. O Measurement Protocol, porém, NÃO
 * aceita o `api_secret` em header — o protocolo oficial o exige como parâmetro
 * de `/mp/collect`. Não há alternativa que não seja deixar de integrar. A
 * exceção é contida assim:
 *
 *   1. a URL com o segredo é montada AQUI, numa função só (`urlDoColetor`), e
 *      nunca sai deste arquivo — ninguém a recebe de volta;
 *   2. ela nunca entra em `logger`, Sentry, auditoria nem livro-razão: todo
 *      texto que sai deste arquivo (detalhe de erro, mensagem de exceção de
 *      rede) passa por `semSegredo`, que troca o valor por `***`;
 *   3. a chamada é servidor → Google, sem proxy nosso no meio e sem redirect
 *      seguido para outro host (`redirect: "error"`).
 *
 * ─── O que a plataforma exige ───────────────────────────────────────────────
 *
 * - `client_id` é obrigatório. É o identificador do NAVEGADOR (o cookie `_ga`).
 *   Quando a chegada capturou o `_ga`, ele é usado — é o que liga a conversão à
 *   sessão do anúncio. Sem ele, um id ESTÁVEL por contato (hash), para que as
 *   conversões do mesmo cliente caiam no mesmo usuário do GA4 em vez de virarem
 *   um usuário novo a cada evento.
 * - `timestamp_micros` aceita até 72 horas no passado. Evento mais velho NÃO é
 *   recusado: é descartado em silêncio com 2xx. Por isso o teto é conferido
 *   aqui, e a perda vira linha visível no livro-razão em vez de sumir.
 * - O coletor responde 2xx para quase tudo (inclusive payload torto). A única
 *   validação real é o endpoint `/debug/mp/collect`, que o "Testar conexão" usa.
 *   Ele confere o FORMATO, não se o segredo vale — e a tela diz isso.
 */
import { createHash } from "node:crypto";

import { logger } from "@/lib/logger";

import { nomeNoFio } from "../mapeamento-de-eventos";
import type {
  ConversaoOffline,
  CredencialDeConversao,
  ResultadoDeEnvio,
  TransporteDeConversao,
} from "../types";

const HOST = "https://www.google-analytics.com";
const IDADE_MAXIMA_MS = 72 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 10_000;

/** `G-` + letras/dígitos: o formato do measurement id de um fluxo web do GA4. */
export const FORMA_DO_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

/** A ÚNICA função que monta a URL com o segredo. Ver o cabeçalho. */
function urlDoColetor(credencial: CredencialDeConversao, validacao: boolean): string {
  const q = new URLSearchParams({
    measurement_id: credencial.datasetId,
    api_secret: credencial.accessToken,
  });
  return `${HOST}${validacao ? "/debug" : ""}/mp/collect?${q.toString()}`;
}

/** Tira o segredo de qualquer texto antes de ele sair deste arquivo. */
export function semSegredo(texto: string, segredo: string): string {
  let limpo = texto.replace(/api_secret=[^&\s"']*/g, "api_secret=***");
  if (segredo) {
    limpo = limpo.split(segredo).join("***");
    const codificado = encodeURIComponent(segredo);
    if (codificado !== segredo) limpo = limpo.split(codificado).join("***");
  }
  return limpo;
}

/**
 * `client_id` estável por contato. O formato imita o do cookie (`n.n`) para o
 * id ficar legível ao lado dos reais no explorador do GA4; o conteúdo é hash —
 * nada pessoal vai ao fio.
 */
export function clientIdDerivado(semente: string): string {
  const h = createHash("sha256").update(semente).digest("hex");
  return `${parseInt(h.slice(0, 8), 16)}.${parseInt(h.slice(8, 16), 16)}`;
}

/** `GA1.1.123.456` (cookie) ou `123.456` (já extraído) → `123.456`. */
export function clientIdDoCookie(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.trim();
  const doCookie = /^GA\d\.\d+\.(\d+\.\d+)$/.exec(limpo);
  if (doCookie) return doCookie[1] ?? null;
  return /^\d+\.\d+$/.test(limpo) ? limpo : null;
}

function montarCorpo(conversao: ConversaoOffline, nome: string): Record<string, unknown> {
  const identidade = conversao.identidadeDoContato;
  const clientId =
    clientIdDoCookie(identidade?.gaClientId) ??
    clientIdDerivado(
      `${conversao.organizationId}:${identidade?.contatoId ?? conversao.leadId ?? conversao.eventoId}`,
    );
  const params: Record<string, unknown> = {
    // Deduplicação do lado do GA4 na compra; inofensivo nos outros eventos.
    transaction_id: conversao.eventoId,
  };
  // Sem valor, o evento sai SEM `value` — nunca com 0, que o GA4 somaria como
  // receita zero e puxaria a média para baixo.
  if (conversao.valorCentavos !== null) {
    params.value = conversao.valorCentavos / 100;
    params.currency = conversao.moeda.toUpperCase();
  }
  return {
    client_id: clientId,
    timestamp_micros: conversao.ocorridoEm.getTime() * 1000,
    events: [{ name: nome, params }],
  };
}

async function postar(
  credencial: CredencialDeConversao,
  corpo: Record<string, unknown>,
  validacao: boolean,
): Promise<{ ok: true; resposta: Response } | { ok: false; resultado: ResultadoDeEnvio }> {
  try {
    const resposta = await fetch(urlDoColetor(credencial, validacao), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      redirect: "error",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    return { ok: true, resposta };
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : "falha de rede";
    return {
      ok: false,
      resultado: { tipo: "transitorio", detalhe: semSegredo(msg, credencial.accessToken) },
    };
  }
}

async function enviar(
  credencial: CredencialDeConversao,
  conversao: ConversaoOffline,
): Promise<ResultadoDeEnvio> {
  const nome = nomeNoFio("ga4", credencial.mapeamento, conversao.evento, conversao.eventoNaPlataforma);
  if (!nome) {
    return {
      tipo: "permanente",
      detalhe: "Este evento está desligado nas regras de conversão do Google Analytics 4.",
    };
  }
  const idadeMs = Date.now() - conversao.ocorridoEm.getTime();
  if (idadeMs > IDADE_MAXIMA_MS) {
    const horas = Math.floor(idadeMs / (60 * 60 * 1000));
    return {
      tipo: "permanente",
      detalhe:
        `evento com ${horas} horas — o GA4 descarta acima de 72. ` +
        `Ele aconteceu em ${conversao.ocorridoEm.toISOString()} e não pode mais ser reportado.`,
    };
  }

  const ida = await postar(credencial, montarCorpo(conversao, nome), false);
  if (!ida.ok) return ida.resultado;
  const { resposta } = ida;
  if (resposta.ok) return { tipo: "ok" };

  const texto = semSegredo((await resposta.text().catch(() => "")).slice(0, 400), credencial.accessToken);
  logger.warn("[conversoes.ga4] envio recusado", {
    status: resposta.status,
    leadId: conversao.leadId,
  });
  if (resposta.status === 429 || resposta.status >= 500) {
    return { tipo: "transitorio", detalhe: `${resposta.status}: ${texto || "coletor indisponível"}` };
  }
  return { tipo: "permanente", detalhe: `${resposta.status}: ${texto || "recusado pelo coletor"}` };
}

/** Pelo endpoint de validação: nada é registrado no GA4. */
async function testarConexao(credencial: CredencialDeConversao): Promise<ResultadoDeEnvio> {
  const corpo = {
    client_id: clientIdDerivado("teste-de-conexao"),
    events: [{ name: "generate_lead", params: { value: 1, currency: "BRL" } }],
  };
  const ida = await postar(credencial, corpo, true);
  if (!ida.ok) return ida.resultado;
  const { resposta } = ida;
  if (resposta.status === 429 || resposta.status >= 500) {
    return { tipo: "transitorio", detalhe: `${resposta.status}: coletor indisponível` };
  }
  const json = (await resposta.json().catch(() => null)) as {
    validationMessages?: Array<{ description?: string; fieldPath?: string }>;
  } | null;
  if (!resposta.ok || !json) {
    return { tipo: "permanente", detalhe: `${resposta.status}: resposta inesperada do coletor` };
  }
  const mensagens = (json.validationMessages ?? [])
    .map((m) => [m.fieldPath, m.description].filter(Boolean).join(": "))
    .filter(Boolean);
  if (mensagens.length > 0) {
    return {
      tipo: "permanente",
      detalhe: semSegredo(mensagens.join(" | ").slice(0, 400), credencial.accessToken),
    };
  }
  return { tipo: "ok", detalhe: "validacao_de_formato" };
}

export const transporteGa4: TransporteDeConversao = {
  plataforma: "ga4",
  enviar,
  testarConexao,
};

/** Exportados para o teste vigiar as regras sem falar com a rede. */
export const INTERNOS = { IDADE_MAXIMA_MS, montarCorpo } as const;
