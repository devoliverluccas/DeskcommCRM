/**
 * GET /api/v1/pontuacao/extrato?contact_id=<uuid> — os PONTOS de um contato:
 * o total e as linhas mais recentes que o explicam (fase 4, item 4.5).
 *
 * Quem lê é a ficha do negócio, ao lado do score. `viewer` basta: é leitura de
 * algo que a pessoa já enxerga pela RLS (o extrato é da organização, e a sessão
 * tem SELECT nele). Vai pela SESSÃO, nunca pelo service role — a RLS isola, e o
 * filtro explícito de organização diz qual das organizações do usuário.
 *
 * O total vem de `fn_pontuacao_do_contato` (soma do extrato, `security
 * invoker`): é calculado, nunca coluna, então a lista e o número não divergem.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DO_EXTRATO, type LinhaDoExtrato } from "@/lib/leads/pontuacao-por-regra";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Quantas linhas a ficha mostra. O total soma TODAS. */
const LINHAS_DO_EXTRATO = 30;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "pontuacao_extrato" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const contactId = req.nextUrl.searchParams.get("contact_id");
  if (!z.uuid().safeParse(contactId).success) {
    return fail("validation_failed", t("Dados inválidos."), 422, { requestId });
  }

  const supabase = await createClient();
  const [total, linhas] = await Promise.all([
    supabase.rpc("fn_pontuacao_do_contato", { p_org: authz.org.orgId, p_contato: contactId! }),
    supabase
      .from("pontuacao_extrato")
      .select(COLUNAS_DO_EXTRATO)
      .eq("organization_id", authz.org.orgId)
      .eq("contact_id", contactId!)
      .order("ocorrido_em", { ascending: false })
      .limit(LINHAS_DO_EXTRATO),
  ]);
  if (total.error) return fail("internal_error", total.error.message, 500, { requestId });
  if (linhas.error) return fail("internal_error", linhas.error.message, 500, { requestId });

  return ok(
    {
      total: typeof total.data === "number" ? total.data : 0,
      itens: (linhas.data ?? []) as unknown as LinhaDoExtrato[],
    },
    { requestId },
  );
}
