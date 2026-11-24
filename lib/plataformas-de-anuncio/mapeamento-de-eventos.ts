/**
 * As regras de conversão do GA4 e do TikTok (9488): qual evento da casa vira
 * qual evento na plataforma — o schema CENTRAL da coluna
 * `ad_platform_connections.event_mapping` (anti-pattern 6: jsonb sem schema).
 *
 * Puro e sem dependência de servidor: a tela importa as mesmas listas que a
 * rota valida e que o transporte lê, para as três nunca divergirem.
 *
 * ─── Por que listas FECHADAS, e não texto livre ─────────────────────────────
 *
 * As duas plataformas aceitam nome de evento qualquer — e é esse o perigo: um
 * `Purchse` digitado vira evento personalizado, é aceito com 2xx e nunca conta
 * como compra. A lista é dos eventos RECOMENDADOS de cada uma (GA4: comércio e
 * geração de lead; TikTok: eventos padrão da Events API 1.3), que são os que o
 * otimizador e os relatórios reconhecem.
 */
import { z } from "zod";

import type { EventoMapeavel, MapeamentoDeEventos, PlataformaDeAnuncio } from "./types";

export type PlataformaComMapeamento = Extract<PlataformaDeAnuncio, "ga4" | "tiktok">;

export const EVENTOS_MAPEAVEIS: readonly EventoMapeavel[] = [
  "Purchase",
  "LeadSubmitted",
  "QualifiedLead",
] as const;

/** O que cada evento da casa PODE virar, por plataforma. O primeiro é o padrão. */
export const OPCOES_DE_EVENTO: Record<
  PlataformaComMapeamento,
  Record<EventoMapeavel, readonly string[]>
> = {
  ga4: {
    Purchase: ["purchase", "close_convert_lead"],
    LeadSubmitted: ["generate_lead"],
    QualifiedLead: ["qualify_lead", "working_lead"],
  },
  tiktok: {
    Purchase: ["CompletePayment", "PlaceAnOrder"],
    LeadSubmitted: ["SubmitForm", "Contact", "CompleteRegistration"],
    QualifiedLead: ["SubmitForm", "Contact", "CompleteRegistration"],
  },
};

export function ehPlataformaComMapeamento(p: unknown): p is PlataformaComMapeamento {
  return p === "ga4" || p === "tiktok";
}

/** O mapeamento de quem nunca escolheu: todo evento ligado, no nome recomendado. */
export function mapeamentoPadrao(plataforma: PlataformaComMapeamento): MapeamentoDeEventos {
  const opcoes = OPCOES_DE_EVENTO[plataforma];
  return {
    Purchase: opcoes.Purchase[0] ?? null,
    LeadSubmitted: opcoes.LeadSubmitted[0] ?? null,
    QualifiedLead: opcoes.QualifiedLead[0] ?? null,
  };
}

/** O schema de ESCRITA (rota): cada evento é uma opção da lista ou `null` (não enviar). */
export function schemaDoMapeamento(plataforma: PlataformaComMapeamento) {
  const opcoes = OPCOES_DE_EVENTO[plataforma];
  const campo = (lista: readonly string[]) =>
    z
      .string()
      .refine((v) => lista.includes(v), "evento fora da lista da plataforma")
      .nullable();
  return z
    .object({
      Purchase: campo(opcoes.Purchase),
      LeadSubmitted: campo(opcoes.LeadSubmitted),
      QualifiedLead: campo(opcoes.QualifiedLead),
    })
    .strict();
}

/**
 * A LEITURA (banco → código): tolerante. Chave ausente cai no padrão; valor
 * fora da lista (gravado por versão futura ou à mão) vira `null` — melhor não
 * enviar do que mandar um nome que a plataforma conta como outra coisa.
 */
export function lerMapeamento(
  plataforma: PlataformaComMapeamento,
  bruto: unknown,
): MapeamentoDeEventos {
  const padrao = mapeamentoPadrao(plataforma);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return padrao;
  const obj = bruto as Record<string, unknown>;
  const opcoes = OPCOES_DE_EVENTO[plataforma];
  const saida = { ...padrao };
  for (const evento of EVENTOS_MAPEAVEIS) {
    if (!(evento in obj)) continue;
    const v = obj[evento];
    saida[evento] = typeof v === "string" && opcoes[evento].includes(v) ? v : null;
  }
  return saida;
}

/**
 * O nome no fio para uma conversão. `eventoNaPlataforma` (quem chama já escolheu
 * o nome) vale quando é uma opção conhecida da plataforma; senão o evento da
 * casa passa pelo mapeamento. `null` = não há o que enviar.
 */
export function nomeNoFio(
  plataforma: PlataformaComMapeamento,
  mapeamento: MapeamentoDeEventos | undefined,
  evento: string,
  eventoNaPlataforma?: string | null,
): string | null {
  const conhecidos = new Set(Object.values(OPCOES_DE_EVENTO[plataforma]).flat());
  const escolhido = eventoNaPlataforma?.trim();
  if (escolhido && conhecidos.has(escolhido)) return escolhido;
  const m = mapeamento ?? mapeamentoPadrao(plataforma);
  if (evento === "Purchase" || evento === "LeadSubmitted" || evento === "QualifiedLead") {
    return m[evento];
  }
  return null;
}
