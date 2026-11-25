/**
 * Configurações → Perfis de tela (item 5.6, migration 9497).
 *
 * Quem administra cria perfis ("Vendas", "Recepção") com as áreas do menu que
 * cada um mostra, e atribui a membros. Sem perfil = tudo que o papel permite.
 *
 * `admin`, sem atalho de platform admin: as rotas que gravam cobram `admin` pelo
 * papel NESTA organização, e a tela não pode mostrar botões que voltariam 403.
 */
import { redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DO_PERFIL, MAXIMO_DE_PERFIS, type PerfilDeTela } from "@/lib/navigation/perfis-de-tela";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { PainelDePerfis, type MembroDoPainel } from "./_painel";

export const metadata = { title: "Perfis de tela" };
export const dynamic = "force-dynamic";

export default async function PerfisDeTelaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (activeOrg.role !== "admin") redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const supabase = await createClient();
  const [perfis, vinculos] = await Promise.all([
    supabase
      .from("perfis_de_tela")
      .select(COLUNAS_DO_PERFIL)
      .eq("organization_id", activeOrg.orgId)
      .order("nome", { ascending: true })
      .limit(MAXIMO_DE_PERFIS),
    supabase
      .from("user_organizations")
      .select("user_id, role, perfil_de_tela_id")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null)
      .not("accepted_at", "is", null)
      .order("created_at", { ascending: true }),
  ]);

  const linhas = (vinculos.data ?? []) as Array<{ user_id: string; role: string; perfil_de_tela_id: string | null }>;
  // Nome e e-mail vêm do Auth, como na lista da Equipe. Sem service role, a
  // tela segue com o id — degradar o rótulo é melhor que esconder o membro.
  const admin = isServiceRoleConfigured() ? createAdminClient() : null;
  const membros: MembroDoPainel[] = await Promise.all(
    linhas.map(async (m) => {
      const u = admin ? (await admin.auth.admin.getUserById(m.user_id)).data?.user : null;
      return {
        user_id: m.user_id,
        role: m.role,
        perfil_de_tela_id: m.perfil_de_tela_id,
        nome: (u?.user_metadata?.full_name as string | undefined) || u?.email || m.user_id.slice(0, 8),
      };
    }),
  );

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela titulo={t("Perfis de tela")} idioma={idioma} tituloClassName="text-xl font-semibold tracking-tight">
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "Escolha quais áreas do menu cada pessoa vê. O perfil só esconde do menu, do índice e da busca: quem tiver o papel ainda abre a tela pelo endereço. O que cada um pode fazer continua sendo decidido pelo papel.",
          )}
        </p>
      </CabecalhoDaSubTela>

      {perfis.error || vinculos.error ? (
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível carregar os perfis agora. Recarregue a página.")}
        </p>
      ) : (
        <PainelDePerfis
          idioma={idioma}
          iniciais={(perfis.data ?? []) as PerfilDeTela[]}
          membros={membros}
          euId={user.id}
        />
      )}
    </div>
  );
}
