/**
 * As plataformas de ANÁLISE (GA4 e TikTok) no livro-razão — regras puras.
 *
 * ─── Por que uma chave própria em `event_name` ──────────────────────────────
 *
 * O índice único de `ad_conversion_dispatches` é
 * `(organization_id, lead_id, event_name)` — SEM a plataforma. Ele é a
 * idempotência do envio principal (Meta/Google): `lerRegistro` faz
 * `.maybeSingle()` por evento, e as RPCs de reenvio e do `LeadSubmitted`
 * causal fazem `on conflict (organization_id, lead_id, event_name)`.
 *
 * Gravar a venda do GA4 como `Purchase` colidiria com a venda da Meta do mesmo
 * negócio — uma sobrescreveria a outra, e o `sent` de uma faria a outra achar
 * que já foi enviada. Trocar o índice para incluir a plataforma quebraria as
 * RPCs acima (o `on conflict` exige um índice que case) e deixaria o
 * `.maybeSingle()` do envio principal vendo duas linhas.
 *
 * Por isso cada plataforma de análise tem a SUA chave — `ga4:Purchase`,
 * `tiktok:LeadSubmitted` — e o mesmo índice dá uma linha por (negócio,
 * plataforma, evento), sem migration e sem tocar no envio principal. O
 * `event_id` que sai no fio continua `<lead>:<evento>`, o mesmo do principal:
 * é a deduplicação do lado de cada plataforma.
 */
import type { PlataformaComMapeamento } from "@/lib/plataformas-de-anuncio/mapeamento-de-eventos";

/** O que as plataformas de análise recebem: a venda ganha e o lead novo. */
export type EventoAnalitico = "Purchase" | "LeadSubmitted";

export type ChaveAnalitica = `${PlataformaComMapeamento}:${EventoAnalitico}`;

export const PLATAFORMAS_ANALITICAS: readonly PlataformaComMapeamento[] = ["ga4", "tiktok"];

export function chaveAnalitica(
  plataforma: PlataformaComMapeamento,
  evento: EventoAnalitico,
): ChaveAnalitica {
  return `${plataforma}:${evento}`;
}

/** Lê a chave de volta — `null` quando o `event_name` não é de análise. */
export function lerChaveAnalitica(
  eventName: string,
): { plataforma: PlataformaComMapeamento; evento: EventoAnalitico } | null {
  const m = /^(ga4|tiktok):(Purchase|LeadSubmitted)$/.exec(eventName);
  if (!m) return null;
  return {
    plataforma: m[1] as PlataformaComMapeamento,
    evento: m[2] as EventoAnalitico,
  };
}
