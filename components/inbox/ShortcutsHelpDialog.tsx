"use client";
import { useT } from "@/hooks/i18n/useT";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ATALHOS_DO_INBOX } from "@/components/inbox/atalhos-da-conversa";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * A AJUDA DO `?` — desenhada a partir de `ATALHOS_DO_INBOX`, a mesma lista que
 * registra as teclas e que põe a dica à direita dos itens do menu ⋯. Uma lista
 * estática aqui ensinaria uma tecla que o hook já não escuta.
 */
export function ShortcutsHelpDialog({ open, onOpenChange }: Props) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Atalhos de teclado")}</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border text-sm" data-testid="lista-de-atalhos">
          {ATALHOS_DO_INBOX.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 py-1.5">
              <span className="text-text-muted">{t(a.descricao)}</span>
              <kbd className="shrink-0 rounded-sm border border-border bg-surface-elevated px-1.5 py-0.5 font-mono text-xs text-text">
                {a.exibicao}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
