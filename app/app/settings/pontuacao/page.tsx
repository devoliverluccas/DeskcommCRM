/**
 * Configurações → Pontuação do lead (fase 4, item 4.5).
 *
 * As regras que dão PONTOS ao contato quando um fato acontece: respondeu o
 * follow-up, marcou agendamento, recebeu ou aceitou orçamento, chegou a uma
 * etapa, ganhou uma tag. O total e o extrato aparecem na ficha do negócio, ao
 * lado do score — que continua sendo a fórmula de probabilidade, sem mistura.
 *
 * `manager`, sem atalho de platform admin: as rotas que gravam
 * (`/api/v1/pontuacao/regras`) cobram `manager` pelo papel NESTA organização.
 */
import { redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DA_REGRA, ordenarRegras, type RegraDePontuacao } from "@/lib/leads/pontuacao-por-regra";
import { createClient } from "@/lib/supabase/server";

import { PainelDePontuacao, type EtapaParaRegra } from "./_painel";

export const metadata = { title: "Pontuação do lead" };
export const dynamic = "force-dynamic";

export default async function PontuacaoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  // Pela SESSÃO: a RLS isola a organização; o filtro explícito diz qual.
  const supabase = await createClient();
  const [regras, funis, etapas] = await Promise.all([
    supabase.from("regras_de_pontuacao").select(COLUNAS_DA_REGRA).eq("organization_id", activeOrg.orgId).limit(200),
    supabase
      .from("crm_pipelines")
      .select("id, name")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
    supabase
      .from("crm_stages")
      .select("id, name, pipeline_id, position")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
  ]);
  const falhou = Boolean(regras.error || funis.error || etapas.error);

  const nomeDoFunil = new Map(((funis.data ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]));
  const opcoesDeEtapa: EtapaParaRegra[] = ((etapas.data ?? []) as Array<{ id: string; name: string; pipeline_id: string }>)
    .filter((e) => nomeDoFunil.has(e.pipeline_id))
    .map((e) => ({ id: e.id, rotulo: `${nomeDoFunil.get(e.pipeline_id)} › ${e.name}` }));

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela
        titulo={t("Pontuação do lead")}
        idioma={idioma}
        tituloClassName="text-xl font-semibold tracking-tight"
      >
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "Cada regra dá pontos ao contato quando um fato acontece. O total aparece na ficha do negócio, ao lado do score, com o extrato que o explica. O score continua sendo a probabilidade de fechar: os pontos não entram nele.",
          )}
        </p>
      </CabecalhoDaSubTela>

      {falhou ? (
        // A falha NÃO vira lista vazia: "nenhuma regra" convida a criar tudo de novo.
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível carregar as regras agora. Recarregue a página.")}
        </p>
      ) : (
        <PainelDePontuacao
          idioma={idioma}
          regrasIniciais={ordenarRegras((regras.data ?? []) as unknown as RegraDePontuacao[])}
          etapas={opcoesDeEtapa}
        />
      )}
    </div>
  );
}
