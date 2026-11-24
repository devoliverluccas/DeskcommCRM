/**
 * GET /api/v1/links-de-saida — os links curtos de saída da organização, com os
 * cliques de gente (robô de prévia fora), para a tela de Configurações (fase 4,
 * item 4.4, migration 9490).
 *
 * `manager`: a lista diz QUEM abriu QUAL link — comportamento de contato, ao
 * lado das outras telas de marketing da organização. Só leitura: o link nasce
 * no envio (`sendMessageHandler`), nunca por aqui.
 *
 * A função do banco é só `service_role`; a organização vem da sessão.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { lerResumoDosLinks } from "@/lib/plataformas-de-anuncio/rastreio/resumo-dos-links-de-saida";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "links_de_saida" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  try {
    const links = await lerResumoDosLinks(createAdminClient(), authz.org.orgId);
    return ok({ links }, { requestId });
  } catch {
    return fail("internal_error", t("Não foi possível carregar os links agora."), 500, { requestId });
  }
}
