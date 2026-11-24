/**
 * MOTIVOS DE ENCERRAMENTO (fase 3, item 3.2) — a regra num lugar só.
 *
 * O motivo é o "por que acabou" que a equipe escolhe ao fechar a conversa. A
 * categoria dele é o DESFECHO da demanda (`demandas.desfecho`, migration 0136),
 * no mesmo vocabulário: o motivo "Spam" dá à demanda ainda aberta o desfecho
 * `nao_procede`, pela mesma `fn_demanda_encerrar` do botão "Encerrar demanda"
 * (quem aplica é `fn_demanda_aplicar_motivo`, migration 9482).
 *
 * Quem usa este módulo:
 *   - `POST /api/v1/conversations/[id]/close` confere o `motivo_id` e a
 *     exigência da organização ANTES de fechar;
 *   - `/api/v1/motivos-de-encerramento` (CRUD da tela de Configurações);
 *   - o seletor do diálogo de fechar, no Inbox.
 *
 * ─── A exigência só vale com motivo ativo ───────────────────────────────────
 *
 * `settings.atendimento.motivo_obrigatorio_ao_encerrar` ligado e NENHUM motivo
 * ativo deixaria a equipe sem como fechar conversa nenhuma — o interruptor
 * viraria um bloqueio total que ninguém pediu. A exigência efetiva é "ligada E
 * há ao menos um motivo ativo"; a tela de Configurações avisa quando a lista
 * está vazia.
 */
import { z } from "zod";

/**
 * O vocabulário de `motivos_de_encerramento.categoria` — o MESMO do CHECK de
 * `demandas.desfecho`. Mudar aqui sem migration é o 23514 que o invariante
 * `vocabulario-banco-x-typescript` existe para pegar.
 */
export const CATEGORIAS_DE_MOTIVO = [
  "resolvida",
  "convertida",
  "nao_procede",
  "encerrada_pelo_cliente",
  "perdida",
  "expirada_sem_resposta",
] as const;

export type CategoriaDeMotivo = (typeof CATEGORIAS_DE_MOTIVO)[number];

/** O rótulo de cada categoria — os mesmos textos do desfecho no painel do contato. */
export const ROTULO_DA_CATEGORIA: Readonly<Record<CategoriaDeMotivo, string>> = {
  resolvida: "Resolvida",
  convertida: "Convertida",
  nao_procede: "Não procede",
  encerrada_pelo_cliente: "Encerrada pelo cliente",
  perdida: "Perdida",
  expirada_sem_resposta: "Expirada sem resposta",
};

/**
 * As sugestões do botão "Usar sugestões". NÃO nascem no baseline para todas as
 * organizações: só quando quem gerencia abre a tela vazia e pede.
 */
export const SUGESTOES_DE_MOTIVO: ReadonlyArray<{ nome: string; categoria: CategoriaDeMotivo }> = [
  { nome: "Resolvido", categoria: "resolvida" },
  { nome: "Sem resposta do cliente", categoria: "expirada_sem_resposta" },
  { nome: "Duplicado", categoria: "nao_procede" },
  { nome: "Spam", categoria: "nao_procede" },
  { nome: "Venda realizada", categoria: "convertida" },
];

export interface MotivoDeEncerramento {
  id: string;
  nome: string;
  categoria: CategoriaDeMotivo;
  ativo: boolean;
  ordem: number;
}

export const COLUNAS_DO_MOTIVO = "id, nome, categoria, ativo, ordem";

const nomeSchema = z.string().trim().min(1).max(80);

export const criarMotivoSchema = z.strictObject({
  nome: nomeSchema,
  categoria: z.enum(CATEGORIAS_DE_MOTIVO),
});

export const editarMotivoSchema = z
  .strictObject({
    nome: nomeSchema.optional(),
    categoria: z.enum(CATEGORIAS_DE_MOTIVO).optional(),
    ativo: z.boolean().optional(),
    ordem: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "vazio" });

export const configDosMotivosSchema = z.strictObject({
  motivo_obrigatorio_ao_encerrar: z.boolean(),
});

/**
 * Lê `settings.atendimento.motivo_obrigatorio_ao_encerrar`. Só `true` booleano
 * liga: ausente, nulo, texto ou bloco malformado é o padrão — desligado.
 */
export function motivoObrigatorioAoEncerrar(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  const bloco = (settings as Record<string, unknown>).atendimento;
  if (!bloco || typeof bloco !== "object") return false;
  return (bloco as Record<string, unknown>).motivo_obrigatorio_ao_encerrar === true;
}

/** Mescla a chave em `settings` sem perder as vizinhas (nem as do bloco `atendimento`). */
export function settingsComExigencia(settings: unknown, ligado: boolean): Record<string, unknown> {
  const raiz = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const bloco =
    raiz.atendimento && typeof raiz.atendimento === "object"
      ? (raiz.atendimento as Record<string, unknown>)
      : {};
  return { ...raiz, atendimento: { ...bloco, motivo_obrigatorio_ao_encerrar: ligado } };
}

/**
 * O que a rota de fechar decide sobre o motivo, ANTES de qualquer escrita.
 *
 *   - `ok` com `motivo` nulo: nada a gravar (sem pedido e sem exigência);
 *   - `ok` com `motivo`: grava depois de fechar;
 *   - `motivo_invalido`: o id não é desta organização, ou o motivo está inativo;
 *   - `motivo_required`: a organização exige e o pedido não trouxe — a resposta
 *     leva a lista ativa para a tela oferecer na hora.
 */
export type DecisaoDoMotivo =
  | { tipo: "ok"; motivo: MotivoDeEncerramento | null }
  | { tipo: "motivo_invalido" }
  | { tipo: "motivo_required"; motivos: MotivoDeEncerramento[] };

export function decidirMotivo(entrada: {
  motivoId: string | undefined;
  exigido: boolean;
  ativos: MotivoDeEncerramento[];
}): DecisaoDoMotivo {
  if (entrada.motivoId) {
    const motivo = entrada.ativos.find((m) => m.id === entrada.motivoId);
    return motivo ? { tipo: "ok", motivo } : { tipo: "motivo_invalido" };
  }
  if (entrada.exigido && entrada.ativos.length > 0) {
    return { tipo: "motivo_required", motivos: entrada.ativos };
  }
  return { tipo: "ok", motivo: null };
}

/** Ordena como a tela mostra: `ordem`, depois nome. */
export function ordenarMotivos<T extends { ordem: number; nome: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
}
