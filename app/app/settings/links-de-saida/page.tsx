/**
 * Configurações → Links de saída (fase 4, item 4.4, migration 9490).
 *
 * Quem abriu o link que a empresa mandou. Todo `{{link:https://…}}` numa
 * resposta rápida, campanha, automação ou mensagem do atendente sai trocado por
 * uma URL curta do próprio CRM, uma por contato; aqui está o que cada uma rendeu
 * — por rótulo (a campanha do `{{link:…|rótulo}}`), por contato e link a link.
 *
 * Só leitura, e só servidor: a tela não tem interação que justifique JavaScript
 * no navegador. `manager`, como a rota (`/api/v1/links-de-saida`): a lista diz
 * quem abriu o quê. A leitura passa pela função do banco (service role), com a
 * organização da sessão.
 */
import { redirect } from "next/navigation";

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  lerResumoDosLinks,
  porContato,
  porRotulo,
  type GrupoDeLinks,
  type LinkDeSaidaResumo,
} from "@/lib/plataformas-de-anuncio/rastreio/resumo-dos-links-de-saida";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Links de saída" };
export const dynamic = "force-dynamic";

function quando(iso: string | null, idioma: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(idioma, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** O destino sem o esquema — o que a pessoa reconhece. */
function destinoLegivel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

function TabelaDeGrupos({
  titulo,
  id,
  grupos,
  rotuloDoSem,
  t,
}: {
  titulo: string;
  id: string;
  grupos: GrupoDeLinks[];
  rotuloDoSem: string;
  t: (texto: string) => string;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2" aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold">
        {titulo}
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-subtle">
            <th scope="col" className="py-1.5 pr-3 font-normal">{titulo}</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">{t("Links")}</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-normal">{t("Abertos")}</th>
            <th scope="col" className="py-1.5 text-right font-normal">{t("Cliques")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {grupos.slice(0, 20).map((g) => (
            <tr key={g.chave ?? "sem"} className="h-10">
              <td className={g.chave === null ? "max-w-0 truncate pr-3 text-text-muted" : "max-w-0 truncate pr-3"}>
                {g.chave === null ? rotuloDoSem : (g.nome ?? t("Contato sem nome"))}
              </td>
              <td className="pr-3 text-right tabular-nums text-text-muted">{g.links}</td>
              <td className="pr-3 text-right tabular-nums text-text-muted">{g.abertos}</td>
              <td className="text-right font-medium tabular-nums">{g.cliques}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function LinksDeSaidaPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  let links: LinkDeSaidaResumo[] | null = null;
  try {
    links = await lerResumoDosLinks(createAdminClient(), activeOrg.orgId);
  } catch {
    links = null;
  }

  const totalDeCliques = links?.reduce((soma, l) => soma + l.cliques, 0) ?? 0;
  const abertos = links?.filter((l) => l.cliques > 0).length ?? 0;

  return (
    <div className="flex h-full flex-col gap-8 overflow-y-auto md:p-2">
      <CabecalhoDaSubTela titulo={t("Links de saída")} idioma={idioma} tituloClassName="text-xl font-semibold tracking-tight">
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {t(
            "Quem abriu o link que a empresa mandou. Escreva {{link:https://example.com}} numa mensagem — ou {{link:https://example.com|campanha}} para agrupar — e cada contato recebe um link curto próprio.",
          )}
        </p>
      </CabecalhoDaSubTela>

      {links === null ? (
        <p className="max-w-2xl rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível carregar os links agora. Recarregue a página.")}
        </p>
      ) : links.length === 0 ? (
        <div className="flex max-w-2xl flex-col gap-2" data-testid="links-de-saida-vazio">
          <p className="text-sm text-text">{t("Nenhum link enviado ainda.")}</p>
          <p className="text-sm text-text-muted">
            {t(
              "O link curto nasce no envio, para contato conhecido. Em grupo, o link sai como foi escrito, sem rastreio. A prévia que o WhatsApp monta sozinho não conta como clique.",
            )}
          </p>
        </div>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-10 gap-y-3" data-testid="links-de-saida-totais">
            <div>
              <dt className="text-xs text-text-subtle">{t("Links enviados")}</dt>
              <dd className="text-xl font-semibold tabular-nums">{links.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-subtle">{t("Abertos")}</dt>
              <dd className="text-xl font-semibold tabular-nums">{abertos}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-subtle">{t("Cliques")}</dt>
              <dd className="text-xl font-semibold tabular-nums">{totalDeCliques}</dd>
            </div>
          </dl>

          <div className="flex flex-col gap-8 lg:flex-row">
            <TabelaDeGrupos titulo={t("Campanha")} id="links-por-rotulo" grupos={porRotulo(links)} rotuloDoSem={t("Sem campanha")} t={t} />
            <TabelaDeGrupos titulo={t("Contato")} id="links-por-contato" grupos={porContato(links)} rotuloDoSem={t("Sem contato (anonimizado ou apagado)")} t={t} />
          </div>

          <section className="flex flex-col gap-2" aria-labelledby="links-um-a-um">
            <h2 id="links-um-a-um" className="text-sm font-semibold">
              {t("Link a link")}
            </h2>
            <ul className="divide-y divide-border border-y border-border" data-testid="lista-de-links-de-saida">
              {links.map((l) => (
                <li key={l.id} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 basis-64 truncate text-sm" title={l.destino_url}>
                    {destinoLegivel(l.destino_url)}
                  </span>
                  <span className="w-40 truncate text-sm text-text-muted">
                    {l.anonimizado ? t("Contato anonimizado") : (l.contato_nome ?? t("Contato sem nome"))}
                  </span>
                  <span className="w-28 truncate text-xs text-text-subtle">{l.rotulo ?? ""}</span>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">
                    {l.cliques} <span className="font-normal text-text-subtle">{l.cliques === 1 ? t("clique") : t("cliques")}</span>
                  </span>
                  <span className="w-28 text-right text-xs tabular-nums text-text-subtle">{quando(l.ultimo_clique, idioma)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
