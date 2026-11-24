/**
 * O PERÍODO DAS ROTAS DE `/api/v1/relatorios/*` (3.6) — um lugar só.
 *
 * As três abas da tela `/app/relatorios` mandam o MESMO par de dias civis
 * (`de`/`ate`, `YYYY-MM-DD`, `ate` inclusivo), e cada rota o resolve no fuso da
 * ORGANIZAÇÃO com `janelaDoRelatorio` — a mesma régua do relatório comercial:
 * duas pessoas da mesma empresa têm de ver o mesmo dia, olhe de onde olharem.
 */
import { z } from "zod";

import { dataNoFuso, janelaDoRelatorio, periodoPassaDoTeto, type JanelaDoRelatorio } from "@/lib/relatorios/janela";

const DIA = /^\d{4}-\d{2}-\d{2}$/;

const periodoSchema = z.object({
  de: z.string().regex(DIA).optional(),
  ate: z.string().regex(DIA).optional(),
});

/** Os 30 dias que terminam hoje, no fuso da organização. */
export function periodoDe30Dias(agora: Date, fuso: string): { de: string; ate: string } {
  const ate = dataNoFuso(agora, fuso);
  const inicio = new Date(`${ate}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - 29);
  return { de: inicio.toISOString().slice(0, 10), ate };
}

export type PeriodoLido =
  | { ok: true; janela: JanelaDoRelatorio }
  | { ok: false; motivo: "formato" | "invertido" | "teto" };

/**
 * Lê `de`/`ate` da URL. Ausentes = últimos 30 dias. Data impossível, `de`
 * depois de `ate` e período acima do teto da casa são RECUSADOS — nunca
 * corrigidos em silêncio.
 */
export function lerPeriodo(sp: URLSearchParams, fuso: string, agora = new Date()): PeriodoLido {
  const lido = periodoSchema.safeParse({
    de: sp.get("de") ?? undefined,
    ate: sp.get("ate") ?? undefined,
  });
  if (!lido.success) return { ok: false, motivo: "formato" };
  const padrao = periodoDe30Dias(agora, fuso);
  const de = lido.data.de ?? padrao.de;
  const ate = lido.data.ate ?? padrao.ate;
  if (Number.isNaN(Date.parse(`${de}T00:00:00Z`)) || Number.isNaN(Date.parse(`${ate}T00:00:00Z`))) {
    return { ok: false, motivo: "formato" };
  }
  if (de > ate) return { ok: false, motivo: "invertido" };
  if (periodoPassaDoTeto(de, ate)) return { ok: false, motivo: "teto" };
  return { ok: true, janela: janelaDoRelatorio(de, ate, fuso) };
}

/** O texto da recusa, para a rota passar por `traduzir`. */
export const MENSAGEM_DO_PERIODO: Record<"formato" | "invertido" | "teto", string> = {
  formato: "Período inválido.",
  invertido: "Janela inválida: 'from' deve ser anterior a 'to'.",
  teto: "O período não pode passar de 400 dias.",
};
