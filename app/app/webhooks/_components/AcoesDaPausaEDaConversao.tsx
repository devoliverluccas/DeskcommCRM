"use client";
/**
 * Os formulários das duas ações da fase 4 (4.1): "Pausar a IA nesta conversa"
 * e "Enviar conversão para plataforma de anúncio". Moram fora do
 * `ActionConfigForm` (já com quase 2 mil linhas) e entram nele pelo `switch`.
 */
import { useT } from "@/hooks/i18n/useT";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  EVENTO_DA_VENDA,
  ROTULOS_DA_CONVERSAO_NA_AUTOMACAO,
  type EventoDaConversaoNaAutomacao,
} from "@/lib/automation/conversao-pela-automacao";

export function PausarIaForm() {
  const t = useT();
  return (
    <p className="text-sm text-text-muted">
      {t(
        "A IA para de responder nesta conversa até alguém da equipe reativá-la. Sem responsável, a conversa volta para a fila de atendimento.",
      )}
    </p>
  );
}

export function EnviarConversaoForm({
  config,
  onChange,
}: {
  config: { evento: EventoDaConversaoNaAutomacao | "" };
  onChange: (config: { evento: EventoDaConversaoNaAutomacao | "" }) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label>{t("Evento de conversão")}</Label>
        <Select
          value={config.evento || undefined}
          onValueChange={(v) => onChange({ evento: v as EventoDaConversaoNaAutomacao })}
        >
          <SelectTrigger aria-label={t("Evento de conversão")} className="min-h-11 lg:min-h-9">
            <SelectValue placeholder={t("Escolha o evento")} />
          </SelectTrigger>
          <SelectContent>
            {ROTULOS_DA_CONVERSAO_NA_AUTOMACAO.map((e) => (
              <SelectItem key={e.valor} value={e.valor}>
                {t(e.rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-text-muted">
        {config.evento === EVENTO_DA_VENDA
          ? t(
              "A venda vai para a plataforma que trouxe o contato, e só sai de negócio ganho, com valor. Contato que não veio de anúncio não gera envio.",
            )
          : t(
              "O evento vai para a plataforma que trouxe o contato. Hoje, eventos de etapa saem só para quem veio de anúncio da Meta. Acompanhe os envios em Conversões.",
            )}
      </p>
    </div>
  );
}
