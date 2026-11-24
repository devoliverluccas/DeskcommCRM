/**
 * AS TRAVAS DE ETAPA — o que precisa EXISTIR ligado ao negócio para ele entrar
 * numa etapa (item 2.3 da fase 2).
 *
 * ─── Onde a regra mora ─────────────────────────────────────────────────────
 *
 * A declaração é `crm_pipelines.settings.requisitos_por_etapa`
 * (`{ [stageId]: [{ tipo }] }`, schema em `lib/schemas/settings.ts`). A
 * APLICAÇÃO continua sendo uma só: `validaCamposExigidos`
 * (`lib/leads/campos-exigidos.ts`) junta os requisitos que faltam ao mesmo
 * `faltando` dos campos, com `tipo: "requisito"`. Este módulo só responde duas
 * perguntas: "o que esta etapa pede?" (pura) e "o que este negócio já tem?"
 * (consulta).
 *
 * ─── Como a consulta chega a todos os caminhos ─────────────────────────────
 *
 * `validaCamposExigidos` é síncrona e roda até no navegador; a consulta não
 * cabe nela. Ela viaja no MESMO conjunto que já leva os anexos lidos do banco
 * (`camposComAnexo`), com a marca `requisito:<tipo>` — o caractere `:` não
 * existe em chave de campo (`chaveDeCampoDoFunilSchema`), então as duas
 * famílias nunca colidem. Todo caminho que move um negócio que JÁ EXISTE (o
 * arrasto, o lote, a IA, a agenda, o handoff, a transferência, o encerramento)
 * já chama `camposComAnexo` — e passa a cobrar o requisito sem mudar uma linha.
 *
 * ─── Compatibilidade ───────────────────────────────────────────────────────
 *
 * Funil sem `requisitos_por_etapa` devolve lista vazia aqui, não faz consulta
 * nenhuma e valida exatamente como antes (o critério de aceite nº 3 da #1536).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import {
  TIPOS_DE_REQUISITO_DA_ETAPA,
  requisitoDaEtapaSchema,
  type TipoDeRequisitoDaEtapa,
} from "@/lib/schemas/settings";

export { TIPOS_DE_REQUISITO_DA_ETAPA, type TipoDeRequisitoDaEtapa };

/**
 * O rótulo que a pessoa lê, em português — a tela e a recusa passam por
 * `t()`/`traduzir()`. É ele que vai em `faltando[].rotulo`.
 */
export const ROTULO_DO_REQUISITO: Readonly<Record<TipoDeRequisitoDaEtapa, string>> = {
  orcamento_vinculado: "Orçamento vinculado ao negócio",
  agendamento_marcado: "Agendamento marcado",
  tarefa_concluida: "Tarefa concluída",
};

/** O `tipo` que um item de `faltando` leva quando é requisito, não campo. */
export const TIPO_DO_ITEM_REQUISITO = "requisito" as const;

/** A marca do requisito atendido dentro do conjunto de `camposComAnexo`. */
export function marcaDoRequisito(tipo: TipoDeRequisitoDaEtapa): string {
  return `requisito:${tipo}`;
}

function comoRecord(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/** Lê uma lista crua de requisitos item a item: o torto sai, o certo fica, sem repetição. */
function lerLista(bruto: unknown): TipoDeRequisitoDaEtapa[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<TipoDeRequisitoDaEtapa>();
  for (const item of bruto) {
    const lido = requisitoDaEtapaSchema.safeParse(item);
    if (lido.success) vistos.add(lido.data.tipo);
  }
  // Ordem estável = a do vocabulário, não a de gravação: a tela e a recusa
  // listam sempre igual, venha o jsonb na ordem que vier.
  return TIPOS_DE_REQUISITO_DA_ETAPA.filter((tipo) => vistos.has(tipo));
}

/** O que ESTA etapa pede para alguém entrar nela. Etapa desconhecida ou lixo = nada. */
export function requisitosDaEtapa(
  settingsDoFunil: unknown,
  stageId: string | null | undefined,
): TipoDeRequisitoDaEtapa[] {
  if (!stageId) return [];
  const mapa = comoRecord(comoRecord(settingsDoFunil).requisitos_por_etapa);
  return lerLista(mapa[stageId]);
}

/** O mapa inteiro, já limpo — o que a tela de configuração edita. */
export function requisitosPorEtapa(
  settingsDoFunil: unknown,
): Record<string, TipoDeRequisitoDaEtapa[]> {
  const mapa = comoRecord(comoRecord(settingsDoFunil).requisitos_por_etapa);
  const limpo: Record<string, TipoDeRequisitoDaEtapa[]> = {};
  for (const [stageId, bruto] of Object.entries(mapa)) {
    const lista = lerLista(bruto);
    if (lista.length > 0) limpo[stageId] = lista;
  }
  return limpo;
}

/** Todos os tipos que ALGUMA etapa do funil pede — para quem não sabe o destino. */
export function requisitosDoFunil(settingsDoFunil: unknown): TipoDeRequisitoDaEtapa[] {
  const todos = new Set(Object.values(requisitosPorEtapa(settingsDoFunil)).flat());
  return TIPOS_DE_REQUISITO_DA_ETAPA.filter((tipo) => todos.has(tipo));
}

/** "Mover mesmo assim" está ligado neste funil? Só o `true` explícito liga. */
export function permiteMoverMesmoAssim(settingsDoFunil: unknown): boolean {
  return comoRecord(settingsDoFunil).permitir_mover_mesmo_assim === true;
}

/** Status de proposta que contam como "orçamento vinculado": já saiu para o cliente. */
const STATUS_DE_ORCAMENTO_VALIDO = ["enviada", "aceita"] as const;

/**
 * Status de compromisso que contam: `cancelled` e `no_show` nunca. `pending`
 * (só solicitado) conta se ainda vai acontecer; `confirmed` e `completed`
 * contam sempre — o confirmado que já passou aconteceu, só ninguém marcou.
 */
const STATUS_DE_AGENDAMENTO_CANDIDATO = ["pending", "confirmed", "completed"] as const;

interface EntradaDaConsulta {
  organizationId: string;
  leadId: string;
  /**
   * O contato do negócio — a agenda liga compromisso a CONTATO
   * (`calendar_appointments.contact_id`). Ausente, é lido do lead, e só quando
   * `agendamento_marcado` foi pedido.
   */
  contactId?: string | null;
  tipos: readonly TipoDeRequisitoDaEtapa[];
  /** Relógio injetável para teste. */
  agora?: Date;
}

/**
 * Quais dos `tipos` pedidos este negócio JÁ cumpre.
 *
 * Uma consulta por tipo pedido e nenhuma quando a lista é vazia.
 * `organization_id` vai explícito em todas: metade dos chamadores usa o
 * cliente admin, que passa por cima da RLS.
 *
 * Falha FECHADA, como os anexos: sem a leitura, o requisito conta como não
 * cumprido e a escrita é recusada com a lista do que falta — melhor pedir de
 * novo do que deixar o negócio entrar sem o que a etapa exige.
 */
export async function requisitosAtendidos(
  supabase: SupabaseClient,
  entrada: EntradaDaConsulta,
): Promise<Set<TipoDeRequisitoDaEtapa>> {
  const atendidos = new Set<TipoDeRequisitoDaEtapa>();
  const pedidos = new Set(entrada.tipos);
  const avisa = (tipo: TipoDeRequisitoDaEtapa, erro: unknown) =>
    logger.warn("[requisitos-da-etapa] leitura falhou; o requisito conta como não cumprido", {
      leadId: entrada.leadId,
      tipo,
      erro: erro instanceof Error ? erro.message : String((erro as { message?: unknown })?.message ?? erro),
    });

  if (pedidos.has("orcamento_vinculado")) {
    try {
      const { data, error } = await supabase
        .from("crm_proposals")
        .select("id")
        .eq("organization_id", entrada.organizationId)
        .eq("lead_id", entrada.leadId)
        .in("status", [...STATUS_DE_ORCAMENTO_VALIDO])
        .limit(1);
      if (error) avisa("orcamento_vinculado", error);
      else if ((data ?? []).length > 0) atendidos.add("orcamento_vinculado");
    } catch (erro) {
      avisa("orcamento_vinculado", erro);
    }
  }

  if (pedidos.has("tarefa_concluida")) {
    try {
      const { data, error } = await supabase
        .from("crm_tasks")
        .select("id")
        .eq("organization_id", entrada.organizationId)
        .eq("lead_id", entrada.leadId)
        .eq("status", "done")
        .limit(1);
      if (error) avisa("tarefa_concluida", error);
      else if ((data ?? []).length > 0) atendidos.add("tarefa_concluida");
    } catch (erro) {
      avisa("tarefa_concluida", erro);
    }
  }

  if (pedidos.has("agendamento_marcado")) {
    try {
      let contactId = entrada.contactId;
      if (contactId === undefined) {
        const { data } = await supabase
          .from("crm_leads")
          .select("contact_id")
          .eq("organization_id", entrada.organizationId)
          .eq("id", entrada.leadId)
          .maybeSingle();
        contactId = (data as { contact_id?: string | null } | null)?.contact_id ?? null;
      }
      if (contactId) {
        const { data, error } = await supabase
          .from("calendar_appointments")
          .select("status, starts_at")
          .eq("organization_id", entrada.organizationId)
          .eq("contact_id", contactId)
          .in("status", [...STATUS_DE_AGENDAMENTO_CANDIDATO])
          .order("starts_at", { ascending: false })
          .limit(50);
        if (error) {
          avisa("agendamento_marcado", error);
        } else {
          const agora = (entrada.agora ?? new Date()).getTime();
          const algum = ((data ?? []) as { status: string; starts_at: string }[]).some(
            (linha) =>
              linha.status === "completed" ||
              linha.status === "confirmed" ||
              (linha.status === "pending" && new Date(linha.starts_at).getTime() >= agora),
          );
          if (algum) atendidos.add("agendamento_marcado");
        }
      }
    } catch (erro) {
      avisa("agendamento_marcado", erro);
    }
  }

  return atendidos;
}
