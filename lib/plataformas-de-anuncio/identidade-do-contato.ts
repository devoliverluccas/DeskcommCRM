/**
 * A identidade do contato para GA4 e TikTok (9488): e-mail, `_ga` e `ttclid`.
 *
 * Quem despacha uma conversão para essas plataformas sem passar pela
 * atribuição (uma automação, por exemplo) chama isto e põe o resultado em
 * `ConversaoOffline.identidadeDoContato`. Lê só o que a chegada GRAVOU no
 * contato — nada é inventado:
 *
 *  - `source_metadata.ga_client_id` ou `source_metadata._ga` (o cookie inteiro,
 *    `GA1.1.n.n`): o `client_id` do GA4;
 *  - `source_metadata.ttclid`, ou o `ad_source_id` quando a atribuição gravada
 *    é do TikTok: o clique do anúncio;
 *  - `contacts.email`.
 *
 * ⚠️ FILTRA `organization_id` junto do id: o chamador usa o client
 * service-role, que bypassa RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { clientIdDoCookie } from "./ga4/conversions";
import type { IdentidadeDoContato } from "./types";

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Puro, para o teste julgar a regra sem banco. */
export function identidadeDaLinha(
  contatoId: string,
  linha: { email?: string | null; source_metadata?: unknown },
): IdentidadeDoContato {
  const meta =
    linha.source_metadata && typeof linha.source_metadata === "object"
      ? (linha.source_metadata as Record<string, unknown>)
      : {};
  const ttclid =
    texto(meta.ttclid) ?? (meta.ad_platform === "tiktok" ? texto(meta.ad_source_id) : null);
  return {
    contatoId,
    email: texto(linha.email),
    gaClientId: clientIdDoCookie(texto(meta.ga_client_id) ?? texto(meta._ga)),
    ttclid,
  };
}

/** `null` quando o contato não existe nesta organização. LANÇA em erro de leitura. */
export async function lerIdentidadeDoContato(
  admin: SupabaseClient,
  organizationId: string,
  contatoId: string,
): Promise<IdentidadeDoContato | null> {
  const { data, error } = await admin
    .from("contacts")
    .select("email, source_metadata")
    .eq("id", contatoId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`leitura da identidade do contato falhou: ${error.message}`);
  if (!data) return null;
  return identidadeDaLinha(contatoId, data as { email: string | null; source_metadata: unknown });
}
