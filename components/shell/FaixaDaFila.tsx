"use client";

import Link from "next/link";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import { useT } from "@/hooks/i18n/useT";
import { roleAtLeast } from "@/lib/auth/types";
import { haQuantoTempo } from "@/lib/inbox/painel-de-atendimento";

/** A aba Fila do Inbox (`FILTER_TABS` em `components/inbox/InboxLayout.tsx`). */
export const ENDERECO_DA_FILA = "/app/inbox?filter=unassigned";

/** Quantas filas a faixa nomeia antes de parar: é uma linha, não um painel. */
const FILAS_NA_FAIXA = 3;

/**
 * A FILA NO TOPO DE TODA TELA: "● 3 na fila · mais antigo há 3 d · Vendas 3 · Ver fila".
 *
 * O número ao lado de "Inbox" no menu (`ContadorDaFila`) diz QUANTAS conversas
 * esperam; esta faixa diz também HÁ QUANTO TEMPO e EM QUE FILA — o que faz quem
 * está no Kanban ou nos Contatos largar o que está fazendo.
 *
 * Lê a MESMA consulta do contador (sem filtros, a chave do React Query é a
 * mesma): nenhuma ida a mais ao servidor por estar no topo de toda tela.
 *
 * Some com a fila vazia, e só aparece para quem pode pegar conversa (agent+).
 * Abaixo de `md` não aparece: a barra inferior do celular já tem o contador.
 */
export function FaixaDaFila() {
  const { activeOrg } = useAuth();
  if (!roleAtLeast(activeOrg?.role, "agent")) return null;
  return <FaixaDaFilaDeQuemAtende orgId={activeOrg?.orgId ?? null} />;
}

function FaixaDaFilaDeQuemAtende({ orgId }: { orgId: string | null }) {
  const t = useT();
  const { data } = useConversationCounts(orgId);
  const esperando = data?.fila ?? data?.unassigned ?? 0;
  if (!esperando) return null;

  const desde = data?.fila_mais_antiga_desde ?? null;
  const setores = (data?.setores ?? []).slice(0, FILAS_NA_FAIXA);

  return (
    <Link
      href={ENDERECO_DA_FILA}
      data-testid="faixa-da-fila"
      className="group hidden h-11 min-w-0 items-center rounded-md px-2 text-xs whitespace-nowrap text-text-muted transition-colors duration-fast hover:bg-hover hover:text-text md:flex lg:h-8"
    >
      <span aria-hidden className="mr-2 h-2 w-2 shrink-0 rounded-full bg-warning" />
      <span className="shrink-0 font-medium text-text tabular-nums">
        {esperando} {t("na fila")}
      </span>
      {desde && (
        <span data-testid="faixa-da-fila-espera" className="hidden shrink-0 lg:inline">
          <Separador />
          {t("mais antigo há")} <span className="tabular-nums">{haQuantoTempo(desde)}</span>
        </span>
      )}
      {setores.length > 0 && (
        <span className="hidden min-w-0 truncate xl:inline" data-testid="faixa-da-fila-setores">
          <Separador />
          {setores.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              {s.nome} <span className="tabular-nums">{s.na_fila}</span>
            </span>
          ))}
        </span>
      )}
      <span className="shrink-0 text-text-subtle group-hover:text-text">
        <Separador />
        {t("Ver fila")}
        <span aria-hidden> →</span>
      </span>
    </Link>
  );
}

function Separador() {
  return (
    <span aria-hidden className="px-1.5 text-text-subtle">
      ·
    </span>
  );
}
