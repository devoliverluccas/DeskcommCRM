/**
 * O ENCURTADOR DE SAÍDA — fase 4, item 4.4 (migration 9490).
 *
 * O irmão de `./links.ts`, na direção oposta: lá o link leva gente de FORA
 * para o WhatsApp da empresa (e o clique vira `[ref:]`); aqui o link sai NA
 * mensagem para um contato que já conhecemos, e o clique diz que ele abriu.
 *
 *   - `linkDeSaida`  — o link curto de (organização, contato, destino, rótulo):
 *     reusa o que já existe (idempotente), ou cria com um código novo.
 *   - `registrarClique` — o que a rota pública `/l/<codigo>` grava.
 *
 * TODA escrita aqui usa o service role, e a organização vem de fonte confiável:
 * do contexto do envio (`sendMessageHandler`) ou da LINHA do link (rota
 * pública). Nunca do corpo, nunca da URL.
 *
 * LGPD: o IP cru não é gravado — só 16 hex do SHA-256 dele com o id da
 * organização, que distingue "o mesmo aparelho" dentro da organização e não
 * volta ao IP. O user agent vira duas palavras (dispositivo e navegador).
 */
import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

/** Igual ao CHECK `links_de_saida_codigo_formato`. */
export const FORMATO_DO_CODIGO = /^[A-Za-z0-9]{10}$/;
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 10 caracteres base62 (~59 bits), sem viés de módulo (rejeição). */
export function gerarCodigo(): string {
  let codigo = "";
  while (codigo.length < 10) {
    for (const byte of randomBytes(16)) {
      // 248 = 62 × 4: acima disso o módulo favoreceria os primeiros símbolos.
      if (byte < 248 && codigo.length < 10) codigo += ALFABETO[byte % 62];
    }
  }
  return codigo;
}

/** `https://crm.exemplo.com/l/<codigo>` — sem barra dobrada quando a base termina em `/`. */
export function urlCurta(base: string, codigo: string): string {
  return `${base.trim().replace(/\/+$/, "")}/l/${codigo}`;
}

export interface PedidoDeLink {
  organizationId: string;
  /** `null` = conversa sem contato conhecido (grupo): não há o que encurtar. */
  contactId: string;
  destino: string;
  rotulo: string | null;
}

export interface LinkCurto {
  id: string;
  codigo: string;
}

async function existente(admin: SupabaseClient, p: PedidoDeLink): Promise<LinkCurto | null> {
  let q = admin
    .from("links_de_saida")
    .select("id, codigo")
    .eq("organization_id", p.organizationId)
    .eq("contact_id", p.contactId)
    .eq("destino_url", p.destino);
  q = p.rotulo === null ? q.is("rotulo", null) : q.eq("rotulo", p.rotulo);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LinkCurto | null) ?? null;
}

/**
 * O link curto deste (contato, destino, rótulo) — o mesmo a cada envio.
 *
 * Idempotente pelo índice único parcial da migration: dois envios simultâneos
 * que tentam criar o mesmo link recebem 23505 no perdedor, que relê e usa o do
 * vencedor. 23505 SEM linha existente é colisão de código: tenta outro.
 * `null` quando não foi possível — quem chama manda a URL original, sem
 * rastreio, em vez de travar a mensagem.
 */
export async function linkDeSaida(admin: SupabaseClient, p: PedidoDeLink): Promise<LinkCurto | null> {
  try {
    const ja = await existente(admin, p);
    if (ja) return ja;
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      const { data, error } = await admin
        .from("links_de_saida")
        .insert({
          organization_id: p.organizationId,
          contact_id: p.contactId,
          destino_url: p.destino,
          rotulo: p.rotulo,
          codigo: gerarCodigo(),
        })
        .select("id, codigo")
        .single();
      if (!error && data) return data as LinkCurto;
      if (error?.code !== "23505") throw new Error(error?.message ?? "insert sem linha");
      const corrida = await existente(admin, p);
      if (corrida) return corrida;
    }
    throw new Error("três colisões de código seguidas");
  } catch (erro) {
    logger.error("[links-de-saida] link não criado; a URL sai sem rastreio", {
      organizationId: p.organizationId,
      motivo: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
}

export type Dispositivo = "celular" | "computador" | "robo" | "desconhecido";

/**
 * Robô de prévia: o WhatsApp (e o Telegram, o Facebook…) abre o link para
 * montar a miniatura ASSIM que a mensagem chega. Contar isso como clique diria
 * que todo contato clicou.
 */
const ROBOS: ReadonlyArray<[RegExp, string]> = [
  [/^WhatsApp\//i, "WhatsApp"],
  [/facebookexternalhit|facebot|meta-externalagent/i, "Facebook"],
  [/TelegramBot/i, "Telegram"],
  [/Slackbot/i, "Slack"],
  [/Discordbot/i, "Discord"],
  [/LinkedInBot/i, "LinkedIn"],
  [/Twitterbot/i, "X"],
  [/SkypeUriPreview/i, "Skype"],
  [/Googlebot|GoogleOther|Google-InspectionTool/i, "Google"],
  [/bingbot|BingPreview/i, "Bing"],
  // `\bbot\b`, e não `bot`: "CUBOT" é marca de celular Android.
  [/HeadlessChrome|\bbot\b|crawler|spider|preview|curl\/|wget\//i, "Robô"],
];

const NAVEGADORES: ReadonlyArray<[RegExp, string]> = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/FBAN|FBAV|Instagram/, "App da Meta"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/FxiOS\/|Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
];

/** O user agent em duas palavras — nada além disso é gravado. */
export function resumirUserAgent(ua: string | null | undefined): {
  dispositivo: Dispositivo;
  navegador: string | null;
} {
  const texto = (ua ?? "").slice(0, 512);
  if (texto.trim() === "") return { dispositivo: "desconhecido", navegador: null };
  for (const [padrao, nome] of ROBOS) {
    if (padrao.test(texto)) return { dispositivo: "robo", navegador: nome };
  }
  const dispositivo: Dispositivo = /Mobi|Android|iPhone|iPad|iPod/i.test(texto) ? "celular" : "computador";
  const navegador = NAVEGADORES.find(([padrao]) => padrao.test(texto))?.[1] ?? null;
  return { dispositivo, navegador };
}

/** 16 hex do SHA-256 de (organização + IP). `null` sem IP. */
export function hashDoIp(ip: string | null | undefined, organizationId: string): string | null {
  const limpo = (ip ?? "").trim();
  if (limpo === "") return null;
  return createHash("sha256").update(`${organizationId}|${limpo}`, "utf8").digest("hex").slice(0, 16);
}

export interface LinkParaRedirecionar {
  id: string;
  organization_id: string;
  destino_url: string;
}

/** O link ativo pelo código — `null` para código malformado, inexistente ou anonimizado. */
export async function linkPeloCodigo(
  admin: SupabaseClient,
  codigo: string,
): Promise<LinkParaRedirecionar | null> {
  if (!FORMATO_DO_CODIGO.test(codigo)) return null;
  const { data, error } = await admin
    .from("links_de_saida")
    .select("id, organization_id, destino_url")
    .eq("codigo", codigo)
    .eq("anonimizado", false)
    .maybeSingle();
  if (error || !data) return null;
  return data as LinkParaRedirecionar;
}

/**
 * Grava o clique (e, se foi gente, o fato `link.clicked`) — pela função do
 * banco, uma escrita só. Falha aqui NUNCA impede o redirecionamento: quem
 * clicou chega ao destino de qualquer jeito, e só a contagem perde um.
 */
export async function registrarClique(
  admin: SupabaseClient,
  link: Pick<LinkParaRedirecionar, "id" | "organization_id">,
  origem: { userAgent: string | null; ip: string | null },
): Promise<void> {
  const { dispositivo, navegador } = resumirUserAgent(origem.userAgent);
  const { error } = await admin.rpc("fn_registrar_clique_de_saida", {
    p_org: link.organization_id,
    p_link: link.id,
    p_dispositivo: dispositivo,
    p_navegador: navegador,
    p_ip_hash: hashDoIp(origem.ip, link.organization_id),
  });
  if (error) {
    logger.error("[links-de-saida] clique não registrado", {
      organizationId: link.organization_id,
      linkId: link.id,
      motivo: error.message,
    });
  }
}
