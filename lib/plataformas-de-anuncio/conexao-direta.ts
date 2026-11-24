/**
 * A conexão de conversões do GA4 e do TikTok (9488) — leitura do estado para a
 * tela, schema de gravação para a rota e o teste de conexão. Uma peça só para
 * as duas plataformas porque o desenho é o mesmo: um identificador público
 * (measurement_id / pixel_code), um segredo cifrado (api_secret / token), o
 * interruptor e as regras de evento.
 *
 * ⚠️ ADMIN CLIENT, sempre com `organization_id` no filtro: a tabela tem RLS sem
 * policy (0213). O segredo NUNCA sai daqui — o estado leva só `temSegredo`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { FORMA_DO_MEASUREMENT_ID } from "./ga4/conversions";
import {
  lerMapeamento,
  schemaDoMapeamento,
  type PlataformaComMapeamento,
} from "./mapeamento-de-eventos";
import { FORMA_DO_PIXEL } from "./tiktok/conversions";
import type { MapeamentoDeEventos } from "./types";

export const NOME_DA_PLATAFORMA: Record<PlataformaComMapeamento, string> = {
  ga4: "Google Analytics 4",
  tiktok: "TikTok Ads",
};

export interface EnvioRecente {
  leadId: string;
  evento: string;
  status: string;
  motivo: string | null;
  detalhe: string | null;
  tentadoEm: string;
}

export interface EstadoDaConexaoDireta {
  plataforma: PlataformaComMapeamento;
  conectada: boolean;
  identificador: string | null;
  temSegredo: boolean;
  habilitada: boolean;
  testEventCode: string | null;
  mapeamento: MapeamentoDeEventos;
}

export async function lerEstadoDaConexaoDireta(
  admin: SupabaseClient,
  organizationId: string,
  plataforma: PlataformaComMapeamento,
): Promise<EstadoDaConexaoDireta> {
  const { data, error } = await admin
    .from("ad_platform_connections")
    .select("dataset_id, test_event_code, enabled, access_token_encrypted, event_mapping")
    .eq("organization_id", organizationId)
    .eq("platform", plataforma)
    .maybeSingle();
  // Erro de leitura LANÇA: "não conectado" seria mentira com cara de estado.
  if (error) throw new Error(`leitura da conexão falhou: ${error.message}`);
  const linha = data as {
    dataset_id: string | null;
    test_event_code: string | null;
    enabled: boolean;
    access_token_encrypted: string | null;
    event_mapping: unknown;
  } | null;
  return {
    plataforma,
    conectada: Boolean(linha),
    identificador: linha?.dataset_id ?? null,
    temSegredo: Boolean(linha?.access_token_encrypted),
    habilitada: linha?.enabled ?? false,
    testEventCode: plataforma === "tiktok" ? (linha?.test_event_code ?? null) : null,
    mapeamento: lerMapeamento(plataforma, linha?.event_mapping),
  };
}

/** Os últimos envios desta plataforma, do MESMO livro-razão das outras. */
export async function lerEnviosRecentes(
  admin: SupabaseClient,
  organizationId: string,
  plataforma: PlataformaComMapeamento,
  limite = 10,
): Promise<EnvioRecente[]> {
  const { data, error } = await admin
    .from("ad_conversion_dispatches")
    .select("lead_id, event_name, status, reason, detail, attempted_at")
    .eq("organization_id", organizationId)
    .eq("platform", plataforma)
    .order("attempted_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(`leitura dos envios falhou: ${error.message}`);
  return (
    (data ?? []) as Array<{
      lead_id: string;
      event_name: string;
      status: string;
      reason: string | null;
      detail: string | null;
      attempted_at: string;
    }>
  ).map((l) => ({
    leadId: l.lead_id,
    evento: l.event_name,
    status: l.status,
    motivo: l.reason,
    detalhe: l.detail,
    tentadoEm: l.attempted_at,
  }));
}

/**
 * O corpo do PUT. O segredo é OPCIONAL: vazio = "mantenha o gravado" (a tela
 * nunca o mostra de volta), nunca "apague" — mesmo contrato da Meta.
 */
export function schemaDaConexao(plataforma: PlataformaComMapeamento) {
  const identificador =
    plataforma === "ga4"
      ? z
          .string()
          .trim()
          .transform((v) => v.toUpperCase())
          .pipe(z.string().regex(FORMA_DO_MEASUREMENT_ID, "measurement_id"))
      : z
          .string()
          .trim()
          .transform((v) => v.toUpperCase())
          .pipe(z.string().regex(FORMA_DO_PIXEL, "pixel_code"));
  return z
    .object({
      identificador,
      segredo: z.string().trim().min(8).max(1000).optional(),
      test_event_code:
        plataforma === "tiktok" ? z.string().trim().max(64).nullable().optional() : z.null().optional(),
      enabled: z.boolean(),
      eventos: schemaDoMapeamento(plataforma),
    })
    .strict();
}

export type EntradaDaConexao = z.infer<ReturnType<typeof schemaDaConexao>>;
