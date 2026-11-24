/**
 * O GATILHO "MENSAGEM COM PALAVRA-CHAVE" (`message.keyword`).
 *
 * ─── Por que ele NÃO é um evento novo no `event_log` ────────────────────────
 *
 * A mensagem recebida já vira UM evento: o trigger `fn_emit_message_event`
 * grava `message.received` para a mensagem do cliente (e `message.group_received`
 * para a de grupo, que nenhum consumidor de automação escuta). Emitir uma
 * segunda linha por mensagem só para dizer "esta tinha a palavra X" dobraria o
 * `event_log` de toda instalação — inclusive das que nunca criaram uma regra de
 * palavra-chave — e exigiria reescrever o trigger da mensagem, que é o caminho
 * mais quente do produto. E trigger não decide palavra-chave de ninguém: a
 * lista de palavras é da REGRA.
 *
 * Então o gatilho é DERIVADO: as regras com `trigger_event = 'message.keyword'`
 * são avaliadas pelo motor sobre o MESMO `message.received` (ver
 * `regrasDaPalavraChave` em `engine.ts`), e só as que casam o texto entram no
 * laço de regras. O evento continua um só, com o mesmo contato, a mesma
 * conversa, o mesmo anti-laço e o mesmo recibo.
 *
 * Consequência que precisa ficar escrita: o handler do motor ASSINA
 * `message.keyword` (o teste `gatilhos-em-uma-fonte` exige que ele assine tudo o
 * que a tela oferece), mas ninguém o emite. Uma linha com esse tipo que apareça
 * no `event_log` (um `fn_log_event` chamado à mão) é recusada pelo motor como
 * `gatilho_derivado` — ela não passou pelo trigger da mensagem, e não há como
 * saber se é do cliente.
 *
 * ─── Só mensagem do cliente, nunca de grupo ─────────────────────────────────
 *
 * Herdado do evento de origem: `message.received` nasce só de mensagem
 * `inbound` em conversa que não é grupo, e nunca de reação nem de histórico
 * importado. O motor confere `direction = 'inbound'` de novo, por defesa.
 */

export const GATILHO_PALAVRA_CHAVE = "message.keyword";

/** O evento que de fato chega ao motor, e sobre o qual a palavra é procurada. */
export const EVENTO_DE_ORIGEM_DA_PALAVRA_CHAVE = "message.received";

export const MODOS_DA_PALAVRA_CHAVE = ["contem", "exata", "comeca_com"] as const;
export type ModoDaPalavraChave = (typeof MODOS_DA_PALAVRA_CHAVE)[number];

export const PALAVRAS_MAX = 20;
export const PALAVRA_MAX_CARACTERES = 60;

export interface ConfigDaPalavraChave {
  palavras: string[];
  modo: ModoDaPalavraChave;
  ignorar_acentos: boolean;
}

/** A frase da recusa — a MESMA na porta da API e na tela. */
export const MENSAGEM_DA_PALAVRA_CHAVE_INVALIDA =
  "Escreva de 1 a 20 palavras-chave (cada uma com letras ou números, até 60 caracteres) e escolha como comparar.";

/**
 * Os pedaços de texto que contam como palavra: letras e números de qualquer
 * alfabeto. Pontuação, emoji e espaço separam. É o que faz "Preço?" casar
 * "preço" e o que impede "oi" de casar "boi".
 */
function pedacos(texto: string, ignorarAcentos: boolean): string[] {
  let normal = texto.normalize("NFC").toLocaleLowerCase("pt-BR");
  if (ignorarAcentos) normal = normal.normalize("NFD").replace(/\p{M}+/gu, "");
  return normal.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * A configuração guardada, ou `null` quando ela não serve.
 *
 * O MESMO leitor na porta (o schema recusa o que ele não reconhece), no motor
 * (regra torta não dispara — e não derruba as outras) e na tela (abre o que está
 * gravado). `ignorar_acentos` ausente vale `true`: é o padrão que o briefing
 * pede, e o que um cliente que digita "preco" espera.
 */
export function configDaPalavraChave(config: unknown): ConfigDaPalavraChave | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const c = config as Record<string, unknown>;
  if (!Array.isArray(c.palavras)) return null;
  const palavras: string[] = [];
  for (const bruta of c.palavras) {
    if (typeof bruta !== "string") return null;
    const palavra = bruta.trim();
    if (!palavra || palavra.length > PALAVRA_MAX_CARACTERES) return null;
    if (pedacos(palavra, false).length === 0) return null;
    palavras.push(palavra);
  }
  if (palavras.length < 1 || palavras.length > PALAVRAS_MAX) return null;
  const modo = c.modo;
  if (typeof modo !== "string" || !(MODOS_DA_PALAVRA_CHAVE as readonly string[]).includes(modo)) return null;
  const ignorar = c.ignorar_acentos;
  if (ignorar !== undefined && typeof ignorar !== "boolean") return null;
  return { palavras, modo: modo as ModoDaPalavraChave, ignorar_acentos: ignorar !== false };
}

function comecaCom(texto: string[], alvo: string[], desde: number): boolean {
  if (desde + alvo.length > texto.length) return false;
  for (let i = 0; i < alvo.length; i += 1) if (texto[desde + i] !== alvo[i]) return false;
  return true;
}

/**
 * A primeira palavra-chave da regra que o texto casa, ou `null`.
 *
 * - `contem`: a palavra (ou a expressão inteira, em ordem) aparece em qualquer
 *   ponto da mensagem — como palavra, não como pedaço de outra;
 * - `exata`: a mensagem É a palavra (pontuação e caixa à parte);
 * - `comeca_com`: a mensagem começa por ela.
 */
export function palavraQueCasa(texto: string | null | undefined, config: ConfigDaPalavraChave): string | null {
  if (typeof texto !== "string" || !texto.trim()) return null;
  const mensagem = pedacos(texto, config.ignorar_acentos);
  if (!mensagem.length) return null;
  for (const palavra of config.palavras) {
    const alvo = pedacos(palavra, config.ignorar_acentos);
    if (!alvo.length) continue;
    if (config.modo === "exata") {
      if (mensagem.length === alvo.length && comecaCom(mensagem, alvo, 0)) return palavra;
    } else if (config.modo === "comeca_com") {
      if (comecaCom(mensagem, alvo, 0)) return palavra;
    } else {
      for (let i = 0; i + alvo.length <= mensagem.length; i += 1) {
        if (comecaCom(mensagem, alvo, i)) return palavra;
      }
    }
  }
  return null;
}

/**
 * O campo de texto da tela (uma palavra por linha ou separadas por vírgula) em
 * lista. Vazios saem; repetidas também — a mesma palavra duas vezes não muda
 * o que casa, e só gastaria o teto de 20.
 */
export function palavrasDaTela(texto: string): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const bruta of texto.split(/[\n,;]+/)) {
    const palavra = bruta.trim();
    if (!palavra) continue;
    const chave = palavra.toLocaleLowerCase("pt-BR");
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(palavra);
  }
  return saida;
}

/** O estado da tela: as palavras como TEXTO, o modo e o interruptor de acentos. */
export interface TelaDaPalavraChave {
  texto: string;
  modo: ModoDaPalavraChave;
  ignorarAcentos: boolean;
}

export const TELA_DA_PALAVRA_CHAVE_VAZIA: TelaDaPalavraChave = {
  texto: "",
  modo: "contem",
  ignorarAcentos: true,
};

/** O que está gravado, pelo MESMO leitor do motor — config torta abre vazia. */
export function telaDaPalavraChave(config: unknown): TelaDaPalavraChave {
  const lida = configDaPalavraChave(config);
  if (!lida) return TELA_DA_PALAVRA_CHAVE_VAZIA;
  return { texto: lida.palavras.join("\n"), modo: lida.modo, ignorarAcentos: lida.ignorar_acentos };
}

/** O que vai para o `trigger_config`. Lista vazia vai como está: o schema recusa com a frase certa. */
export function configDaTelaDaPalavraChave(tela: TelaDaPalavraChave): ConfigDaPalavraChave {
  return { palavras: palavrasDaTela(tela.texto), modo: tela.modo, ignorar_acentos: tela.ignorarAcentos };
}
