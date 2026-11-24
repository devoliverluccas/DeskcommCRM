/**
 * O transporte de conversões do TikTok — Events API 1.3 (9488).
 *
 * Único arquivo do repo que conhece o endereço e o formato do fio do TikTok.
 *
 * ─── O que a plataforma exige ───────────────────────────────────────────────
 *
 * - Token no header `Access-Token`, nunca na URL (doutrina da casa — e aqui o
 *   protocolo permite, diferente do GA4).
 * - `event_source: "web"` + `event_source_id` = o código do PIXEL. É a origem
 *   que casa com a credencial que a tela pede (o pixel do site/anúncio). A
 *   origem `crm` existe, mas exige um "CRM event set" próprio e `lead_id` do
 *   formulário instantâneo do TikTok — que esta casa não tem.
 * - Dado pessoal vai em SHA-256, normalizado ANTES do hash: e-mail em minúsculas
 *   sem espaço; telefone em E.164 COM o `+` (o TikTok pede o `+`; a Meta não —
 *   copiar a normalização da Meta erraria todo hash de telefone em silêncio).
 * - `ttclid` é o clique do anúncio: é ele que liga a conversão à campanha.
 * - O TikTok responde HTTP 200 também para erro: o veredito é o `code` do corpo
 *   (0 = aceito). Ler só o status HTTP daria toda recusa como enviada.
 * - Evento com mais de 7 dias não atribui — o teto é conferido aqui, e a perda
 *   vira linha visível no livro-razão.
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

const ENDERECO = "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 10_000;

/** Código do pixel: letras maiúsculas e dígitos (ex.: `C4ABCDEF1234567890`). */
export const FORMA_DO_PIXEL = /^[A-Z0-9]{8,40}$/;

/** O código que marca o evento do "Testar conexão" quando a organização não tem um. */
const CODIGO_DE_TESTE_PADRAO = "TEST_CONNECTION";

function sha256(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

export function hashDoEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}

/** Dígitos (E.164 sem `+`, como a casa guarda) → `+<dígitos>` → SHA-256. */
export function hashDoTelefone(telefone: string): string {
  return sha256(`+${telefone.replace(/\D/g, "")}`);
}

/**
 * Códigos do corpo que se resolvem esperando: limite de chamadas (40100) e a
 * família 5xxxx (erro do lado deles). O resto — token inválido (40105),
 * permissão (40001), parâmetro (40002) — pede alguém mexer na configuração.
 */
function classificaCodigo(codigo: number, mensagem: string): ResultadoDeEnvio {
  if (codigo === 40100 || codigo >= 50000) {
    return { tipo: "transitorio", detalhe: `${codigo}: ${mensagem}` };
  }
  return { tipo: "permanente", detalhe: `${codigo}: ${mensagem}` };
}

function montarUsuario(conversao: ConversaoOffline): Record<string, unknown> {
  const identidade = conversao.identidadeDoContato;
  const usuario: Record<string, unknown> = {};
  // Com a identidade do contato, o `ttclid` é o que ela diz (e só ele). Sem
  // ela, o chamador é o despacho por ATRIBUIÇÃO, que só chega aqui quando a
  // atribuição é do TikTok — e então o clique de origem É o `ttclid`.
  const ttclid = identidade ? identidade.ttclid : conversao.cliqueDeOrigem.trim() || null;
  if (ttclid) usuario.ttclid = ttclid;
  if (conversao.telefone) usuario.phone = hashDoTelefone(conversao.telefone);
  if (identidade?.email) usuario.email = hashDoEmail(identidade.email);
  const externo = identidade?.contatoId ?? conversao.leadId;
  if (externo) usuario.external_id = sha256(externo);
  return usuario;
}

async function postar(
  credencial: CredencialDeConversao,
  corpo: Record<string, unknown>,
): Promise<ResultadoDeEnvio> {
  let resposta: Response;
  try {
    resposta = await fetch(ENDERECO, {
      method: "POST",
      headers: { "content-type": "application/json", "Access-Token": credencial.accessToken },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    return { tipo: "transitorio", detalhe: erro instanceof Error ? erro.message : "falha de rede" };
  }
  if (resposta.status === 429 || resposta.status >= 500) {
    return { tipo: "transitorio", detalhe: `${resposta.status}: plataforma indisponível` };
  }
  const texto = await resposta.text().catch(() => "");
  let json: { code?: unknown; message?: unknown } | null = null;
  try {
    json = JSON.parse(texto) as { code?: unknown; message?: unknown };
  } catch {
    json = null;
  }
  if (!json || typeof json.code !== "number") {
    return {
      tipo: resposta.ok ? "transitorio" : "permanente",
      detalhe: `${resposta.status}: ${texto.slice(0, 400) || "resposta inesperada"}`,
    };
  }
  if (json.code === 0) return { tipo: "ok" };
  const mensagem = typeof json.message === "string" ? json.message.slice(0, 400) : "recusado";
  logger.warn("[conversoes.tiktok] envio recusado", { codigo: json.code });
  return classificaCodigo(json.code, mensagem);
}

async function enviar(
  credencial: CredencialDeConversao,
  conversao: ConversaoOffline,
): Promise<ResultadoDeEnvio> {
  const nome = nomeNoFio(
    "tiktok",
    credencial.mapeamento,
    conversao.evento,
    conversao.eventoNaPlataforma,
  );
  if (!nome) {
    return {
      tipo: "permanente",
      detalhe: "Este evento está desligado nas regras de conversão do TikTok.",
    };
  }
  const idadeMs = Date.now() - conversao.ocorridoEm.getTime();
  if (idadeMs > IDADE_MAXIMA_MS) {
    const dias = Math.floor(idadeMs / (24 * 60 * 60 * 1000));
    return {
      tipo: "permanente",
      detalhe:
        `evento com ${dias} dias — o TikTok não atribui acima de 7. ` +
        `Ele aconteceu em ${conversao.ocorridoEm.toISOString()} e não pode mais ser reportado.`,
    };
  }
  const usuario = montarUsuario(conversao);
  if (!usuario.ttclid && !usuario.phone && !usuario.email) {
    return {
      tipo: "permanente",
      detalhe:
        "Sem o clique do anúncio, sem telefone e sem e-mail no contato, o TikTok não tem como reconhecer o cliente.",
    };
  }

  const propriedades: Record<string, unknown> = {};
  if (conversao.valorCentavos !== null) {
    propriedades.value = conversao.valorCentavos / 100;
    propriedades.currency = conversao.moeda.toUpperCase();
  }
  const corpo: Record<string, unknown> = {
    event_source: "web",
    event_source_id: credencial.datasetId,
    data: [
      {
        event: nome,
        // Segundos, como a Meta. Em ms o evento cai no futuro distante.
        event_time: Math.floor(conversao.ocorridoEm.getTime() / 1000),
        event_id: conversao.eventoId,
        user: usuario,
        ...(Object.keys(propriedades).length > 0 ? { properties: propriedades } : {}),
      },
    ],
  };
  if (credencial.testEventCode) corpo.test_event_code = credencial.testEventCode;
  return postar(credencial, corpo);
}

/**
 * Um evento SEMPRE marcado como teste — com o código da organização ou, sem
 * ele, um código fixo: o TikTok o mostra em "Testar eventos" e não o usa na
 * atribuição. É a única forma de provar o token e o pixel juntos sem uma
 * conversão real.
 */
async function testarConexao(credencial: CredencialDeConversao): Promise<ResultadoDeEnvio> {
  const corpo = {
    event_source: "web",
    event_source_id: credencial.datasetId,
    test_event_code: credencial.testEventCode || CODIGO_DE_TESTE_PADRAO,
    data: [
      {
        event: "ViewContent",
        event_time: Math.floor(Date.now() / 1000),
        event_id: `teste-de-conexao:${Date.now()}`,
        user: { external_id: sha256("teste-de-conexao") },
      },
    ],
  };
  return postar(credencial, corpo);
}

export const transporteTiktok: TransporteDeConversao = {
  plataforma: "tiktok",
  enviar,
  testarConexao,
};

/** Exportados para o teste vigiar as regras sem falar com a rede. */
export const INTERNOS = { IDADE_MAXIMA_MS, ENDERECO, classificaCodigo } as const;
