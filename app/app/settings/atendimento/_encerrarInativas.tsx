"use client";

/**
 * ENCERRAMENTO AUTOMÁTICO POR INATIVIDADE (fase 3, item 3.8) —
 * `settings.atendimento.encerrar_inativas_apos_horas`, gravado por
 * `PATCH /api/v1/settings/encerrar-inativas` (admin). Quem age é o cron horário
 * `encerrar-inativas`. Desligado de fábrica.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

const PADRAO_AO_LIGAR = 24;

export function EncerrarInativas({
  horas,
  idioma,
  podeMudar,
}: {
  /** `null` = desligado. */
  horas: number | null;
  idioma: Idioma;
  /** Espelha o `admin` que a rota cobra. Cortesia, não autorização. */
  podeMudar: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [ligado, setLigado] = useState(horas !== null);
  const [valor, setValor] = useState(String(horas ?? PADRAO_AO_LIGAR));
  const [salvo, setSalvo] = useState<number | null>(horas);
  const [ocupado, setOcupado] = useState(false);

  async function gravar(novo: number | null) {
    setOcupado(true);
    try {
      await apiClient.patch("/api/v1/settings/encerrar-inativas", { horas: novo });
      setSalvo(novo);
      toast.success(t("Opção salva."));
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? t(err.message) : t("Não consegui salvar agora."));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const numero = Number(valor);
  const valido = Number.isInteger(numero) && numero >= 1 && numero <= 720;

  return (
    <Card className="p-6" data-testid="encerrar-inativas">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="encerrar_inativas">{t("Encerrar conversas sem resposta do cliente")}</Label>
          <p className="max-w-2xl text-xs text-text-muted">
            {t(
              "Ligado, a conversa em que a equipe ou a IA falou por último e o cliente não respondeu no prazo é encerrada sozinha, uma vez por hora. Conversa em que o cliente espera resposta, marcada como pendente ou lembrada para depois nunca é encerrada por aqui.",
            )}
          </p>
          <p className="text-xs" data-testid="encerrar-inativas-estado">
            {salvo === null
              ? t("Desligado: nenhuma conversa é encerrada sozinha.")
              : `${t("Ligado: encerra depois de")} ${salvo} ${t("horas sem resposta.")}`}
          </p>
          {!podeMudar && (
            <p className="text-xs text-text-muted">{t("Só um administrador da organização pode mudar esta opção.")}</p>
          )}
        </div>
        <Switch
          id="encerrar_inativas"
          checked={ligado}
          disabled={ocupado || !podeMudar}
          onCheckedChange={async (novo) => {
            setLigado(novo);
            const ok = await gravar(novo ? (valido ? numero : PADRAO_AO_LIGAR) : null);
            if (!ok) setLigado(!novo);
          }}
        />
      </div>
      {ligado && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="encerrar_inativas_horas">{t("Horas sem resposta")}</Label>
            <Input
              id="encerrar_inativas_horas"
              type="number"
              min={1}
              max={720}
              value={valor}
              disabled={!podeMudar}
              onChange={(e) => setValor(e.target.value)}
              className="w-28"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={ocupado || !podeMudar || !valido || numero === salvo}
            onClick={() => void gravar(numero)}
          >
            {t("Salvar")}
          </Button>
          {!valido && <p className="text-xs text-error-fg">{t("Entre 1 e 720 horas.")}</p>}
        </div>
      )}
    </Card>
  );
}
