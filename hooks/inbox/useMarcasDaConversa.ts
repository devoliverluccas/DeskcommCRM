"use client";
import { useCallback, useContext, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

/**
 * As três marcas do menu ⋯ da conversa (item 3.7): privada, pendente e o
 * bloqueio do contato.
 *
 * Mutação à mão, e não `useMutation`: o cabeçalho é montado em arquivos de teste
 * sem `QueryClientProvider`, e `useMutation`/`useQueryClient` lançam sem ele. Com
 * o provedor presente (o app), a lista, a conversa e as contagens são
 * invalidadas como nas outras ações do cabeçalho; sem ele, a escrita acontece e
 * o Realtime traz a linha nova.
 */
export interface Escrita<A> {
  executar: (args: A) => Promise<boolean>;
  pendente: boolean;
}

function useEscrita<A>(
  enviar: (args: A) => Promise<unknown>,
  chaves: (args: A) => ReadonlyArray<readonly unknown[]>,
): Escrita<A> {
  const qc = useContext(QueryClientContext);
  const [pendente, setPendente] = useState(false);
  const executar = useCallback(
    async (args: A) => {
      setPendente(true);
      try {
        await enviar(args);
        for (const queryKey of chaves(args)) void qc?.invalidateQueries({ queryKey });
        return true;
      } catch (erro) {
        showApiError(erro);
        return false;
      } finally {
        setPendente(false);
      }
    },
    [enviar, chaves, qc],
  );
  return { executar, pendente };
}

const chavesDaConversa = (args: { conversation_id: string }) =>
  [["conversations"], ["conversation", args.conversation_id], ["conversation-counts"]] as const;

/** Marca/desmarca a conversa como privada (`POST /conversations/[id]/privada`). */
export function usePrivadaDaConversa(): Escrita<{ conversation_id: string; privada: boolean }> {
  return useEscrita(
    useCallback(
      (a: { conversation_id: string; privada: boolean }) =>
        apiClient.post(`/api/v1/conversations/${a.conversation_id}/privada`, { privada: a.privada }),
      [],
    ),
    chavesDaConversa,
  );
}

/** Marca/tira de pendente (`POST /conversations/[id]/pendente`). */
export function usePendenteDaConversa(): Escrita<{ conversation_id: string; pendente: boolean }> {
  return useEscrita(
    useCallback(
      (a: { conversation_id: string; pendente: boolean }) =>
        apiClient.post(`/api/v1/conversations/${a.conversation_id}/pendente`, { pendente: a.pendente }),
      [],
    ),
    chavesDaConversa,
  );
}

/** Bloqueia o contato, com motivo (`POST /contacts/[id]/bloquear`, gestor+). */
export function useBloquearContato(): Escrita<{ contact_id: string; conversation_id: string; motivo: string }> {
  return useEscrita(
    useCallback(
      (a: { contact_id: string; conversation_id: string; motivo: string }) =>
        apiClient.post(`/api/v1/contacts/${a.contact_id}/bloquear`, { motivo: a.motivo }),
      [],
    ),
    useCallback(
      (a: { contact_id: string; conversation_id: string }) =>
        [["conversations"], ["conversation", a.conversation_id], ["contact", a.contact_id]] as const,
      [],
    ),
  );
}
