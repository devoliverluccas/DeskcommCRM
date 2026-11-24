"use client";

/**
 * OS ORÇAMENTOS DO CONTATO DA CONVERSA (fase 2, itens 2.1 e 2.2).
 *
 * Lê `GET /api/v1/proposals?contact_id=` — a mesma rota da tela Propostas, com
 * o filtro do contato. A chave é exportada para a gaveta "Novo orçamento"
 * (`OrcamentoDaConversa`) invalidar depois de salvar ou enviar: a lista do
 * painel e a gaveta falam da mesma coisa, e uma não pode ficar velha a um palmo
 * da outra.
 *
 * Sem a capacidade `propostas` ligada a rota responde 404 — `ligado: false`
 * desliga a consulta, e quem monta a lista decide pela capacidade antes.
 */
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import type { ProposalStatus } from "@/lib/propostas/tipos";

export interface PropostaDoContato {
  id: string;
  lead_id: string | null;
  titulo: string;
  status: ProposalStatus;
  total_cents: number;
  moeda: string;
  numero: number | null;
  ano: number | null;
  versao: number;
  created_at: string;
  sent_at: string | null;
  decided_at: string | null;
  decided_via: "equipe" | "cliente" | null;
}

export function chaveDasPropostasDoContato(contactId: string | null) {
  return ["propostas-do-contato", contactId] as const;
}

export function usePropostasDaConversa(contactId: string | null, ligado = true) {
  return useQuery({
    queryKey: chaveDasPropostasDoContato(contactId),
    enabled: ligado && contactId !== null,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<PropostaDoContato[]> => {
      const res = await apiClient.get<ApiSuccess<PropostaDoContato[]>>(
        `/api/v1/proposals?contact_id=${encodeURIComponent(contactId ?? "")}`,
        { signal },
      );
      return res.data ?? [];
    },
  });
}

/** "0012/2026 v2" — ou `null` em rascunho, que ainda não tem número. */
export function numeroDaProposta(p: Pick<PropostaDoContato, "numero" | "ano" | "versao">): string | null {
  if (p.numero === null || p.ano === null) return null;
  return `${String(p.numero).padStart(4, "0")}/${p.ano}${p.versao > 1 ? ` v${p.versao}` : ""}`;
}
