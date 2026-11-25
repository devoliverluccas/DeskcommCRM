import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { ROLE_RANK } from "@/lib/auth/types";
import { AuditClient } from "./_client";
import { AcessosDaEmpresa } from "./_acessos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit Log" };

/**
 * Duas abas, um portão. "Acessos" segue o MESMO piso da auditoria (manager+):
 * quem já lê todas as mutações da empresa pode ler quem entrou nela. O que muda
 * por papel é o IP — inteiro só para quem administra, e isso a ROTA decide
 * (`lib/audit/consulta-de-acessos.ts`), não a tela.
 *
 * `?aba=acessos` abre direto na segunda aba (link de alerta, favorito).
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const idioma = user.idioma;
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    redirect("/403");
  }
  const t = (texto: string) => traduzir(texto, user.idioma);
  const { aba } = await searchParams;
  const abaInicial = aba === "acessos" ? "acessos" : "historico";

  return (
    <div className="flex h-full flex-col gap-5 p-2">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t("Audit Log")}</h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Histórico append-only de mutações na organização. Manager+.", idioma)}
        </p>
      </header>
      <Tabs defaultValue={abaInicial} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="historico">{t("Histórico")}</TabsTrigger>
          <TabsTrigger value="acessos">{t("Acessos")}</TabsTrigger>
        </TabsList>
        <TabsContent value="historico" className="mt-0">
          <AuditClient />
        </TabsContent>
        <TabsContent value="acessos" className="mt-0">
          <AcessosDaEmpresa />
        </TabsContent>
      </Tabs>
    </div>
  );
}
