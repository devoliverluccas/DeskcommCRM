/**
 * O RESUMO ANTES DE ENVIAR (fase 4, item 4.7).
 *
 * Responde, numa leitura só, o que o operador precisa saber antes de apertar:
 * quantos recebem (depois de opt-out, bloqueados, sem telefone, já em campanha),
 * a categoria do modelo na plataforma, o limite do número hoje, a janela de
 * disparo, o ritmo e quanto tempo a lista leva.
 *
 * ─── A MESMA régua do envio ──────────────────────────────────────────────────
 *
 * A contagem é a de `preverAudiencia` — a mesma consulta e a mesma
 * classificação que `prepararCampanha` congela (`./preparacao.ts`). O limite do
 * dia é o do motor de pacing (`warmupCapFor` sobre os degraus do número, contra
 * `channel_sessions.daily_message_limit`, como em `decidePacing`); a janela é a
 * do número (`effectiveKnobs`, 7h–22h por padrão) cortada pela da campanha,
 * como em `podeMandarAgora`. Resumo que conta por outro caminho é resumo que
 * mente, e a mentira só aparece depois do envio.
 *
 * ─── O custo ─────────────────────────────────────────────────────────────────
 *
 * Não há tabela de preço por mensagem neste repositório (o que existe de preço
 * é o dos modelos de IA, `lib/agent-engine/edge/llm/pricing-*`). O resumo NÃO
 * estima custo e diz isso — inventar um preço da plataforma seria pior que não
 * mostrar nenhum.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { warmupCapFor } from "@/lib/agent-engine/pacing/engine";
import { effectiveKnobs, idadeEmDias, type ChannelKnobsRow } from "@/lib/ai/pacing-knobs";
import { conversasDoLimite, normalizarLimite } from "@/lib/channels/meta/saude-do-numero";

import { preverAudiencia, type ModeloPreparado } from "./preparacao";
import { RAJADA } from "./rajada";
import { previaSchema, ritmoSchema } from "./schemas";
import { TEXTO_DA_EXCLUSAO, VELOCIDADES_DA_CAMPANHA, type VelocidadeDaCampanha } from "./tipos";

/** O pedido do resumo: a prévia + o número e o ritmo que a tela já tem. */
export const resumoDoEnvioSchema = previaSchema.extend({
  channel_session_id: z.string().uuid().optional(),
  /** Os números extras do rodízio (só texto livre). */
  channel_session_ids: z.array(z.string().uuid()).max(20).default([]),
  velocidade: z.enum(VELOCIDADES_DA_CAMPANHA).default("gradual"),
  intervalo_segundos: ritmoSchema.shape.intervalo_segundos,
  janela_inicio_hora: ritmoSchema.shape.janela_inicio_hora,
  janela_fim_hora: ritmoSchema.shape.janela_fim_hora,
  teto_diario: ritmoSchema.shape.teto_diario,
  teto_horario: ritmoSchema.shape.teto_horario,
});

export type PedidoDoResumo = z.infer<typeof resumoDoEnvioSchema>;

/** A categoria do modelo como a plataforma a devolve, normalizada. */
export type CategoriaDoModelo = "marketing" | "utilidade" | "autenticacao" | "outra";

export function categoriaDoModelo(bruta: string | null | undefined): CategoriaDoModelo | null {
  if (!bruta) return null;
  const c = bruta.trim().toUpperCase();
  if (c === "MARKETING") return "marketing";
  if (c === "UTILITY") return "utilidade";
  if (c === "AUTHENTICATION") return "autenticacao";
  return "outra";
}

/** A janela em que a campanha pode sair: a do número cortada pela da campanha. */
export function janelaEfetiva(
  doNumero: { inicio: number; fim: number },
  daCampanha: { inicio: number | null | undefined; fim: number | null | undefined },
): { inicio: number; fim: number; horas: number } {
  const temDaCampanha = daCampanha.inicio != null && daCampanha.fim != null;
  const inicio = temDaCampanha ? Math.max(doNumero.inicio, daCampanha.inicio!) : doNumero.inicio;
  const fim = temDaCampanha ? Math.min(doNumero.fim, daCampanha.fim!) : doNumero.fim;
  return { inicio, fim, horas: Math.max(0, fim - inicio) };
}

export interface EstimativaDeDuracao {
  /** Quantas saem por dia, no máximo, pelas regras de agora. `null` = sem teto diário. */
  porDia: number | null;
  /** Minutos de envio, se tudo couber no primeiro dia de janela. */
  minutos: number | null;
  /** Dias de janela até a lista acabar (1 = cabe num dia). `null` = nada sai. */
  dias: number | null;
}

/**
 * Quanto tempo a lista leva — DENTRO da janela, sem contar a espera até ela
 * abrir. É estimativa: a rodada do cron e a fila de outros envios do mesmo
 * número mexem nos minutos, nunca no teto do dia.
 *
 * Gradual: uma mensagem por número a cada rodada (uma por minuto), mais devagar
 * se a campanha pediu intervalo — o intervalo e os tetos da CAMPANHA somam todos
 * os números. Rápida: o que cabe numa rodada de rajada (`RAJADA`). Transmissão:
 * o provedor recebe a lista inteira e manda em cerca de um minuto.
 */
export function estimarDuracao(e: {
  pessoas: number;
  velocidade: VelocidadeDaCampanha;
  numeros: number;
  intervaloSegundos: number | null | undefined;
  tetoDiario: number | null | undefined;
  tetoHorario: number | null | undefined;
  /** O limite do dia de UM número (aquecimento e teto do CRM), `null` = sem limite. */
  limiteDoNumero: number | null;
  horasDeJanela: number;
}): EstimativaDeDuracao {
  if (e.pessoas <= 0) return { porDia: 0, minutos: 0, dias: 0 };
  if (e.horasDeJanela <= 0) return { porDia: 0, minutos: null, dias: null };
  const numeros = Math.max(1, e.numeros);
  const limiteDosNumeros = e.limiteDoNumero === null ? Infinity : e.limiteDoNumero * numeros;

  let porMinuto: number;
  if (e.velocidade === "transmissao") {
    // Na transmissão só o teto do número freia (`tetoDaTransmissao`).
    if (limiteDosNumeros <= 0) return { porDia: 0, minutos: null, dias: null };
    const porDia = Number.isFinite(limiteDosNumeros) ? limiteDosNumeros : null;
    return {
      porDia,
      minutos: porDia === null || e.pessoas <= porDia ? 1 : null,
      dias: porDia === null ? 1 : Math.ceil(e.pessoas / porDia),
    };
  } else if (e.velocidade === "rapida") {
    porMinuto = Math.floor(RAJADA.prazoMs / RAJADA.intervaloEntreIniciosMs);
  } else {
    porMinuto = e.intervaloSegundos ? Math.min(numeros, 60 / e.intervaloSegundos) : numeros;
  }

  const porHora = Math.min(porMinuto * 60, e.tetoHorario ?? Infinity);
  const porDiaBruto = Math.min(porHora * e.horasDeJanela, e.tetoDiario ?? Infinity, limiteDosNumeros);
  const porDia = Math.floor(porDiaBruto);
  if (porDia <= 0) return { porDia: 0, minutos: null, dias: null };

  const dias = Math.ceil(e.pessoas / porDia);
  const minutos = dias <= 1 ? Math.max(1, Math.ceil((e.pessoas / porHora) * 60)) : null;
  return { porDia, minutos, dias };
}

export interface ResumoDoEnvio {
  audiencia: Awaited<ReturnType<typeof preverAudiencia>> & { legenda: typeof TEXTO_DA_EXCLUSAO };
  /** `null` = não é campanha com modelo. */
  modelo: { nome: string; categoria: CategoriaDoModelo | null } | null;
  /** Sempre `null` hoje: não há tabela de preço por mensagem configurada. */
  custo: null;
  /** `null` no e-mail (não há número). */
  numero: {
    /** O limite do dia de UM número: o menor entre o aquecimento e o teto do CRM. */
    limiteDoDia: number | null;
    /** Quem decide o limite, para a frase da tela. */
    origemDoLimite: OrigemDoLimite;
    /**
     * O limite REAL de conversas por 24h que a Meta deu ao número oficial
     * (item 5.5, `channel_sessions.meta_messaging_limit_tier`). `null` = número
     * sem essa leitura (QR, ou oficial ainda não lido). `conversas: null` = sem limite.
     */
    limiteDaMeta: { tier: string; conversas: number | null } | null;
    idadeEmDias: number;
    janela: { inicio: number; fim: number; horas: number };
    fuso: string;
    /** Quantos números a campanha usa (principal + rodízio). */
    numeros: number;
  } | null;
  velocidade: VelocidadeDaCampanha;
  duracao: EstimativaDeDuracao | null;
}

export type OrigemDoLimite = "aquecimento" | "teto_do_numero" | "limite_da_meta" | null;

/**
 * O limite de UM número hoje, pela mesma conta de `decidePacing` — e, quando o
 * número é oficial e a Meta já disse o degrau dele (item 5.5), o limite REAL de
 * conversas por 24h entra na conta: a lista que passa dele não sai no mesmo dia,
 * por mais folgado que esteja o teto do CRM. `limiteDaMeta` ausente/`null` =
 * sem leitura, e a conta é a de sempre.
 */
export function limiteDoNumeroHoje(
  knobsRow: ChannelKnobsRow | null,
  tetoDoCrm: number | null,
  agora: Date,
  fusoDaOrg: string | null,
  limiteDaMeta: number | null = null,
): { limite: number | null; origem: OrigemDoLimite; idade: number } {
  const knobs = effectiveKnobs(knobsRow, fusoDaOrg);
  const idade = idadeEmDias(knobsRow, agora);
  const doAquecimento = warmupCapFor(idade, knobs.warmupDailyCaps);
  const daMeta = limiteDaMeta ?? Infinity;
  const limite = Math.min(doAquecimento ?? Infinity, tetoDoCrm ?? Infinity, daMeta);
  if (!Number.isFinite(limite)) return { limite: null, origem: null, idade };
  // Empate fica com quem já explicava o limite antes (aquecimento, depois teto):
  // a Meta só assume a frase quando é ela que aperta.
  const origem: OrigemDoLimite =
    doAquecimento !== null && doAquecimento <= Math.min(tetoDoCrm ?? Infinity, daMeta)
      ? "aquecimento"
      : tetoDoCrm !== null && tetoDoCrm <= daMeta
        ? "teto_do_numero"
        : "limite_da_meta";
  return { limite, origem, idade };
}

/**
 * O resumo inteiro. `organizationId` vem da SESSÃO (a rota), e toda leitura
 * filtra por ele — o admin client não tem RLS.
 */
export async function resumirEnvio(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    pedido: PedidoDoResumo;
    modelo?: ModeloPreparado;
    agora: Date;
  },
): Promise<ResumoDoEnvio> {
  const { pedido, organizationId, agora } = entrada;
  const ehEmail = pedido.canal === "email";
  const audiencia = await preverAudiencia(admin, {
    organizationId,
    filtro: pedido.audience_filter,
    corpo: pedido.message_body,
    agora,
    campanhaId: pedido.campaign_id,
    ...(entrada.modelo ? { modelo: entrada.modelo } : {}),
    ...(ehEmail ? { canal: "email" as const } : {}),
  });

  const modelo = entrada.modelo
    ? { nome: entrada.modelo.definicao.name, categoria: categoriaDoModelo(entrada.modelo.definicao.category) }
    : null;
  // Com modelo, a rajada e a transmissão valem; sem ele, o número por QR é sempre gradual.
  const velocidade: VelocidadeDaCampanha = entrada.modelo ? pedido.velocidade : "gradual";

  const sessionId = pedido.channel_session_id ?? pedido.modelo?.channel_session_id;
  if (ehEmail || !sessionId) {
    return { audiencia: { ...audiencia, legenda: TEXTO_DA_EXCLUSAO }, modelo, custo: null, numero: null, velocidade, duracao: null };
  }

  // O degrau da Meta (migration 9496) vem junto. Clone que ainda não aplicou a
  // migration não tem a coluna: a leitura cai na de sempre em vez de derrubar o resumo.
  const lerSessao = async () => {
    const comMeta = await admin
      .from("channel_sessions")
      .select("daily_message_limit, meta_messaging_limit_tier")
      .eq("organization_id", organizationId)
      .eq("id", sessionId)
      .maybeSingle();
    if (!comMeta.error || comMeta.error.code !== "42703") return comMeta;
    return admin
      .from("channel_sessions")
      .select("daily_message_limit")
      .eq("organization_id", organizationId)
      .eq("id", sessionId)
      .maybeSingle();
  };
  const [sessao, knobs, org] = await Promise.all([
    lerSessao(),
    admin
      .from("channel_knobs")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("channel_session_id", sessionId)
      .maybeSingle(),
    admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle(),
  ]);
  if (sessao.error) throw new Error(`resumo: número — ${sessao.error.message}`);
  if (knobs.error) throw new Error(`resumo: ritmo do número — ${knobs.error.message}`);
  if (org.error) throw new Error(`resumo: organização — ${org.error.message}`);
  if (!sessao.data) throw new Error("O número escolhido não é desta organização.");

  const knobsRow = (knobs.data ?? null) as ChannelKnobsRow | null;
  const fusoDaOrg = (org.data as { timezone?: string | null } | null)?.timezone ?? null;
  const efetivos = effectiveKnobs(knobsRow, fusoDaOrg);
  const linhaDaSessao = sessao.data as { daily_message_limit: number | null; meta_messaging_limit_tier?: string | null };
  const tetoDoCrm = linhaDaSessao.daily_message_limit ?? null;
  const tier = normalizarLimite(linhaDaSessao.meta_messaging_limit_tier ?? null);
  const conversasDaMeta = conversasDoLimite(tier);
  const limiteDaMeta = tier && conversasDaMeta !== undefined ? { tier, conversas: conversasDaMeta } : null;
  const limite = limiteDoNumeroHoje(knobsRow, tetoDoCrm, agora, fusoDaOrg, limiteDaMeta?.conversas ?? null);
  const janela = janelaEfetiva(
    { inicio: efetivos.windowStartHour, fim: efetivos.windowEndHour },
    { inicio: pedido.janela_inicio_hora, fim: pedido.janela_fim_hora },
  );
  // Modelo aprovado sai por um número só; texto livre pode revezar.
  const numeros = 1 + (entrada.modelo ? 0 : new Set(pedido.channel_session_ids.filter((id) => id !== sessionId)).size);

  return {
    audiencia: { ...audiencia, legenda: TEXTO_DA_EXCLUSAO },
    modelo,
    custo: null,
    numero: {
      limiteDoDia: limite.limite,
      origemDoLimite: limite.origem,
      limiteDaMeta,
      idadeEmDias: limite.idade,
      janela,
      fuso: efetivos.timezone,
      numeros,
    },
    velocidade,
    duracao: estimarDuracao({
      pessoas: audiencia.elegiveis,
      velocidade,
      numeros,
      intervaloSegundos: velocidade === "gradual" ? pedido.intervalo_segundos : null,
      tetoDiario: velocidade === "transmissao" ? null : pedido.teto_diario,
      tetoHorario: velocidade === "transmissao" ? null : pedido.teto_horario,
      limiteDoNumero: limite.limite,
      horasDeJanela: janela.horas,
    }),
  };
}
