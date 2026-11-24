"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/** O sub-filtro da aba Mídias — o mesmo vocabulário do `?tipo=` da rota. */
export type FiltroDeMidia = "imagem" | "video" | "documento" | "audio";

/**
 * Um item da galeria, como `GET /api/v1/conversations/[id]/media` devolve.
 * Sem URL: o arquivo sai por `GET /api/v1/messages/{id}/media` (`mediaSrc`).
 */
export interface MidiaDaConversa {
  id: string;
  type: string;
  direction: "inbound" | "outbound";
  media_mime: string | null;
  media_size_bytes: number | null;
  media_storage_path: string | null;
  nome: string | null;
  sent_at: string;
}

interface PaginaDeMidias {
  data: MidiaDaConversa[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

/** Uma grade de 3 colunas fecha certinho em 24; a rota aceita até 60. */
export const MIDIAS_POR_PAGINA = 24;

/**
 * A galeria da conversa, por tipo, mais nova primeiro, paginada por cursor.
 *
 * `ativo` existe para a aba: a galeria só pergunta ao servidor quando alguém
 * abre Mídias — quem vive na aba Perfil não paga essa leitura a cada conversa.
 * Um filtro por chave: trocar de Fotos para Documentos e voltar não refaz a
 * primeira leitura dentro do `staleTime`.
 */
export function useMidiasDaConversa(
  conversationId: string | null,
  tipo: FiltroDeMidia,
  ativo = true,
) {
  return useInfiniteQuery({
    queryKey: ["conversa-midias", conversationId, tipo],
    enabled: Boolean(conversationId) && ativo,
    staleTime: 30_000,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ tipo, limit: String(MIDIAS_POR_PAGINA) });
      if (pageParam) qs.set("cursor", pageParam);
      return apiClient.get<PaginaDeMidias>(
        `/api/v1/conversations/${conversationId}/media?${qs.toString()}`,
      );
    },
    getNextPageParam: (ultima) =>
      ultima.meta?.has_more && ultima.meta.cursor ? ultima.meta.cursor : undefined,
  });
}
