/**
 * Configurações → Motivos de encerramento (fase 3, item 3.2).
 *
 * A lista de "por que este atendimento acabou" que a equipe escolhe ao fechar
 * uma conversa no Inbox, e o interruptor que torna a escolha obrigatória. Cada
 * motivo tem uma categoria — o desfecho que ele dá à demanda ainda aberta.
 *
 * `manager`, sem atalho de platform admin: as rotas que gravam
 * (`/api/v1/motivos-de-encerramento`) cobram `manager` pelo papel NESTA
 * organização, e a tela não pode mostrar botões que voltariam 403.
 */
import { redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import {
  COLUNAS_DO_MOTIVO,
  motivoObrigatorioAoEncerrar,
  ordenarMotivos,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

import { PainelDeMotivos } from "./_painel";

export const metadata = { title: "Motivos de encerramento" };
export const dynamic = "force-dynamic";

export default async function MotivosDeEncerramentoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  // Pela SESSÃO: a RLS isola a organização; o filtro explícito diz qual.
  const supabase = await createClient();
  const [motivos, org] = await Promise.all([
    supabase
      .from("motivos_de_encerramento")
      .select(COLUNAS_DO_MOTIVO)
      .eq("organization_id", activeOrg.orgId)
      .order("ordem", { ascending: true })
      .limit(200),
    supabase.from("organizations").select("settings").eq("id", activeOrg.orgId).maybeSingle(),
  ]);
  const falhou = Boolean(motivos.error || org.error);

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela
        titulo={t("Motivos de encerramento")}
        idioma={idioma}
        tituloClassName="text-xl font-semibold tracking-tight"
      >
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "O porquê de cada atendimento encerrado. A equipe escolhe o motivo ao fechar a conversa no Inbox, e a categoria dele vira o desfecho da demanda.",
          )}
        </p>
      </CabecalhoDaSubTela>

      {falhou ? (
        // A falha NÃO vira lista vazia: "nenhum motivo" convida a criar tudo de novo.
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível carregar os motivos agora. Recarregue a página.")}
        </p>
      ) : (
        <PainelDeMotivos
          idioma={idioma}
          motivosIniciais={ordenarMotivos((motivos.data ?? []) as MotivoDeEncerramento[])}
          exigidoInicial={motivoObrigatorioAoEncerrar(
            (org.data as { settings?: unknown } | null)?.settings,
          )}
        />
      )}
    </div>
  );
}
