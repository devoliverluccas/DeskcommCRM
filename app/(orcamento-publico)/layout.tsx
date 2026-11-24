import type { Metadata } from "next";

import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { idiomaDoVisitante } from "@/lib/i18n/idiomaAnonimo";

/**
 * A casca do ORÇAMENTO PÚBLICO (`/o/<token>`, migration 9480).
 *
 * ─── Por que um grupo próprio, e não `app/(public)` ──────────────────────────
 *
 * A casca de `(public)` é a das telas de ACESSO: ela pinta a marca da
 * INSTALAÇÃO (`marcaDaSaida(null)`) num trilho lateral e aperta o conteúdo em
 * `max-w-sm`. O orçamento é documento da ORGANIZAÇÃO para o cliente dela — a
 * mesma régua do PDF (`lib/propostas/marca-da-organizacao-para-pdf.ts`): o
 * revendedor que opera a instalação não assina a proposta de ninguém. Dentro de
 * `(public)` não há como fugir daquele layout, então a página mora aqui, com a
 * mesma URL.
 *
 * Quem chega não tem sessão: o idioma é o do navegador (`Accept-Language`).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // O token está na URL: nenhum recurso de terceiro (o logo da organização,
  // por exemplo) pode recebê-lo no cabeçalho `Referer`.
  referrer: "no-referrer",
};

export default async function OrcamentoPublicoLayout({ children }: { children: React.ReactNode }) {
  const locale = await idiomaDoVisitante(null);
  return (
    <IdiomaProvider locale={locale}>
      <div className="min-h-dvh bg-bg text-text">{children}</div>
    </IdiomaProvider>
  );
}
