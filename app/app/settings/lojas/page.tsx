/**
 * Configurações › Lojas e filiais (item 5.4, módulo de tabela `lojas`).
 *
 * Só existe com o módulo INSTALADO nesta instalação (`/admin/modulos`); sem
 * ele, 404 — a porta do menu também some (`lib/navigation/catalogo.ts`). Com o
 * módulo, a empresa liga o uso aqui (`settings.lojas.enabled`) e cadastra as
 * lojas, a padrão e a loja de cada número.
 *
 * `admin`, o mesmo piso das rotas que gravam (`/api/v1/lojas/**`).
 */
import { notFound, redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { lojasHabilitadas, moduloDeLojasInstalado } from "@/lib/lojas/modulo";
import { COLUNAS_DA_LOJA, ordenarLojas, type Loja } from "@/lib/lojas/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

import { PainelDeLojas } from "./_painel";

export const metadata = { title: "Lojas e filiais" };
export const dynamic = "force-dynamic";

export default async function LojasPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");

  const admin = createAdminClient();
  if (!(await moduloDeLojasInstalado(admin, activeOrg.orgId))) notFound();

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const { data: org, error: erroDaOrg } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  const ligado = lojasHabilitadas((org as { settings?: unknown } | null)?.settings);

  let lojas: Loja[] = [];
  let falhou = Boolean(erroDaOrg);
  if (ligado) {
    const { data, error } = await admin
      .from("lojas")
      .select(COLUNAS_DA_LOJA)
      .eq("organization_id", activeOrg.orgId)
      .limit(500);
    if (error) falhou = true;
    lojas = ordenarLojas((data ?? []) as Loja[]);
  }

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela titulo={t("Lojas e filiais")} idioma={idioma} tituloClassName="text-xl font-semibold tracking-tight">
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t("As lojas da empresa, a loja padrão e qual loja atende cada número. O estoque de cada loja fica na edição do produto.")}
        </p>
      </CabecalhoDaSubTela>

      {falhou ? (
        // A falha NÃO vira lista vazia: "nenhuma loja" convida a cadastrar tudo de novo.
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não consegui carregar as lojas.")}
        </p>
      ) : (
        // `key`: ligar recarrega a página (router.refresh) e traz as lojas; o painel
        // remonta com elas em vez de guardar a lista vazia de quando estava desligado.
        <PainelDeLojas key={String(ligado)} idioma={idioma} ligadoInicial={ligado} lojasIniciais={lojas} />
      )}
    </div>
  );
}
