"use client";
import { useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/hooks/i18n/useT";
import { teclaDo } from "@/components/inbox/atalhos-da-conversa";

interface Props {
  /** Currently visible conversation ids in the list (for j/k nav). */
  visibleIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocusReply: () => void;
  onClaim: () => void;
  onClose: () => void;
  onToggleHelp: () => void;
  enabled?: boolean;
}

export function InboxKeyboardShortcuts({
  visibleIds,
  selectedId,
  onSelect,
  onFocusReply,
  onClaim,
  onClose,
  onToggleHelp,
  enabled = true,
}: Props) {
  const t = useT();
  const [confirmFecharOpen, setConfirmFecharOpen] = useState(false);
  // Com a confirmação aberta, os atalhos param: o `window.confirm()` travava a
  // página e ninguém trocava de conversa por trás dele. Sem isto, "e" e depois
  // "j" deixariam o "Fechar" de dentro encerrar a conversa SEGUINTE, não a que
  // estava na tela quando a pergunta foi feita.
  const ativo = enabled && !confirmFecharOpen;
  function step(delta: number) {
    if (visibleIds.length === 0) return;
    const idx = selectedId ? visibleIds.indexOf(selectedId) : -1;
    let next = idx + delta;
    if (idx < 0) next = delta > 0 ? 0 : visibleIds.length - 1;
    if (next < 0) next = 0;
    if (next >= visibleIds.length) next = visibleIds.length - 1;
    const id = visibleIds[next];
    if (id) onSelect(id);
  }

  // A NAVEGAÇÃO mora aqui. As ações da conversa (transferir, fila, automático,
  // lembrar, tarefa, contato) são registradas pelo `ConversationHeader`, porque
  // é ele que sabe quando cada uma se aplica — a mesma condição que esconde o
  // item do menu ⋯ desliga a tecla. As teclas das duas metades saem de
  // `ATALHOS_DO_INBOX`, a lista que a ajuda (`?`) desenha.
  useHotkeys(teclaDo("proxima"), () => step(1), { enabled: ativo, preventDefault: true }, [
    visibleIds,
    selectedId,
  ]);
  useHotkeys(teclaDo("anterior"), () => step(-1), { enabled: ativo, preventDefault: true }, [
    visibleIds,
    selectedId,
  ]);
  useHotkeys(teclaDo("responder"), () => onFocusReply(), { enabled: ativo, preventDefault: true });
  useHotkeys(teclaDo("assumir"), () => onClaim(), { enabled: ativo, preventDefault: true });
  useHotkeys(
    teclaDo("fechar"),
    () => setConfirmFecharOpen(true),
    { enabled: ativo, preventDefault: true },
  );
  // A AJUDA ESCUTA O CARACTERE "?", não a tecla física. O hook casa pelo código
  // da tecla por padrão, e "shift+/" nunca casava: o "?" do teclado ABNT2 fica
  // noutra tecla, e mesmo no americano o hook não mapeia "/" para "Slash" — a
  // ajuda nunca abriu pelo teclado (medido no navegador). `ignoreModifiers`
  // porque o "?" só sai com Shift.
  useHotkeys(teclaDo("ajuda"), () => onToggleHelp(), {
    enabled: ativo,
    preventDefault: true,
    useKey: true,
    ignoreModifiers: true,
  });

  return (
    <AlertDialog open={confirmFecharOpen} onOpenChange={setConfirmFecharOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Fechar conversa?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("O atendimento é encerrado. Se o cliente escrever de novo, você pode reabrir.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancelar")}</AlertDialogCancel>
          <AlertDialogAction onClick={onClose}>{t("Fechar")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
