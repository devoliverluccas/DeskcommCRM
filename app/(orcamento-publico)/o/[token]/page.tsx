/**
 * /o/[token] — O ORÇAMENTO QUE O CLIENTE ABRE PELO LINK DO WHATSAPP (9480).
 *
 * Rota pública (entrada em `lib/auth/public-paths.ts`). NADA aqui depende de
 * cookie: a única autoridade é o token, e a organização sai da linha do link
 * (`lerOrcamentoPublico`). Matriz:
 *
 *  - muitas aberturas do mesmo IP      → "Muitas tentativas" (antes do banco)
 *  - token sem formato / sem link      → "não encontrado", sem dizer qual
 *  - link aberto                       → orçamento + Aceitar / Recusar
 *  - aceita, recusada, vencida,
 *    revogada, substituída, cancelada  → orçamento + o estado, SEM botões
 */
import { headers } from "next/headers";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";
import { formatCents } from "@/lib/money";
import type { EstadoDoLink } from "@/lib/propostas/link-publico";
import { lerOrcamentoPublico, registrarAcesso, type OrcamentoPublico } from "@/lib/propostas/orcamento-publico";
import { createAdminClient } from "@/lib/supabase/admin";

import { DecisaoDoOrcamento } from "./DecisaoDoOrcamento";

export const dynamic = "force-dynamic";

/** Aberturas por IP por minuto. Folgado para quem recarrega; caro para quem varre tokens. */
const ABERTURAS_POR_MINUTO = 30;

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string; erro?: string }>;
}

/** O que a faixa de estado diz, e com que cor de estado. `aberta` não tem faixa. */
const FAIXA: Record<Exclude<EstadoDoLink, "aberta">, { texto: string; tom: "success" | "error" | "warning" | "info" }> = {
  aceita: { texto: "Este orçamento foi aceito.", tom: "success" },
  recusada: { texto: "Este orçamento foi recusado.", tom: "error" },
  vencida: { texto: "Este orçamento venceu. Fale com a empresa para receber um novo.", tom: "warning" },
  revogada: { texto: "Este link não está mais disponível.", tom: "warning" },
  substituida: { texto: "Este orçamento foi substituído por uma versão mais nova. Confira a mensagem mais recente da empresa.", tom: "info" },
  cancelada: { texto: "Este orçamento foi cancelado.", tom: "warning" },
  indisponivel: { texto: "Este orçamento ainda não está disponível.", tom: "info" },
};

const TOM: Record<"success" | "error" | "warning" | "info", string> = {
  success: "bg-success-bg text-success-fg",
  error: "bg-error-bg text-error-fg",
  warning: "bg-warning-bg text-warning-fg",
  info: "bg-info-bg text-info-fg",
};

/** O retorno do envio do formulário (`decidir/route.ts` redireciona com `?r=` ou `?erro=`). */
const RETORNO: Record<string, { texto: string; tom: "success" | "error" | "warning" }> = {
  aceita: { texto: "Pronto! Seu aceite foi registrado.", tom: "success" },
  recusada: { texto: "Sua resposta foi registrada.", tom: "success" },
  fechado: { texto: "Este orçamento não aceita mais resposta.", tom: "warning" },
  limite: { texto: "Muitas tentativas. Aguarde um minuto e tente de novo.", tom: "warning" },
  falha: { texto: "Não foi possível registrar agora. Tente de novo.", tom: "error" },
};

function Casca({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>;
}

function numeroDoOrcamento(o: OrcamentoPublico): string | null {
  if (o.numero === null || o.ano === null) return null;
  return `${String(o.numero).padStart(4, "0")}/${o.ano}${o.versao > 1 ? ` v${o.versao}` : ""}`;
}

function dataLegivel(iso: string, idioma: Idioma): string {
  // `valid_until` é DATA (AAAA-MM-DD): meio-dia UTC não troca de dia em fuso nenhum.
  const d = new Date(`${iso}T12:00:00.000Z`);
  return d.toLocaleDateString(tagDeIdioma(idioma), { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function OrcamentoPublicoPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const { r, erro } = await searchParams;
  const idioma = await idiomaDoVisitante(null);
  const t = (texto: string) => traduzir(texto, idioma);

  const ip = ipDoCliente(await headers());
  if (ip && !(await checkRateLimit(`orcamento-publico:${ip}`, ABERTURAS_POR_MINUTO, 60)).allowed) {
    return (
      <Casca>
        <h1 className="text-xl font-semibold tracking-tight">{t("Muitas tentativas")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Aguarde um minuto e abra o link de novo.")}</p>
      </Casca>
    );
  }

  const admin = createAdminClient();
  const orcamento = await lerOrcamentoPublico(admin, token);
  if (!orcamento) {
    return (
      <Casca>
        <h1 className="text-xl font-semibold tracking-tight">{t("Orçamento não encontrado")}</h1>
        <p className="mt-2 text-sm text-text-muted">{t("Confira se o link está completo, ou peça um novo à empresa.")}</p>
      </Casca>
    );
  }
  void registrarAcesso(admin, orcamento.organizationId, orcamento.linkId);

  const numero = numeroDoOrcamento(orcamento);
  const retorno = (r && RETORNO[r]) || (erro && RETORNO[erro]) || null;
  const faixa = orcamento.estado === "aberta" ? null : FAIXA[orcamento.estado];
  const temAjustes = orcamento.descontoCents !== 0 || orcamento.freteCents !== 0;
  const moeda = orcamento.moeda;

  return (
    <Casca>
      <header className="flex items-center justify-between gap-4 border-b border-border pb-6" data-testid="orcamento-empresa">
        {orcamento.empresa.logoUrl ? (
          // <img> e não next/image: a URL é do Storage de quem hospeda, fora de
          // qualquer allowlist de build (mesmo motivo da casca do app).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={orcamento.empresa.logoUrl} alt={orcamento.empresa.nome ?? ""} className="h-10 w-auto max-w-[10rem] object-contain" />
        ) : (
          <p className="text-base font-semibold tracking-tight">{orcamento.empresa.nome}</p>
        )}
        {numero ? (
          <p className="font-mono text-xs text-text-muted">
            {t("Orçamento")} {numero}
          </p>
        ) : null}
      </header>

      <section className="space-y-1 py-6">
        <h1 className="text-xl font-semibold tracking-tight">{orcamento.titulo}</h1>
        {orcamento.cliente ? (
          <p className="text-sm text-text-muted">
            {t("Para")} {orcamento.cliente}
          </p>
        ) : null}
      </section>

      {retorno ? (
        <p role="status" className={`mb-4 rounded-md px-3 py-2 text-sm ${TOM[retorno.tom]}`}>
          {t(retorno.texto)}
        </p>
      ) : null}
      {faixa && !(r && (r === "aceita" || r === "recusada")) ? (
        <p role="status" data-testid="orcamento-estado" className={`mb-4 rounded-md px-3 py-2 text-sm ${TOM[faixa.tom]}`}>
          {t(faixa.texto)}
        </p>
      ) : null}

      <h2 className="sr-only">{t("Itens")}</h2>
      <ul className="divide-y divide-border border-y border-border" data-testid="orcamento-itens">
        {orcamento.itens.map((it, i) => (
          <li key={i} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm text-text">{it.descricao}</p>
              <p className="text-xs text-text-muted tabular-nums">
                {it.quantidade} × {it.precoUnitarioCents === null ? t("A definir") : formatCents(it.precoUnitarioCents, moeda)}
                {it.descontoCents > 0 ? ` · ${t("Desconto")} ${formatCents(it.descontoCents, moeda)}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums">
              {it.subtotalCents === null ? t("A definir") : formatCents(it.subtotalCents, moeda)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="space-y-1 py-4 text-sm" data-testid="orcamento-totais">
        {temAjustes ? (
          <>
            <div className="flex justify-between gap-4 text-text-muted">
              <dt>{t("Subtotal")}</dt>
              <dd className="tabular-nums">{formatCents(orcamento.subtotalCents, moeda)}</dd>
            </div>
            {orcamento.descontoCents !== 0 ? (
              <div className="flex justify-between gap-4 text-text-muted">
                <dt>{t("Desconto")}</dt>
                <dd className="tabular-nums">− {formatCents(orcamento.descontoCents, moeda)}</dd>
              </div>
            ) : null}
            {orcamento.freteCents !== 0 ? (
              <div className="flex justify-between gap-4 text-text-muted">
                <dt>{t("Frete")}</dt>
                <dd className="tabular-nums">{formatCents(orcamento.freteCents, moeda)}</dd>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="flex items-baseline justify-between gap-4 pt-2">
          <dt className="text-base font-semibold">{t("Total")}</dt>
          <dd className="text-xl font-semibold tabular-nums">{formatCents(orcamento.totalCents, moeda)}</dd>
        </div>
      </dl>

      <div className="space-y-2 border-t border-border pt-4 text-sm text-text-muted">
        {orcamento.validUntil ? (
          <p>
            {t("Válido até")} {dataLegivel(orcamento.validUntil, idioma)}
          </p>
        ) : null}
        {orcamento.condicoes ? <p className="whitespace-pre-line">{orcamento.condicoes}</p> : null}
      </div>

      {orcamento.estado === "aberta" ? (
        <div className="mt-8">
          <DecisaoDoOrcamento token={token} />
        </div>
      ) : null}
    </Casca>
  );
}
