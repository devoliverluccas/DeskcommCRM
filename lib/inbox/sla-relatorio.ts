/**
 * O SLA DE PRIMEIRA RESPOSTA PARA O RELATÓRIO — `% dentro do prazo` por período
 * e por setor.
 *
 * O banco entrega os atendimentos crus (`fn_sla_primeiras_respostas`, migration
 * 9483): quando o cliente escreveu pela primeira vez e quando veio a primeira
 * resposta. A conta do prazo é a MESMA do selo da lista: a meta do setor
 * (`metasDoSetor`) e o tempo de expediente (`tempoDeExpedienteMs`) — uma segunda
 * versão da régua em SQL deixaria o relatório dizendo "dentro" de uma conversa
 * que a lista pintou de vermelho.
 *
 * Quem não tem meta (nem do setor, nem da organização) fica FORA da conta, não
 * conta como "dentro": um 100% feito de conversas sem meta seria uma frase
 * tranquilizadora sobre nada. Atendimento ignorado por um gestor também fica fora.
 * Sem resposta ainda: se o prazo já venceu, é "fora"; se não, é "pendente" — e
 * pendente não entra na porcentagem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { metasDoSetor, metasDoSla, type MetasDoSla } from "@/lib/schemas/settings";

import { tempoDeExpedienteMs, type Expediente } from "./sla";

export interface LinhaDoSlaDePrimeiraResposta {
  conversation_id: string;
  service_revision: number | null;
  sector_id: string | null;
  inicio: string;
  respondida_em: string | null;
  ignorado: boolean;
}

export interface ContagemDoSla {
  /** Atendimentos com meta e já decididos (dentro + fora). */
  medidos: number;
  dentro: number;
  fora: number;
  /** Sem resposta e ainda no prazo — não entram na porcentagem. */
  pendentes: number;
  /** `dentro / medidos` em 0–100, ou `null` sem nenhum medido. */
  percentual_dentro: number | null;
}

export interface ResumoDoSlaDePrimeiraResposta extends ContagemDoSla {
  /** Uma linha por setor (`null` = conversas sem setor). */
  por_setor: Array<ContagemDoSla & { sector_id: string | null }>;
}

const vazia = (): ContagemDoSla => ({ medidos: 0, dentro: 0, fora: 0, pendentes: 0, percentual_dentro: null });

function fechar(c: ContagemDoSla): ContagemDoSla {
  return { ...c, percentual_dentro: c.medidos > 0 ? Math.round((c.dentro / c.medidos) * 1000) / 10 : null };
}

/** A conta, pura. */
export function agregarSlaDePrimeiraResposta(
  linhas: readonly LinhaDoSlaDePrimeiraResposta[],
  metas: MetasDoSla,
  expedientes: Readonly<Record<string, Expediente>>,
  agora: Date,
): ResumoDoSlaDePrimeiraResposta {
  const total = vazia();
  const porSetor = new Map<string | null, ContagemDoSla>();

  for (const l of linhas) {
    if (l.ignorado) continue;
    const meta = metasDoSetor(metas, l.sector_id).primeira_resposta_min;
    if (meta == null) continue;
    const prazoMs = meta * 60_000;
    const expediente = l.sector_id ? expedientes[l.sector_id] : null;
    const inicio = new Date(l.inicio);
    const fim = l.respondida_em ? new Date(l.respondida_em) : agora;
    const gasto = tempoDeExpedienteMs(inicio, fim, expediente);

    let destino: "dentro" | "fora" | "pendentes";
    if (l.respondida_em) destino = gasto <= prazoMs ? "dentro" : "fora";
    else destino = gasto > prazoMs ? "fora" : "pendentes";

    const doSetor = porSetor.get(l.sector_id) ?? vazia();
    for (const c of [total, doSetor]) {
      c[destino] += 1;
      if (destino !== "pendentes") c.medidos += 1;
    }
    porSetor.set(l.sector_id, doSetor);
  }

  return {
    ...fechar(total),
    por_setor: [...porSetor.entries()].map(([sector_id, c]) => ({ sector_id, ...fechar(c) })),
  };
}

/**
 * A leitura do servidor: metas, horários dos setores e os atendimentos do
 * período, numa chamada. Serve à sessão (a RLS corta) e ao service role (o
 * filtro de organização é explícito em toda consulta).
 *
 * `setorId` filtra o resultado depois da conta: o setor de um atendimento é o
 * setor ATUAL da conversa (o banco não guarda o setor de cada atendimento).
 */
export async function resumoDoSlaDePrimeiraResposta(
  supabase: SupabaseClient,
  opcoes: { organizationId: string; de: Date; ate: Date; setorId?: string | null; agora?: Date },
): Promise<ResumoDoSlaDePrimeiraResposta> {
  const { organizationId, de, ate } = opcoes;
  const [org, setores, linhas] = await Promise.all([
    supabase.from("organizations").select("settings").eq("id", organizationId).maybeSingle(),
    supabase.from("attendant_sectors").select("id, schedule").eq("organization_id", organizationId),
    supabase.rpc("fn_sla_primeiras_respostas", {
      p_organization_id: organizationId,
      p_de: de.toISOString(),
      p_ate: ate.toISOString(),
    }),
  ]);
  if (org.error) throw new Error(org.error.message);
  if (setores.error) throw new Error(setores.error.message);
  if (linhas.error) throw new Error(linhas.error.message);

  const expedientes: Record<string, Expediente> = {};
  for (const s of (setores.data ?? []) as Array<{ id: string; schedule: unknown }>) {
    expedientes[s.id] = (s.schedule ?? null) as Expediente;
  }
  let todas = (linhas.data ?? []) as LinhaDoSlaDePrimeiraResposta[];
  if (opcoes.setorId !== undefined) todas = todas.filter((l) => l.sector_id === opcoes.setorId);

  return agregarSlaDePrimeiraResposta(
    todas,
    metasDoSla((org.data as { settings?: unknown } | null)?.settings),
    expedientes,
    opcoes.agora ?? new Date(),
  );
}
