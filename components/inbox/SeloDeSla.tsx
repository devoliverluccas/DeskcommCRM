"use client";

/**
 * O SELO DE SLA (fase 3, item 3.3) — na linha da lista e no cabeçalho da conversa.
 *
 * ## De onde vêm as metas
 *
 * De `ProvedorDoSla`, UM por lista: um `useQuery` por linha seria 50 assinaturas
 * para a mesma pergunta org-wide (a mesma razão do `automaticoDaOrg` da linha), e
 * a linha é renderizada sem `QueryClientProvider` em vários testes do repo. Sem
 * provedor o selo não aparece — que é a tela de antes desta fatia.
 *
 * O provedor também é o RELÓGIO: um tique a cada 30 s re-renderiza os selos, e
 * só existe quando a organização tem alguma meta.
 *
 * ## Quando aparece
 *
 * Na lista, só quando importa: a partir de 80% do prazo (discreto, tom de aviso)
 * e estourado (destaque de erro). No cabeçalho (`sempre`), também dentro do prazo,
 * em tom neutro — quem abriu a conversa quer saber quanto falta.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { estadoDoSla, type Expediente, type FatosDoSla } from "@/lib/inbox/sla";
import { metasDoSetor, SEM_METAS_DE_SLA, temMetaDeSla, type MetasDoSla } from "@/lib/schemas/settings";
import { ClockCountdown } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

export interface ValorDoSla {
  metas: MetasDoSla;
  expedientes: Readonly<Record<string, Expediente>>;
  agora: Date;
}

const ContextoDoSla = createContext<ValorDoSla | null>(null);

/** O que o provedor lê da rota — exportado para o teste e para quem semeia o cache. */
export const CHAVE_DAS_METAS_DO_SLA = ["settings", "sla"] as const;

/** Intervalo do relógio dos selos. */
const TIQUE_MS = 30_000;

/**
 * Monte UMA vez em volta da lista de conversas (e do cabeçalho, se ele estiver
 * fora da lista). Precisa de `QueryClientProvider` acima.
 */
export function ProvedorDoSla({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: CHAVE_DAS_METAS_DO_SLA,
    queryFn: async () =>
      (
        await apiClient.get<{ data: { metas: MetasDoSla; expedientes: Record<string, Expediente> } }>(
          "/api/v1/settings/sla",
        )
      ).data,
    staleTime: 5 * 60_000,
  });
  // Resposta sem `metas` (servidor de antes da 9483, ou erro tratado) = sem
  // meta: o selo some em vez de derrubar a Inbox inteira.
  const ligado = data?.metas ? temMetaDeSla(data.metas) : false;
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    if (!ligado) return;
    const id = setInterval(() => setAgora(new Date()), TIQUE_MS);
    return () => clearInterval(id);
  }, [ligado]);

  const valor = useMemo<ValorDoSla | null>(
    () =>
      data && ligado
        ? { metas: data.metas ?? SEM_METAS_DE_SLA, expedientes: data.expedientes ?? {}, agora }
        : null,
    [data, ligado, agora],
  );
  return <ContextoDoSla.Provider value={valor}>{children}</ContextoDoSla.Provider>;
}

/** Para teste e para quem já tem as metas na mão (sem buscar). */
export const ProvedorDoSlaFixo = ContextoDoSla.Provider;

/** O estado do SLA desta conversa, ou `null` (sem provedor, sem meta, encerrada, ignorada). */
export function useSlaDaConversa(conversa: FatosDoSla) {
  const valor = useContext(ContextoDoSla);
  const t = useT();
  if (!valor) return null;
  return estadoDoSla({
    conversa,
    metas: metasDoSetor(valor.metas, conversa.sector_id),
    agora: valor.agora,
    expediente: conversa.sector_id ? valor.expedientes[conversa.sector_id] : null,
    t,
  });
}

/** A organização tem meta de SLA? Para o item "Ignorar SLA" do menu ⋯ aparecer só quando faz sentido. */
export function useHaMetaDeSla(): boolean {
  return useContext(ContextoDoSla) !== null;
}

export function SeloDeSla({
  conversa,
  sempre = false,
  className,
}: {
  conversa: FatosDoSla;
  /** Mostra também dentro do prazo (cabeçalho). Na lista, só ≥ 80% e estourado. */
  sempre?: boolean;
  className?: string;
}) {
  const t = useT();
  const estado = useSlaDaConversa(conversa);
  if (!estado) return null;
  if (!sempre && !estado.perto) return null;

  const meta = estado.tipo === "primeira_resposta" ? t("Primeira resposta") : t("Resolução");
  const descricao = estado.estourado
    ? `${meta}: ${t("prazo estourado")} (${estado.rotulo})`
    : `${meta}: ${estado.rotulo}`;

  return (
    <span
      data-testid="selo-sla"
      data-estado={estado.estourado ? "estourado" : estado.perto ? "perto" : "dentro"}
      title={descricao}
      aria-label={descricao}
      role="img"
      className={cn(
        "inline-flex h-4 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10px] tabular-nums",
        estado.estourado
          ? "bg-error-bg font-medium text-error-fg"
          : estado.perto
            ? "text-warning-fg"
            : "text-text-muted",
        className,
      )}
    >
      <ClockCountdown size={10} weight={estado.estourado ? "fill" : "regular"} aria-hidden />
      {estado.rotulo}
    </span>
  );
}

/**
 * Ignorar / retomar o SLA desta conversa (manager+; a rota recusa os outros).
 * Para o menu ⋯ do cabeçalho: `ignorar(true)` tira da conta, `ignorar(false)` devolve.
 */
export function useIgnorarSla(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ignorar: boolean) =>
      (
        await apiClient.post<{ data: { sla_ignorado_em: string | null } }>(
          `/api/v1/conversations/${conversationId}/sla`,
          { ignorar },
        )
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
  });
}
