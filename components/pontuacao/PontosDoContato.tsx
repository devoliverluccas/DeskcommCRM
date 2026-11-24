"use client";
/**
 * PONTOS do contato, com o extrato a um gesto (fase 4, item 4.5).
 *
 * Mora AO LADO do score (`ScoreSlot`) e não dentro dele: o score é a fórmula de
 * probabilidade de fechar, os pontos são as regras da organização
 * (Configurações › Pontuação do lead). Dois números, cada um com o seu porquê.
 *
 * Exportável de propósito: a ficha do negócio (`LeadDossier`) já o monta, e a
 * ficha do contato no Inbox (`CRMSidePanel`) monta com
 * `<PontosDoContato contactId={contato.id} />`, sem mais nada.
 *
 * Sem regra e sem extrato, não desenha nada: uma organização que não usa pontos
 * não ganha um "0 pontos" em cada ficha. Falha de leitura também não desenha —
 * o número é secundário, e a ficha não pode quebrar por ele.
 */
import { useEffect, useState, type MouseEvent } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ROTULO_DO_EVENTO, comSinal, type LinhaDoExtrato } from "@/lib/leads/pontuacao-por-regra";
import { cn } from "@/lib/utils";

interface Extrato {
  total: number;
  itens: LinhaDoExtrato[];
}

export function PontosDoContato({ contactId, className }: { contactId: string | null | undefined; className?: string }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [extrato, setExtrato] = useState<Extrato | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    // `Promise.resolve().then(...)`: qualquer falha — inclusive a de um cliente
    // que não devolve promessa — vira o `catch`, e a ficha segue sem o número.
    Promise.resolve()
      .then(() => apiClient.get<{ data: Extrato }>(`/api/v1/pontuacao/extrato?contact_id=${encodeURIComponent(contactId)}`))
      .then((r) => {
        const dado = r?.data;
        if (vivo) setExtrato(dado && typeof dado.total === "number" && Array.isArray(dado.itens) ? dado : null);
      })
      .catch(() => {
        if (vivo) setExtrato(null);
      });
    return () => {
      vivo = false;
    };
  }, [contactId]);

  if (!contactId || !extrato || (extrato.total === 0 && extrato.itens.length === 0)) return null;

  const pare = (e: MouseEvent) => e.stopPropagation();

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            pare(e);
            setAberto((v) => !v);
          }}
          aria-label={`${t("Pontos")}: ${extrato.total}. ${t("Ver o extrato.")}`}
          data-testid="pontos-do-contato"
          className={cn(
            "inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-left lg:min-h-0",
            "text-text-muted hover:text-text",
            className,
          )}
        >
          <span className="tabular-nums font-medium text-text">{extrato.total}</span>
          <span>{t("pts")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs" onClick={pare} data-testid="pontos-extrato">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium text-text">{t("Pontos")}</p>
          <p className="text-base font-semibold tabular-nums text-text">{extrato.total}</p>
        </div>
        <p className="mt-0.5 text-text-muted">{t("Pelas regras de Configurações › Pontuação do lead.")}</p>
        {extrato.itens.length > 0 ? (
          <ul className="mt-2 divide-y divide-border">
            {extrato.itens.map((l) => (
              <li key={l.id} className="flex items-baseline gap-2 py-1.5">
                <span
                  className={cn(
                    "w-10 shrink-0 text-right tabular-nums font-medium",
                    l.pontos > 0 ? "text-success-fg" : "text-warning-fg",
                  )}
                >
                  {comSinal(l.pontos)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-text">{l.motivo}</span>
                  <span className="block text-text-subtle">
                    {t(ROTULO_DO_EVENTO[l.evento] ?? l.evento)} ·{" "}
                    {new Date(l.ocorrido_em).toLocaleString(tagDoIdioma, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-text-muted">{t("Sem lançamentos no extrato.")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
