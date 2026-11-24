"use client";

/**
 * A LISTA "ORÇAMENTOS" DO CONTATO — para o painel lateral do Inbox (fase 2).
 *
 * Uma linha por proposta, a mais nova em cima: número (ou "Rascunho"), título,
 * estado, data e valor; a linha inteira abre a proposta no editor. Lista, não
 * mural: sem cartão em volta, a hierarquia é o peso do valor e o tom do estado.
 *
 * Quem monta decide a capacidade `propostas` (sem ela, a rota é 404) e passa
 * `onNovo` quando há onde abrir a gaveta "Novo orçamento".
 */
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { numeroDaProposta, usePropostasDaConversa, type PropostaDoContato } from "@/hooks/inbox/usePropostasDaConversa";
import { formatCents } from "@/lib/money";
import type { ProposalStatus } from "@/lib/propostas/tipos";
import { cn } from "@/lib/utils";

const ROTULO: Record<ProposalStatus, string> = {
  rascunho: "Rascunho",
  enviando: "Enviando",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
  vencida: "Vencida",
  cancelada: "Cancelada",
  substituida: "Substituída",
};

/** Só os estados que pedem atenção ganham tom; o resto é texto discreto. */
const TOM: Partial<Record<ProposalStatus, string>> = {
  enviada: "bg-info-bg text-info-fg",
  enviando: "bg-info-bg text-info-fg",
  aceita: "bg-success-bg text-success-fg",
  recusada: "bg-error-bg text-error-fg",
  vencida: "bg-warning-bg text-warning-fg",
};

function dataCurta(iso: string, tag: string): string {
  return new Date(iso).toLocaleDateString(tag, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function Linha({ p }: { p: PropostaDoContato }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const numero = numeroDaProposta(p);
  const quando = p.decided_at ?? p.sent_at ?? p.created_at;
  return (
    <li>
      <Link
        href={`/app/proposals/${p.id}`}
        className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500 lg:min-h-10"
        data-testid="orcamento-do-contato"
        aria-label={`${t("Abrir")} ${p.titulo}`}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-text">{p.titulo}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
            {/* Rascunho ainda não tem número; o selo ao lado já diz o estado. */}
            {numero ? (
              <>
                <span className="font-mono">{numero}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <span>{dataCurta(quando, tag)}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-medium tabular-nums">{formatCents(p.total_cents, p.moeda)}</span>
          <span
            className={cn("rounded-sm px-1.5 py-px text-[11px] leading-4", TOM[p.status] ?? "text-text-subtle")}
            data-status={p.status}
          >
            {t(ROTULO[p.status])}
            {p.decided_via === "cliente" && (p.status === "aceita" || p.status === "recusada") ? ` · ${t("pelo cliente")}` : ""}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function PropostasDaConversa({ contactId, onNovo }: { contactId: string; onNovo?: () => void }) {
  const t = useT();
  const { data, isLoading, isError, refetch } = usePropostasDaConversa(contactId);

  return (
    <section aria-label={t("Orçamentos")} className="space-y-2" data-testid="orcamentos-do-contato">
      <div className="flex items-center justify-between gap-2">
        <h3>{t("Orçamentos")}</h3>
        {onNovo ? (
          <Button size="sm" variant="outline" onClick={onNovo} data-testid="novo-orcamento">
            {t("Novo orçamento")}
          </Button>
        ) : null}
      </div>
      {isLoading ? (
        <p role="status" className="px-2 text-sm text-text-muted">
          {t("Carregando…")}
        </p>
      ) : isError ? (
        <div role="alert" className="space-y-2 px-2">
          <p className="text-sm text-text-muted">{t("Falha ao listar propostas.")}</p>
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="py-2 text-sm text-text-muted">{t("Nenhum orçamento ainda.")}</p>
      ) : (
        <ul className="-mx-2 divide-y divide-border">
          {data.map((p) => (
            <Linha key={p.id} p={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
