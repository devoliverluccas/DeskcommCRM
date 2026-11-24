"use client";
/**
 * O histórico de execuções DE UMA automação (fase 4, 4.1), dentro do editor.
 *
 * Lê a rota que já existia (`GET /api/v1/automation-rules/[id]/runs`) — a aba
 * Atividade mostra as execuções de todas as regras juntas; aqui é a da regra que
 * está aberta, para quem a ajusta ver o efeito sem trocar de aba.
 */
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import type { AutomationRuleRunRow } from "@/hooks/webhooks/useAutomationRules";
import { apiClient } from "@/lib/api/client";

import { ACTION_LABELS, type ActionType } from "./labels";

const LIMITE = 20;

const ROTULO_DO_STATUS: Record<AutomationRuleRunRow["status"], string> = {
  success: "Sucesso",
  failed: "Falhou",
  partial: "Parcial",
  adiado: "Aguardando envio",
};

function variante(status: AutomationRuleRunRow["status"]): "success" | "error" | "warning" | "info" {
  if (status === "success") return "success";
  if (status === "failed") return "error";
  if (status === "adiado") return "info";
  return "warning";
}

export function HistoricoDaAutomacao({ ruleId }: { ruleId: string }) {
  const t = useT();
  const locale = useLocaleDeData();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["automation-rule-runs", ruleId],
    staleTime: 15_000,
    queryFn: async () =>
      apiClient.get<{ data: AutomationRuleRunRow[] }>(`/api/v1/automation-rules/${ruleId}/runs?limit=${LIMITE}`),
  });
  const execucoes = data?.data ?? [];

  return (
    <section aria-labelledby="historico-da-automacao" className="space-y-2">
      <h3 id="historico-da-automacao" className="text-base font-semibold text-text">
        {t("Histórico de execuções")}
      </h3>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="text-sm text-text-muted">{t("Não foi possível carregar o histórico agora.")}</p>
      ) : execucoes.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhuma execução ainda.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {execucoes.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <Badge variant={variante(run.status)}>{t(ROTULO_DO_STATUS[run.status] ?? run.status)}</Badge>
              <span className="text-text-muted">
                {formatDistanceToNowStrict(new Date(run.created_at), { addSuffix: true, locale })}
              </span>
              <span className="min-w-0 flex-1 truncate text-text">
                {(run.actions_result ?? [])
                  .map((a) => t(ACTION_LABELS[a.type as ActionType] ?? a.type))
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-muted">{t("O detalhe de cada execução fica na aba Atividade.")}</p>
    </section>
  );
}
