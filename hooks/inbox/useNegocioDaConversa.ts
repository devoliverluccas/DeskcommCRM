"use client";

/**
 * O NEGÓCIO DA CONVERSA — leitura e gestos da faixa do topo (`FaixaDoNegocio`).
 *
 * ─── De onde vem ─────────────────────────────────────────────────────────────
 *
 * Da MESMA rota do painel do contato: `GET /api/v1/contacts/[id]/crm-summary`,
 * que devolve por negócio a etapa atual (`stage_id`), as etapas ativas do funil
 * na ordem do quadro (`etapas_do_funil`) e os motivos de perda. O painel guarda
 * essa leitura em `useState`; aqui ela vai para o react-query, com a chave
 * `["crm-summary", contactId]`, para a faixa poder pedir de novo depois de agir.
 *
 * ─── Como move ───────────────────────────────────────────────────────────────
 *
 * Pelo caminho da página do negócio (`app/app/leads/[id]/pagina/_pagina.tsx`):
 * relê a linha (`GET /api/v1/leads/{id}`) para ter o `expected_updated_at`
 * fresco, e chama `useMoveCard` — `POST /api/v1/leads/{id}/move`, não
 * `/leads/bulk`. As recusas viram os mesmos diálogos: campos obrigatórios,
 * motivo da perda (pedido ANTES de escrever) e a retomada como novo negócio.
 *
 * `useMoveCard` mexe no cache `["board", pipelineId]`. Sem o quadro montado esse
 * cache não existe, e o hook já o trata: o `onMutate` só escreve quando há
 * snapshot e o `setQueryData` com updater devolve `undefined` sem criar nada.
 * Quem precisa ser relido aqui é o resumo — e ele é.
 *
 * ─── Quando relê ─────────────────────────────────────────────────────────────
 *
 * Depois de cada gesto da faixa, e também depois de qualquer mutação BEM
 * SUCEDIDA que toque um negócio deste contato (o seletor de etapa do painel, o
 * "Novo negócio" de lá, o motivo de perda): `mutacaoMexeNoNegocio` decide pelas
 * variáveis da mutação. Sem isso, mover pelo painel deixaria a faixa dizendo a
 * etapa velha a um palmo de distância.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useT } from "@/hooks/i18n/useT";
import {
  useMoveCard,
  type MoveArgs,
  type RecusaDeCampos,
  type RetomadaPendente,
} from "@/hooks/kanban/useMoveCard";
import { useWinLead } from "@/hooks/kanban/useUpdateLead";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { decideMotivoDaPerda } from "@/lib/leads/motivo-da-perda";
import type { Lead } from "@/lib/types/leads";

export interface EtapaDoFunil {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
}

/** O recorte do negócio que a faixa lê do `crm-summary`. */
export interface NegocioDoResumo {
  id: string;
  title: string;
  status: string;
  value_cents: number | null;
  currency: string | null;
  updated_at: string;
  pipeline_id: string;
  stage_id?: string;
  funil_nome: string | null;
  etapa_nome: string | null;
  etapas_do_funil?: EtapaDoFunil[];
  motivos_de_perda?: string[];
}

export function chaveDoResumoDoContato(contactId: string | null) {
  return ["crm-summary", contactId] as const;
}

/**
 * Os negócios ABERTOS, na ordem da rota — `updated_at` decrescente, então o
 * primeiro é o mais recente. A rota pode pôr um negócio relacionado aberto na
 * frente (#3669); a ordem dela é a regra, não é reordenada aqui.
 */
export function negociosAbertos(
  leads: readonly NegocioDoResumo[] | null | undefined,
): NegocioDoResumo[] {
  return (leads ?? []).filter((l) => l.status === "open");
}

/**
 * As etapas por onde as SETAS andam: as do quadro, sem as de desfecho. Ganho e
 * perda têm botão próprio — e perda pede motivo, então uma seta que caísse
 * nela abriria um diálogo no meio de um "avançar".
 */
export function etapasDoCaminho(etapas: readonly EtapaDoFunil[] | undefined): EtapaDoFunil[] {
  return (etapas ?? []).filter((e) => !e.is_won && !e.is_lost);
}

/** A etapa vizinha no caminho (`delta` −1 ou +1), ou `null` na ponta. */
export function etapaVizinha(
  etapas: readonly EtapaDoFunil[] | undefined,
  stageId: string | undefined,
  delta: -1 | 1,
): EtapaDoFunil | null {
  const caminho = etapasDoCaminho(etapas);
  const idx = caminho.findIndex((e) => e.id === stageId);
  if (idx < 0) return null;
  return caminho[idx + delta] ?? null;
}

/**
 * Esta mutação mexeu num negócio deste contato? Lê só as VARIÁVEIS: `leadId`
 * (mover, ganhar, perder, editar), `lead_ids` (o "Mover para…" em lote, que é
 * o seletor do painel) e `contact_id` (criar negócio para o contato). Mutação
 * de mensagem, de conversa ou de outro contato não relê o resumo — ele é a
 * leitura mais lenta do Inbox.
 */
export function mutacaoMexeNoNegocio(
  variaveis: unknown,
  contexto: { contactId: string; leadIds: readonly string[] },
): boolean {
  if (!variaveis || typeof variaveis !== "object") return false;
  const v = variaveis as Record<string, unknown>;
  if (typeof v.leadId === "string" && contexto.leadIds.includes(v.leadId)) return true;
  if (
    Array.isArray(v.lead_ids) &&
    v.lead_ids.some((id) => typeof id === "string" && contexto.leadIds.includes(id))
  ) {
    return true;
  }
  return v.contact_id === contexto.contactId;
}

/**
 * A leitura fresca de UMA linha — a régua do `updated_at`. Mesmo envelope
 * tolerante da página do negócio. Sem leitura, a régua é a do resumo: o 409 do
 * servidor é uma resposta clara, e inventar `updated_at` seria pior.
 */
async function lerONegocio(leadId: string): Promise<Lead | null> {
  try {
    const res = await apiClient.get<{ data?: Lead } | Lead>(`/api/v1/leads/${leadId}`);
    if (res && typeof res === "object" && "data" in res)
      return (res as { data?: Lead }).data ?? null;
    return (res as Lead) ?? null;
  } catch {
    return null;
  }
}

function faltandoDa(err: unknown): RecusaDeCampos["faltando"] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  const faltando = err.details?.faltando;
  return Array.isArray(faltando) && faltando.length > 0
    ? (faltando as RecusaDeCampos["faltando"])
    : null;
}

export function useNegocioDaConversa(contactId: string | null) {
  const t = useT();
  const qc = useQueryClient();
  const chave = useMemo(() => chaveDoResumoDoContato(contactId), [contactId]);

  const resumo = useQuery({
    queryKey: chave,
    enabled: Boolean(contactId),
    staleTime: 30_000,
    queryFn: async (): Promise<NegocioDoResumo[]> => {
      const r = await apiClient.get<{ data?: { leads?: NegocioDoResumo[] } }>(
        `/api/v1/contacts/${contactId}/crm-summary`,
      );
      return r?.data?.leads ?? [];
    },
  });

  const abertos = useMemo(() => negociosAbertos(resumo.data), [resumo.data]);
  const [escolhidoId, setEscolhidoId] = useState<string | null>(null);
  const negocio = abertos.find((l) => l.id === escolhidoId) ?? abertos[0] ?? null;
  const etapas = useMemo(() => negocio?.etapas_do_funil ?? [], [negocio]);

  /**
   * Relê o resumo. `cancelRefetch: false` porque o gesto da faixa e a escuta de
   * mutações abaixo podem pedir a MESMA releitura no mesmo instante: a segunda
   * pega carona na primeira em vez de cancelá-la e começar outra.
   */
  const reler = useCallback(() => {
    if (!contactId) return;
    void qc.invalidateQueries({ queryKey: chave }, { cancelRefetch: false });
  }, [contactId, chave, qc]);

  useEffect(() => {
    if (!contactId) return;
    return qc.getMutationCache().subscribe((evento) => {
      if (evento.type !== "updated" || evento.action.type !== "success") return;
      const leads = qc.getQueryData<NegocioDoResumo[]>(chave) ?? [];
      const mexeu = mutacaoMexeNoNegocio(evento.mutation.state.variables, {
        contactId,
        leadIds: leads.map((l) => l.id),
      });
      if (mexeu) reler();
    });
  }, [contactId, chave, qc, reler]);

  const [recusa, setRecusa] = useState<RecusaDeCampos | null>(null);
  const [retomada, setRetomada] = useState<RetomadaPendente | null>(null);
  /** O move para a etapa de PERDA, à espera do motivo. */
  const [perda, setPerda] = useState<MoveArgs | null>(null);
  /**
   * A etapa que a faixa mostra enquanto o servidor responde e o resumo volta.
   * Sem ela, a etapa voltaria para a antiga entre o 200 do move e a releitura —
   * um segundo em que a tela desdiz o clique. Vale até o resumo mudar
   * (`desde` é o carimbo da leitura em que ela nasceu) ou o move falhar.
   */
  const [otimista, setOtimista] = useState<{
    leadId: string;
    stageId: string;
    desde: number;
  } | null>(null);

  const pipelineId = negocio?.pipeline_id ?? "";
  const moveCard = useMoveCard(pipelineId, {
    onCamposFaltando: setRecusa,
    onRetomada: setRetomada,
  });
  // O diálogo de campos abre aqui (onError do `marcarGanho`): sem toast em dobro.
  const ganhar = useWinLead(pipelineId, { camposPeloChamador: true });

  const mover = useCallback(
    (args: MoveArgs) => {
      setOtimista({ leadId: args.leadId, stageId: args.stageId, desde: resumo.dataUpdatedAt });
      moveCard.mutate(args, {
        onSuccess: () => {
          toast.success(t("Etapa atualizada."));
          reler();
        },
        onError: () => setOtimista(null),
      });
    },
    [moveCard, resumo.dataUpdatedAt, reler, t],
  );

  const mudarEtapa = useCallback(
    async (stageId: string) => {
      if (!negocio || stageId === negocio.stage_id) return;
      const etapa = etapas.find((e) => e.id === stageId);
      if (!etapa) return;

      const fresco = await lerONegocio(negocio.id);
      const regua = fresco?.updated_at ?? negocio.updated_at;
      const motivoAtual =
        fresco && (fresco.status === "lost" || fresco.stage_id === stageId)
          ? fresco.lost_reason
          : null;

      // A etapa de PERDA pede o motivo ANTES de escrever (`decideMotivoDaPerda`,
      // a decisão do quadro). O move sai do diálogo, com o motivo dentro.
      if (!decideMotivoDaPerda({ etapaDeDestino: etapa, motivoAtual }).ok) {
        setPerda({ leadId: negocio.id, stageId, expectedUpdatedAt: regua });
        return;
      }
      // Sem `positionInStage`: a faixa não tem a coluna; o servidor posiciona
      // pela régua de entrada (#3461).
      mover({ leadId: negocio.id, stageId, expectedUpdatedAt: regua });
    },
    [negocio, etapas, mover],
  );

  const andar = useCallback(
    (delta: -1 | 1) => {
      const alvo = etapaVizinha(etapas, negocio?.stage_id, delta);
      if (alvo) void mudarEtapa(alvo.id);
    },
    [etapas, negocio?.stage_id, mudarEtapa],
  );

  /**
   * GANHO pela rota do card (`useWinLead`, `POST /leads/{id}/win`). Quando o
   * funil exige campos ou o motivo do ganho, a rota recusa com o MESMO contrato
   * `faltando` do move — e a resposta é o diálogo de campos, que reenvia como
   * move para a etapa de ganho (é o move que leva campos e motivo na mesma
   * escrita; o `/win` só aceita o motivo).
   */
  const marcarGanho = useCallback(() => {
    if (!negocio) return;
    const alvo = negocio;
    ganhar.mutate(
      { leadId: alvo.id },
      {
        onSuccess: () => {
          toast.success(t("Negócio marcado como ganho."));
          setEscolhidoId(null);
          reler();
        },
        onError: async (err) => {
          const faltando = faltandoDa(err);
          const etapaDeGanho = (alvo.etapas_do_funil ?? []).find((e) => e.is_won);
          if (!faltando || !etapaDeGanho) return;
          const fresco = await lerONegocio(alvo.id);
          setRecusa({
            args: {
              leadId: alvo.id,
              stageId: etapaDeGanho.id,
              expectedUpdatedAt: fresco?.updated_at ?? alvo.updated_at,
            },
            faltando,
          });
        },
      },
    );
  }, [negocio, ganhar, reler, t]);

  const confirmarCampos = useCallback(
    (valores: { customFields: Record<string, unknown>; wonReason?: string }) => {
      if (!recusa) return;
      const { args } = recusa;
      setRecusa(null);
      mover({
        ...args,
        customFields: valores.customFields,
        ...(valores.wonReason !== undefined ? { wonReason: valores.wonReason } : {}),
      });
    },
    [recusa, mover],
  );

  const confirmarPerda = useCallback(
    (lostReason: string) => {
      if (!perda) return;
      const args = perda;
      setPerda(null);
      // UMA escrita: o move com o motivo dentro, como no quadro.
      mover({ ...args, lostReason });
    },
    [perda, mover],
  );

  const etapaExibida =
    otimista && negocio && otimista.leadId === negocio.id && otimista.desde === resumo.dataUpdatedAt
      ? otimista.stageId
      : negocio?.stage_id;

  return {
    carregando: resumo.isPending && Boolean(contactId),
    falhou: resumo.isError,
    abertos,
    negocio,
    etapas,
    etapaExibida,
    escolherNegocio: setEscolhidoId,
    mudarEtapa,
    andar,
    marcarGanho,
    movendo: moveCard.isPending,
    ganhando: ganhar.isPending,
    reler,
    recusa,
    fecharRecusa: () => setRecusa(null),
    confirmarCampos,
    perda,
    fecharPerda: () => setPerda(null),
    confirmarPerda,
    retomada,
    fecharRetomada: () => {
      setRetomada(null);
      // A retomada cria o negócio novo por `apiClient` direto, fora de mutação:
      // a escuta acima não a vê, então a releitura é daqui.
      reler();
    },
  };
}
