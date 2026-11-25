/**
 * LOJAS E FILIAIS — as duas decisões (item 5.4).
 *
 * `lojas` é módulo de TABELA (ADR-0002): a instalação o provisiona em
 * `/admin/modulos` (as quatro tabelas nascem em `fn_lojas_provisionar`). A
 * EMPRESA ainda decide se usa, em Configurações › Lojas, pela chave
 * `settings.lojas.enabled` (`fn_lojas_configurar`) — o desenho de `cadencias`.
 *
 * A capacidade da organização (`lib/organizacao/capacidades.ts`) soma as duas.
 * Este arquivo é a mesma conta para quem tem só o cliente de serviço e uma
 * organização (rotas e telas), sem ler capacidade nenhuma além desta.
 *
 * Nunca lança: erro de banco = desligado. Sem o módulo NADA aparece — tela,
 * coluna, filtro e rota respondem como se o recurso não existisse.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moduloLigado } from "@/lib/instalacao/modulos";

export function lojasHabilitadas(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
  const valor = (settings as { lojas?: unknown }).lojas;
  return (
    !!valor &&
    typeof valor === "object" &&
    !Array.isArray(valor) &&
    (valor as { enabled?: unknown }).enabled === true
  );
}

/** Módulo instalado nesta instalação. Sem memo: tela e rota leem o banco a cada vez. */
export async function moduloDeLojasInstalado(db: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    return await moduloLigado(db, "lojas", orgId);
  } catch {
    return false;
  }
}

/** Módulo instalado E ligado por esta empresa. */
export async function lojasLigadas(db: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    if (!(await moduloDeLojasInstalado(db, orgId))) return false;
    const { data, error } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    return !error && lojasHabilitadas((data as { settings?: unknown } | null)?.settings);
  } catch {
    return false;
  }
}
