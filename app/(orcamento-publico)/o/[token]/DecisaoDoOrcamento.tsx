"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";

/**
 * ACEITAR / RECUSAR — dois formulários HTML de verdade, que postam em
 * `/o/<token>/decidir` e voltam para a página (303). Sem `fetch`: funciona com
 * o JavaScript ainda carregando no celular de quem abriu pelo WhatsApp, e o
 * estado que a página mostra depois é o que o banco gravou, não o que a tela
 * supôs. O JS só faz duas coisas: abrir o campo de motivo da recusa e travar o
 * segundo toque enquanto o primeiro viaja.
 */
export function DecisaoDoOrcamento({ token }: { token: string }) {
  const t = useT();
  const [recusando, setRecusando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const acao = `/o/${token}/decidir`;

  if (recusando) {
    return (
      <form method="post" action={acao} onSubmit={() => setEnviando(true)} className="space-y-3" data-testid="form-recusa">
        <input type="hidden" name="decisao" value="recusada" />
        <div className="space-y-1.5">
          <Label htmlFor="motivo-da-recusa">{t("Motivo da recusa (opcional):")}</Label>
          <Textarea id="motivo-da-recusa" name="motivo" maxLength={1000} rows={3} className="text-base sm:text-sm" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={enviando} onClick={() => setRecusando(false)}>
            {t("Cancelar")}
          </Button>
          <Button type="submit" variant="secondary" disabled={enviando}>
            {t("Enviar recusa")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" disabled={enviando} onClick={() => setRecusando(true)} data-testid="orcamento-recusar">
        {t("Recusar")}
      </Button>
      <form method="post" action={acao} onSubmit={() => setEnviando(true)}>
        <input type="hidden" name="decisao" value="aceita" />
        <Button type="submit" disabled={enviando} className="w-full sm:w-auto" data-testid="orcamento-aceitar">
          {t("Aceitar orçamento")}
        </Button>
      </form>
    </div>
  );
}
