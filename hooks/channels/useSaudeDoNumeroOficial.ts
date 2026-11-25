"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

/** A saúde do número oficial (item 5.5) — o que `GET /api/v1/channels/official/saude` devolve. */
export interface SaudeDoNumeroOficial {
  conectado: boolean;
  saude: {
    channel_session_id: string;
    qualidade: "GREEN" | "YELLOW" | "RED" | "UNKNOWN" | null;
    limite: string | null;
    /** Conversas por 24h; `null` com `sem_limite: false` = degrau desconhecido. */
    conversas_por_dia: number | null;
    sem_limite: boolean;
    evento_da_conta: string | null;
    atualizada_em: string | null;
  } | null;
  leitura: { origem: "guardada" | "graph"; erro: string | null } | null;
}

const CHAVE = ["official-channel", "saude"] as const;

export function useSaudeDoNumeroOficial(habilitado = true) {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      apiClient.get<{ data: SaudeDoNumeroOficial }>("/api/v1/channels/official/saude"),
    enabled: habilitado,
    staleTime: 60_000,
  });
}

/** "Atualizar agora": pergunta à Meta mesmo com a leitura recente. */
export function useAtualizarSaudeDoNumeroOficial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiClient.get<{ data: SaudeDoNumeroOficial }>("/api/v1/channels/official/saude?atualizar=1"),
    onError: showApiError,
    onSuccess: (r) => {
      qc.setQueryData(CHAVE, r);
    },
  });
}
