// lib/propostas/link-publico.ts
//
// O LINK PÚBLICO DA PROPOSTA (`/o/<token>`, migration 9480).
//
// O token é a autoridade inteira: quem o tem vê o orçamento e decide. Por isso
// ele tem 32 bytes aleatórios (256 bits, base64url = 43 caracteres) e o banco
// guarda SÓ o SHA-256 dele — o mesmo desenho do convite de equipe e do bearer
// `dsk_`: um vazamento do banco não entrega link nenhum. O token em claro existe
// em dois lugares só: na mensagem que vai ao cliente e na resposta de quem o
// acabou de gerar ("Copiar link").
//
// TODA escrita aqui usa o cliente de serviço e filtra `organization_id`: a
// tabela não tem GRANT de escrita para a sessão.
import { createHash, randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/** 32 bytes em base64url, sem preenchimento. */
export const FORMATO_DO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenTemFormato(token: string): boolean {
  return FORMATO_DO_TOKEN.test(token);
}

/** `https://crm.exemplo.com/o/<token>` — sem barra dobrada quando a base termina em `/`. */
export function urlDoLink(base: string, token: string): string {
  return `${base.trim().replace(/\/+$/, "")}/o/${token}`;
}

const VALIDADE_SEM_DATA_DIAS = 30;

/**
 * Até quando o link vale. `valid_until` é DATA no fuso da organização; o
 * instante gravado é um teto folgado — o dia SEGUINTE à validade, às 14h UTC,
 * que já passou do fim do dia em qualquer fuso (UTC-12 a UTC+14). Quem fecha
 * no dia exato é a página, que confere a validade no fuso da organização.
 * Sem validade, o link vale 30 dias.
 */
export function expiraEmDoLink(validUntil: string | null, agora: Date = new Date()): string {
  if (validUntil && /^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
    const dia = new Date(`${validUntil}T14:00:00.000Z`);
    dia.setUTCDate(dia.getUTCDate() + 1);
    return dia.toISOString();
  }
  return new Date(agora.getTime() + VALIDADE_SEM_DATA_DIAS * 24 * 60 * 60 * 1000).toISOString();
}

export interface LinkCriado {
  id: string;
  token: string;
  expiraEm: string;
}

/** Cria um link novo. Lança em falha de banco — quem chama decide se é best-effort. */
export async function criarLinkDaProposta(
  admin: SupabaseClient,
  input: { orgId: string; propostaId: string; validUntil: string | null; criadoPor: string | null },
): Promise<LinkCriado> {
  const token = gerarToken();
  const expiraEm = expiraEmDoLink(input.validUntil);
  const { data, error } = await admin
    .from("crm_proposal_links")
    .insert({
      organization_id: input.orgId,
      proposal_id: input.propostaId,
      token_hash: hashDoToken(token),
      expira_em: expiraEm,
      criado_por: input.criadoPor,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`proposta_link_falhou: ${error?.message ?? "sem_linha"}`);
  return { id: (data as { id: string }).id, token, expiraEm };
}

/** Revoga UM link (o envio que falhou não deixa link vivo para um rascunho). */
export async function revogarLink(admin: SupabaseClient, orgId: string, linkId: string): Promise<void> {
  await admin
    .from("crm_proposal_links")
    .update({ revogado_em: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", linkId)
    .is("revogado_em", null);
}

/**
 * O QUE A PÁGINA PÚBLICA MOSTRA. `aberta` é o único estado com botões; todo o
 * resto mostra o orçamento (quando ainda faz sentido) e diz por que não há
 * decisão a tomar.
 */
export type EstadoDoLink =
  | "aberta"
  | "aceita"
  | "recusada"
  | "vencida"
  | "revogada"
  | "substituida"
  | "cancelada"
  | "indisponivel";

export interface EntradaDoEstado {
  link: { expira_em: string; revogado_em: string | null };
  proposta: { status: string; valid_until: string | null };
  /** "Hoje" no fuso da organização, `AAAA-MM-DD`. */
  hojeNoFuso: string;
  agora: Date;
}

/**
 * Regra pura. A ordem importa: o que a proposta JÁ é (decidida, substituída,
 * cancelada) vence o estado do link — quem aceitou ontem e abre o link hoje,
 * depois de vencido, precisa ler "aceita", não "vencido".
 */
export function estadoDoLink(e: EntradaDoEstado): EstadoDoLink {
  const status = e.proposta.status;
  if (status === "aceita") return "aceita";
  if (status === "recusada") return "recusada";
  if (status === "substituida") return "substituida";
  if (status === "cancelada") return "cancelada";
  if (e.link.revogado_em) return "revogada";
  if (status === "vencida") return "vencida";
  if (new Date(e.link.expira_em).getTime() <= e.agora.getTime()) return "vencida";
  if (e.proposta.valid_until && e.hojeNoFuso > e.proposta.valid_until) return "vencida";
  if (status === "enviada") return "aberta";
  // rascunho / enviando: o link existe mas a proposta não saiu (envio falhou).
  return "indisponivel";
}
