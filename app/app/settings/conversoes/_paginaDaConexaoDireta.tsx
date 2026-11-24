/**
 * A página de conversões do GA4 e do TikTok (9488) — servidor. As duas rotas
 * (`ga4/page.tsx`, `tiktok/page.tsx`) só fixam a plataforma.
 *
 * Mesmo gate e mesma leitura da tela de Conversões: `admin`, admin client (a
 * tabela não tem policy) e o segredo nunca sai do servidor — o estado leva só
 * `temSegredo`.
 */
import Link from "next/link";
import { redirect } from "next/navigation";

import type { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { MOTIVO_LEGIVEL } from "@/lib/conversoes/estado-da-conexao";
import { rotuloDoEvento } from "@/lib/conversoes/historico";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  lerEnviosRecentes,
  lerEstadoDaConexaoDireta,
  NOME_DA_PLATAFORMA,
  type EnvioRecente,
  type EstadoDaConexaoDireta,
} from "@/lib/plataformas-de-anuncio/conexao-direta";
import type { PlataformaComMapeamento } from "@/lib/plataformas-de-anuncio/mapeamento-de-eventos";
import { createAdminClient } from "@/lib/supabase/admin";

import { LinkDoNegocio } from "./_linkDoNegocio";
import { FormularioDaConexaoDireta } from "./_formConexaoDireta";

const DESCRICAO: Record<PlataformaComMapeamento, string> = {
  ga4: "Quando um negócio é ganho ou um lead chega, o evento vai para o Google Analytics 4 pelo Measurement Protocol, ligado ao visitante do site quando a origem dele foi capturada.",
  tiktok:
    "Quando um negócio que veio de anúncio do TikTok é marcado como ganho, o evento volta para o pixel pela Events API. É esse retorno que ensina o anúncio a procurar mais gente parecida com quem comprou.",
};

const STATUS_DO_ENVIO: Record<string, string> = {
  sent: "Enviado",
  skipped: "Pendente",
  error: "Erro",
  processing: "Pendente",
};

/**
 * `Cabecalho` vem da página: o gate `volta-das-subtelas-de-configuracoes`
 * confere que CADA `page.tsx` de Configurações rende o cabeçalho com o caminho
 * de volta, e a página o entrega pronto para cá.
 */
export async function PaginaDaConexaoDireta({
  plataforma,
  Cabecalho,
}: {
  plataforma: PlataformaComMapeamento;
  Cabecalho: typeof CabecalhoDaSubTela;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!(user.is_platform_admin && !user.support) && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const admin = createAdminClient();
  const [estado, envios] = await Promise.all([
    lerEstadoDaConexaoDireta(admin, activeOrg.orgId, plataforma).catch(
      (): EstadoDaConexaoDireta | null => null,
    ),
    lerEnviosRecentes(admin, activeOrg.orgId, plataforma).catch((): EnvioRecente[] | null => null),
  ]);

  return (
    <div className="flex flex-col gap-6 p-2">
      <Cabecalho
        titulo={NOME_DA_PLATAFORMA[plataforma]}
        idioma={idioma}
        tituloClassName="text-xl font-semibold tracking-tight"
      >
        <p className="mt-1 max-w-2xl text-sm text-text-muted">{t(DESCRICAO[plataforma])}</p>
        {estado && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs" data-testid="estado-da-conexao">
            <span
              className={
                estado.conectada
                  ? "rounded-sm bg-success-bg px-1.5 py-0.5 font-medium text-success-fg"
                  : "rounded-sm bg-surface-elevated px-1.5 py-0.5 font-medium text-text-muted"
              }
            >
              {estado.conectada ? t("Conectado") : t("Não conectado")}
            </span>
            {estado.conectada && (
              <span
                className={
                  estado.habilitada
                    ? "rounded-sm bg-surface-elevated px-1.5 py-0.5 text-text"
                    : "rounded-sm bg-warning-bg px-1.5 py-0.5 text-warning-fg"
                }
              >
                {estado.habilitada ? t("Ligado") : t("Pausado")}
              </span>
            )}
            <Link
              href="/app/settings/conversoes"
              className="inline-flex min-h-11 items-center text-text-muted underline underline-offset-4 hover:text-text lg:min-h-0"
            >
              {t("Conversões")}
            </Link>
          </p>
        )}
      </Cabecalho>

      {!estado ? (
        <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error-fg">
          {t("Não consegui ler o histórico agora. Atualize a página em instantes.")}
        </p>
      ) : (
        <>
          {estado.conectada && !estado.habilitada && (
            <p className="max-w-2xl rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-fg">
              {t(
                "O envio está pausado. As vendas continuam sendo registradas aqui, mas não vão para a plataforma enquanto isto estiver desligado.",
              )}
            </p>
          )}
          {estado.testEventCode && (
            <p className="max-w-2xl rounded-md bg-info-bg px-3 py-2 text-sm text-info-fg">
              {t(
                "Modo de teste ligado: as vendas vão marcadas como teste e não contam para a otimização. Apague o código de teste quando terminar de conferir.",
              )}
            </p>
          )}
          <FormularioDaConexaoDireta
            key={`${estado.identificador}:${estado.habilitada}:${estado.temSegredo}`}
            plataforma={plataforma}
            estado={estado}
            idioma={idioma}
          />
        </>
      )}

      <section
        className="flex max-w-4xl flex-col gap-3 border-t border-border pt-6"
        aria-labelledby="envios-titulo"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="envios-titulo" className="text-sm font-semibold">
            {t("Histórico de envios")}
          </h2>
          <Link
            href="/app/settings/conversoes?aba=historico"
            className="inline-flex min-h-11 items-center text-xs text-text-muted underline underline-offset-4 hover:text-text lg:min-h-0"
          >
            {t("Ver tudo")}
          </Link>
        </div>
        {envios === null ? (
          <p role="alert" className="text-sm text-error-fg">
            {t("Não consegui ler o histórico agora. Atualize a página em instantes.")}
          </p>
        ) : envios.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t("Nenhuma pendência. Ainda pode não haver vendas ou qualificações com origem em anúncio.")}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="envios-recentes">
            {envios.map((e) => (
              <li
                key={`${e.leadId}:${e.evento}`}
                className="grid gap-1 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_10rem] sm:items-baseline sm:gap-4"
              >
                <div className="min-w-0">
                  <LinkDoNegocio className="font-medium underline-offset-2 hover:underline" leadId={e.leadId}>
                    {t(rotuloDoEvento(e.evento, []))}
                  </LinkDoNegocio>
                  {e.motivo && (
                    <span className="block text-xs text-text-muted">
                      {t(MOTIVO_LEGIVEL[e.motivo] ?? e.motivo)}
                    </span>
                  )}
                  {e.detalhe && (
                    <span className="block text-xs break-words text-text-subtle">{e.detalhe}</span>
                  )}
                </div>
                <span
                  className={
                    e.status === "sent"
                      ? "text-success-fg"
                      : e.status === "error"
                        ? "text-error-fg"
                        : "text-text-muted"
                  }
                >
                  {t(STATUS_DO_ENVIO[e.status] ?? e.status)}
                </span>
                <span className="text-xs text-text-subtle tabular-nums">
                  {new Date(e.tentadoEm).toLocaleString(idioma)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
