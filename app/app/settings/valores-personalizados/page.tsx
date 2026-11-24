/**
 * Configurações → Valores personalizados (fase 4, item 4.6, migration 9491).
 *
 * O PIX, o endereço, o horário: textos da empresa que viram
 * `{{empresa.<chave>}}` em qualquer mensagem — resposta rápida, campanha,
 * automação, follow-up. Trocar aqui troca em todas, a partir do próximo envio.
 *
 * `manager`, sem atalho de platform admin: as rotas que gravam
 * (`/api/v1/valores-personalizados`) cobram `manager` pelo papel NESTA
 * organização, e a tela não pode mostrar botões que voltariam 403.
 */
import { redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import {
  COLUNAS_DO_VALOR,
  MAXIMO_DE_VALORES,
  ordenarValores,
  type ValorPersonalizado,
} from "@/lib/variaveis/valores-personalizados";

import { PainelDeValores } from "./_painel";

export const metadata = { title: "Valores personalizados" };
export const dynamic = "force-dynamic";

export default async function ValoresPersonalizadosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  // Pela SESSÃO: a RLS isola a organização; o filtro explícito diz qual.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("valores_personalizados")
    .select(COLUNAS_DO_VALOR)
    .eq("organization_id", activeOrg.orgId)
    .limit(MAXIMO_DE_VALORES);

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela
        titulo={t("Valores personalizados")}
        idioma={idioma}
        tituloClassName="text-xl font-semibold tracking-tight"
      >
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "Textos da empresa que se repetem nas mensagens — PIX, endereço, horário. Escreva {{empresa.chave}} numa resposta rápida, campanha ou automação, e o valor daqui entra na hora do envio.",
          )}
        </p>
      </CabecalhoDaSubTela>

      {error ? (
        // A falha NÃO vira lista vazia: "nenhum valor" convida a criar tudo de novo.
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível carregar os valores agora. Recarregue a página.")}
        </p>
      ) : (
        <PainelDeValores idioma={idioma} iniciais={ordenarValores((data ?? []) as ValorPersonalizado[])} />
      )}
    </div>
  );
}
