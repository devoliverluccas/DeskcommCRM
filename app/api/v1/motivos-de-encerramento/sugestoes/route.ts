import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/motivos-de-encerramento/sugestoes — o botão "Usar sugestões".
 *
 * Cria os cinco motivos sugeridos (`SUGESTOES_DE_MOTIVO`) SÓ quando a lista da
 * organização está vazia. Os motivos NÃO nascem no baseline para todos: quem
 * nunca abriu a tela continua sem nenhum, e quem já montou a própria lista não
 * recebe cinco linhas a mais por um clique repetido (409 `lista_nao_vazia`).
 * Repetir o clique é inofensivo por isso — a segunda chamada encontra a lista
 * cheia.
 */
import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  COLUNAS_DO_MOTIVO,
  SUGESTOES_DE_MOTIVO,
  ordenarMotivos,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "motivos_de_encerramento" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org, user } = authz;

  const admin = createAdminClient();
  const { count, error: erroDaContagem } = await admin
    .from("motivos_de_encerramento")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId);
  if (erroDaContagem) return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  if ((count ?? 0) > 0) {
    return fail("lista_nao_vazia", t("A lista de motivos já tem itens."), 409, { requestId });
  }

  // Os nomes vão no idioma de quem clicou: é a equipe dele que vai ler a lista.
  const linhas = SUGESTOES_DE_MOTIVO.map((s, ordem) => ({
    organization_id: org.orgId,
    nome: t(s.nome),
    categoria: s.categoria,
    ordem,
  }));
  const { data, error } = await admin
    .from("motivos_de_encerramento")
    .insert(linhas)
    .select(COLUNAS_DO_MOTIVO);
  if (error) {
    // 23505: dois cliques simultâneos — o outro já criou a lista.
    if (error.code === "23505") {
      return fail("lista_nao_vazia", t("A lista de motivos já tem itens."), 409, { requestId });
    }
    return fail("internal_error", t("Não consegui salvar agora."), 500, { requestId });
  }
  const motivos = ordenarMotivos((data ?? []) as MotivoDeEncerramento[]);

  for (const motivo of motivos) {
    await audit({
      action: "motivo_de_encerramento.criado",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "motivo_de_encerramento",
      resourceId: motivo.id,
      requestId,
      metadata: { nome: motivo.nome, categoria: motivo.categoria, sugestao: true },
    });
  }

  return ok({ motivos }, { requestId, status: 201 });
}
