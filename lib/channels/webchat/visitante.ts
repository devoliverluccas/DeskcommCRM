/**
 * O visitante do chat do site: token, hash e identidade.
 *
 * O visitante não tem conta, telefone nem cookie nosso. O que o identifica é um
 * TOKEN aleatório que o servidor sorteia e o script guarda no `localStorage` do
 * domínio do cliente (nada de cookie de terceiro). O token vai em todo pedido
 * no cabeçalho `X-Webchat-Visitante` — nunca em query string.
 *
 * O banco NUNCA guarda o token cru: guarda o SHA-256 dele dentro de
 * `contacts.social_identity` (`webchat:<sessão>:<hash>`), no molde da 0368/9342.
 * Quem ler o banco não consegue se passar pelo visitante.
 */
import { createHash, randomBytes } from "node:crypto";

/** O cabeçalho que leva o token do visitante. Mesma grafia no script do site. */
export const CABECALHO_DO_VISITANTE = "x-webchat-visitante";

/** 32 bytes em base64url = 43 caracteres. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** A chave pública da conexão (o `data-chave` do snippet). Mesma forma do CHECK da 9494. */
const CHAVE = /^[A-Za-z0-9_-]{32,64}$/;

export function novoTokenDoVisitante(): string {
  return randomBytes(32).toString("base64url");
}

export function novaChavePublica(): string {
  return randomBytes(24).toString("base64url");
}

export function tokenDoVisitanteValido(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && TOKEN.test(valor);
}

export function chavePublicaValida(valor: string | null | undefined): valor is string {
  return typeof valor === "string" && CHAVE.test(valor);
}

export function hashDoVisitante(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A identidade do contato. A SESSÃO entra na chave: o mesmo navegador em dois
 * sites de duas empresas nunca vira o mesmo contato — e o token já é por
 * domínio, então isto é a segunda trava, não a primeira.
 */
export function identidadeDoVisitante(channelSessionId: string, token: string): string {
  return `webchat:${channelSessionId}:${hashDoVisitante(token)}`;
}
