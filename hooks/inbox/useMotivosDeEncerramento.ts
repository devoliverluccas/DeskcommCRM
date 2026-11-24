"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { MotivoDeEncerramento } from "@/lib/atendimento/motivos-de-encerramento";

export interface ListaDeMotivos {
  motivos: MotivoDeEncerramento[];
  motivo_obrigatorio_ao_encerrar: boolean;
}

export const CHAVE_DOS_MOTIVOS = ["motivos-de-encerramento"] as const;

/**
 * Os motivos de encerramento da organização e a exigência (fase 3, item 3.2).
 * `enabled` deixa o diálogo de fechar buscar só quando abre.
 */
export function useMotivosDeEncerramento(enabled: boolean) {
  return useQuery({
    queryKey: CHAVE_DOS_MOTIVOS,
    queryFn: async () =>
      (await apiClient.get<{ data: ListaDeMotivos }>("/api/v1/motivos-de-encerramento")).data,
    enabled,
    staleTime: 60_000,
  });
}
