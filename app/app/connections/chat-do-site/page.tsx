/**
 * Conexões › Chat do site (fase 5, item 5.3, migration 9494).
 *
 * A bolha de conversa que a empresa cola no próprio site. Aqui se escolhe nome,
 * saudação, cor, posição e os domínios onde ela pode aparecer, e se copia o
 * código. As conversas chegam ao MESMO Inbox, com o canal identificado.
 *
 * `admin`, como Conexões: ligar um canal expõe a conta da empresa.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ChatDoSiteClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat do site" };

export default async function ChatDoSitePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-2">
      <header className="flex flex-col gap-1">
        <Link
          href="/app/connections"
          className="mb-1 flex min-h-11 w-fit items-center gap-1 text-sm text-text-muted underline underline-offset-4 hover:text-text lg:min-h-0"
        >
          <span aria-hidden="true">←</span>
          {t("Voltar para Conexões")}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{t("Chat do site")}</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          {t(
            "Uma bolha de conversa no site da empresa. Quem escreve por ela vira contato e a conversa chega ao Inbox, como as do WhatsApp — e o agente de IA responde, se estiver liberado neste canal.",
          )}
        </p>
      </header>
      <ChatDoSiteClient />
    </div>
  );
}
