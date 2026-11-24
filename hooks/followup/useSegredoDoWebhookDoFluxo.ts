import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * O segredo com que o nó "Webhook" do fluxo assina cada envio (4.3). Só busca
 * quando a pessoa pede para ver (`ligado`): o segredo não vem junto do fluxo, e
 * abrir o editor não pode expô-lo na tela de quem só passou por ali.
 */
export function useSegredoDoWebhookDoFluxo(flowId: string | undefined, ligado: boolean) {
  return useQuery({
    queryKey: ["followup-flows", flowId, "webhook-secret"],
    enabled: ligado && !!flowId,
    queryFn: async () =>
      (
        await apiClient.get<{ data: { segredo: string } }>(
          `/api/v1/ai/followup-flows/${flowId}/webhook-secret`,
        )
      ).data.segredo,
    staleTime: Infinity,
  });
}
