import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { fusoDoRelatorio } from "@/lib/relatorios/janela";
import { createClient } from "@/lib/supabase/server";

import { RelatoriosClient } from "./_components/RelatoriosClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatórios" };

/**
 * `/app/relatorios` (3.6): os números da operação num lugar só, por período e
 * em abas — Desempenho, Atendimentos, Satisfação, Origens e Atribuição.
 *
 * Piso de tela = o de Desempenho (qualquer membro; a RLS escopa o que o agent
 * vê). Satisfação e Atribuição só aparecem para quem gerencia, que é o piso
 * das rotas delas. O fuso é o da ORGANIZAÇÃO: é nele que "os últimos 7 dias"
 * começam e terminam, para todo mundo da empresa.
 */
export default async function RelatoriosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const podeGerenciar =
    (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;
  const t = (texto: string) => traduzir(texto, user.idioma);
  // Os funis do recorte dos ganhos da aba Desempenho (#4918), lidos como a tela
  // de Métricas lê: client de sessão, sem cortar arquivado.
  const supabase = await createClient();
  const { data: funisDaOrg } = await supabase
    .from("crm_pipelines")
    .select("id, name")
    .eq("organization_id", activeOrg.orgId)
    .order("position");
  const funis = (funisDaOrg ?? []) as Array<{ id: string; name: string }>;

  return (
    <div className="flex h-full flex-col gap-5 md:p-2">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t("Relatórios")}</h1>
        <p className="text-sm text-text-muted">
          {t("Desempenho, atendimentos, satisfação, origens e atribuição, no período que você escolher.")}
        </p>
      </header>
      <Suspense>
        <RelatoriosClient
          podeGerenciar={podeGerenciar}
          currentUserId={user.id}
          funis={funis}
          fuso={fusoDoRelatorio(activeOrg.timezone)}
        />
      </Suspense>
    </div>
  );
}
