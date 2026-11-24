/**
 * Configurações → Feriados (fase 3, item 3.8, migration 9486).
 *
 * Os dias em que a empresa não atende. Feriado cadastrado aqui fecha o
 * expediente das jornadas dos atendentes e do horário das filas
 * (`isWithinSchedule`): a conversa que chega espera o próximo dia útil em vez de
 * ser distribuída para quem não está trabalhando. Os nacionais entram pelo botão
 * "Importar feriados nacionais" — sozinhos, não fecham nada.
 *
 * `manager`: as rotas que gravam (`/api/v1/feriados`) cobram `manager` NESTA
 * organização, e a tela não mostra botões que voltariam 403.
 */
import { redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

import { PainelDeFeriados, type FeriadoNaTela } from "./_painel";

export const metadata = { title: "Feriados" };
export const dynamic = "force-dynamic";

export default async function FeriadosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  // Pela SESSÃO: a RLS isola a organização; o filtro explícito diz qual.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feriados")
    .select("id, data, nome, recorrente_anual")
    .eq("organization_id", activeOrg.orgId)
    .order("data", { ascending: true });

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela titulo={t("Feriados")} idioma={idioma} tituloClassName="text-xl font-semibold tracking-tight">
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "Os dias em que a empresa não atende. Num feriado daqui, quem tem horário de atendimento fica fora do expediente e as conversas novas esperam o próximo dia útil.",
          )}
        </p>
      </CabecalhoDaSubTela>

      {error ? (
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível carregar os feriados agora. Recarregue a página.")}
        </p>
      ) : (
        <PainelDeFeriados
          idioma={idioma}
          iniciais={(data ?? []) as FeriadoNaTela[]}
          anoAtual={new Date().getFullYear()}
        />
      )}
    </div>
  );
}
