/**
 * Os contratos das rotas de `/api/v1/relatorios/*` (3.6), num módulo sem
 * código: a tela importa os tipos daqui sem puxar nada do servidor.
 */
import type { RespostaRecente, ResumoDaSatisfacao, EscalaDaSatisfacao } from "@/lib/atendimento/satisfacao";
import type { ResumoDoSlaDePrimeiraResposta } from "@/lib/inbox/sla-relatorio";

export interface TempoDoRelatorio {
  media: number | null;
  mediana: number | null;
  amostra: number;
}

export interface LinhaDeRecorte {
  abertos: number;
  encerrados: number;
  primeira_resposta_media: number | null;
  resolucao_media: number | null;
}

export interface RelatorioDeAtendimentos {
  abertos: number;
  encerrados: number;
  primeira_resposta: TempoDoRelatorio;
  resolucao: TempoDoRelatorio;
  por_dia: Array<{ dia: string; abertos: number; encerrados: number }>;
  por_setor: Array<LinhaDeRecorte & { sector_id: string | null; nome: string | null }>;
  por_atendente: Array<LinhaDeRecorte & { user_id: string | null; nome: string | null }>;
  /** Desfecho das demandas fechadas no período (`demandas.desfecho`) → quantas. */
  desfechos: Record<string, number>;
  /**
   * Motivos de encerramento por quantidade. `null` = a organização ainda não
   * tem de onde lê-los — ver `motivosDeEncerramento` abaixo.
   */
  motivos: Array<{ motivo: string; quantidade: number }> | null;
}

export interface RelatorioDeSatisfacao {
  /** A régua configurada hoje — é a que a aba mostra primeiro. */
  escala: EscalaDaSatisfacao;
  resumo: ResumoDaSatisfacao;
  recentes: RespostaRecente[];
}

export interface LinhaDeAtribuicao {
  /** `null` = clique da página de captura direta, sem link rastreável. */
  link_id: string | null;
  nome: string | null;
  uso: string | null;
  cliques: number;
  /** Cliques que viraram contato (o código casou com a mensagem). */
  contatos: number;
  negocios: number;
  ganhos: number;
  /** Negócios com conversão ENVIADA à plataforma de anúncio. */
  conversoes: number;
}

export interface JanelaDaResposta {
  de: string;
  ate: string;
  tz: string;
}

/** Aba SLA: `com_meta=false` quando a organização não definiu meta nenhuma. */
export interface RelatorioDeSla {
  com_meta: boolean;
  resumo: ResumoDoSlaDePrimeiraResposta | null;
  /** id do setor → nome, para a tabela por setor. */
  setores: Record<string, string>;
}
