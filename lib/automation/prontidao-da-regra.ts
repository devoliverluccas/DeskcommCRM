/**
 * "PRONTA PARA ATIVAR?" — o checklist que a tela mostra antes de ligar uma
 * automação (fase 4, 4.1).
 *
 * Função PURA: a tela entrega o que ela já tem (o formulário e a lista de
 * canais) e recebe os itens. Nada aqui vai ao banco; a conferência definitiva
 * continua sendo a porta da API (o schema) e o motor.
 *
 * Os quatro itens são os que mais custam quando faltam, porque os quatro
 * produzem uma regra LIGADA que não faz nada:
 *  1. gatilho configurado — o gatilho com configuração (data do funil, tempo,
 *     palavra-chave) lido pelo MESMO leitor da varredura/motor;
 *  2. ao menos uma ação;
 *  3. ações válidas — cada uma passa no schema da API (o que a porta aceitaria);
 *  4. canal ativo quando a ação envia mensagem — o número escolhido existe,
 *     está conectado e não foi pausado pelo operador. Item que não se aplica
 *     (regra sem envio) sai como `nao_se_aplica`, nunca como verde inventado.
 */
import { actionSchema } from "@/lib/schemas/webhooks";
import { GATILHO_DE_DATA_DO_FUNIL, configDoGatilhoDeData } from "@/lib/automation/gatilho-de-data-do-funil";
import {
  GATILHO_ETAPA_PARADA,
  GATILHO_SILENCIO,
  configDaEtapaParada,
  configDoSilencio,
} from "@/lib/automation/gatilhos-de-tempo";
import { GATILHO_PALAVRA_CHAVE, configDaPalavraChave } from "@/lib/automation/gatilho-palavra-chave";

export type SituacaoDoItem = "ok" | "falta" | "nao_se_aplica";

export type ChaveDoItem = "gatilho" | "acao" | "acoes_validas" | "canal_ativo";

export interface ItemDaProntidao {
  chave: ChaveDoItem;
  situacao: SituacaoDoItem;
  /** Posições (base 0) das ações que reprovaram o item — a tela as nomeia. */
  acoes?: number[];
}

export interface CanalParaProntidao {
  id: string;
  status: string;
  metadata?: Record<string, unknown> | null;
}

/** As ações que falam pelo número de WhatsApp escolhido nelas. */
export const ACOES_QUE_ENVIAM_PELO_CANAL = ["send_whatsapp_message", "send_ai_message"] as const;

/** O canal pode enviar agora? Conectado (`WORKING`) e não pausado pelo operador. */
export function canalEstaAtivo(canal: CanalParaProntidao | undefined): boolean {
  if (!canal) return false;
  if (canal.metadata && canal.metadata.disabled === true) return false;
  return canal.status === "WORKING";
}

export function gatilhoEstaConfigurado(evento: string, config: unknown): boolean {
  if (!evento) return false;
  if (evento === GATILHO_DE_DATA_DO_FUNIL) return configDoGatilhoDeData(config) !== null;
  if (evento === GATILHO_SILENCIO) return configDoSilencio(config) !== null;
  if (evento === GATILHO_ETAPA_PARADA) return configDaEtapaParada(config) !== null;
  if (evento === GATILHO_PALAVRA_CHAVE) return configDaPalavraChave(config) !== null;
  return true;
}

export function prontidaoDaRegra(entrada: {
  evento: string;
  triggerConfig: unknown;
  acoes: ReadonlyArray<{ type: string; config?: unknown }>;
  /** `undefined` = a lista de canais ainda não chegou: o item não é afirmado. */
  canais: readonly CanalParaProntidao[] | undefined;
}): { itens: ItemDaProntidao[]; pronta: boolean } {
  const itens: ItemDaProntidao[] = [];

  itens.push({ chave: "gatilho", situacao: gatilhoEstaConfigurado(entrada.evento, entrada.triggerConfig) ? "ok" : "falta" });
  itens.push({ chave: "acao", situacao: entrada.acoes.length > 0 ? "ok" : "falta" });

  const invalidas = entrada.acoes
    .map((acao, indice) => (actionSchema.safeParse({ type: acao.type, config: acao.config ?? {} }).success ? -1 : indice))
    .filter((indice) => indice >= 0);
  itens.push({
    chave: "acoes_validas",
    situacao: entrada.acoes.length === 0 ? "nao_se_aplica" : invalidas.length ? "falta" : "ok",
    ...(invalidas.length ? { acoes: invalidas } : {}),
  });

  const queEnviam = entrada.acoes
    .map((acao, indice) => ({ acao, indice }))
    .filter(({ acao }) => (ACOES_QUE_ENVIAM_PELO_CANAL as readonly string[]).includes(acao.type));
  if (!queEnviam.length) {
    itens.push({ chave: "canal_ativo", situacao: "nao_se_aplica" });
  } else {
    const semCanal = queEnviam
      .filter(({ acao }) => {
        const id = (acao.config as { channel_session_id?: unknown } | undefined)?.channel_session_id;
        if (typeof id !== "string" || !id) return true;
        if (entrada.canais === undefined) return false;
        return !canalEstaAtivo(entrada.canais.find((c) => c.id === id));
      })
      .map(({ indice }) => indice);
    itens.push({
      chave: "canal_ativo",
      situacao: semCanal.length ? "falta" : "ok",
      ...(semCanal.length ? { acoes: semCanal } : {}),
    });
  }

  return { itens, pronta: itens.every((item) => item.situacao !== "falta") };
}
