/**
 * OS ATALHOS DE TECLADO DO INBOX — uma lista, três leitores.
 *
 * A ajuda (`?`, `ShortcutsHelpDialog`), os registros de tecla
 * (`InboxKeyboardShortcuts` para a navegação, `ConversationHeader` para as ações
 * da conversa) e as dicas à direita dos itens do menu ⋯ leem DESTE array. Antes
 * a ajuda era uma lista estática separada das teclas registradas: trocar uma
 * tecla no hook deixava a ajuda ensinando a antiga, e nada ficava vermelho.
 *
 * ─── Por que estas teclas ────────────────────────────────────────────────────
 *
 * Letra solta, sem modificador, como as que já existiam (`j`/`k`/`r`/`a`/`e`).
 * Elas não disputam com a digitação: o `react-hotkeys-hook` não dispara em
 * `input`, `textarea`, `select` nem em `contenteditable` (o padrão de
 * `enableOnFormTags`/`enableOnContentEditable` é desligado), então quem escreve
 * no compositor nunca transfere a conversa sem querer. Nenhuma colide com as de
 * navegação nem com `mod+k` (busca) e `mod+shift+l` (tema).
 *
 * `descricao` é a CHAVE do dicionário (o texto em português) — quem desenha
 * passa por `t()`.
 */

export type IdDoAtalho =
  | "proxima"
  | "anterior"
  | "responder"
  | "enviar"
  | "quebrar-linha"
  | "assumir"
  | "fechar"
  | "transferir"
  | "mover-para-fila"
  | "automatico"
  | "lembrar"
  | "criar-tarefa"
  | "ver-contato"
  | "ajuda";

export interface Atalho {
  id: IdDoAtalho;
  /**
   * A combinação no formato do `react-hotkeys-hook`. `null` quando quem trata a
   * tecla é outro componente (Enter e Shift+Enter moram no compositor) — o
   * atalho aparece na ajuda, mas ninguém o registra daqui.
   */
  tecla: string | null;
  /** Como a tecla aparece na ajuda e no menu. */
  exibicao: string;
  /** Chave do dicionário, em português. */
  descricao: string;
}

export const ATALHOS_DO_INBOX: readonly Atalho[] = [
  { id: "proxima", tecla: "j", exibicao: "J", descricao: "Próxima conversa" },
  { id: "anterior", tecla: "k", exibicao: "K", descricao: "Conversa anterior" },
  { id: "responder", tecla: "r", exibicao: "R", descricao: "Focar resposta" },
  // O atalho mais usado do inbox não estava na ajuda — vivia só no placeholder
  // do composer, que some no instante em que você começa a escrever, ou seja,
  // exatamente quando ia precisar dele para quebrar linha.
  { id: "enviar", tecla: null, exibicao: "Enter", descricao: "Enviar a mensagem" },
  {
    id: "quebrar-linha",
    tecla: null,
    exibicao: "Shift + Enter",
    descricao: "Quebrar linha sem enviar",
  },
  { id: "assumir", tecla: "a", exibicao: "A", descricao: "Assumir conversa" },
  { id: "fechar", tecla: "e", exibicao: "E", descricao: "Fechar conversa" },
  // As ações do cabeçalho — o mesmo rótulo do botão ou do item do menu ⋯.
  { id: "transferir", tecla: "t", exibicao: "T", descricao: "Transferir" },
  { id: "mover-para-fila", tecla: "f", exibicao: "F", descricao: "Mover para fila" },
  // UMA tecla para o par: pausar e devolver nunca valem ao mesmo tempo (um
  // exige o automático de pé, o outro exige a trava), como o botão e o item do
  // menu que nunca aparecem juntos.
  { id: "automatico", tecla: "p", exibicao: "P", descricao: "Pausar ou devolver o automático" },
  { id: "lembrar", tecla: "l", exibicao: "L", descricao: "Lembrar" },
  { id: "criar-tarefa", tecla: "c", exibicao: "C", descricao: "Criar tarefa" },
  { id: "ver-contato", tecla: "v", exibicao: "V", descricao: "Ver contato" },
  { id: "ajuda", tecla: "?", exibicao: "?", descricao: "Mostrar atalhos" },
];

export function atalhoDo(id: IdDoAtalho): Atalho {
  const achado = ATALHOS_DO_INBOX.find((a) => a.id === id);
  // Só falha se alguém apagar uma entrada que um registro ainda usa — e aí é
  // melhor quebrar no teste do que registrar `undefined` como tecla.
  if (!achado) throw new Error(`atalho sem entrada: ${id}`);
  return achado;
}

/** A tecla registrável do atalho (os de `tecla: null` não são registrados daqui). */
export function teclaDo(id: IdDoAtalho): string {
  return atalhoDo(id).tecla ?? "";
}

/**
 * O atalho não age quando a tecla foi apertada DENTRO de outra camada — um
 * diálogo, o menu ⋯ aberto, uma lista de opções. Ali a letra é do componente
 * (o Radix usa letras para pular para o item que começa com ela), e um "t" que
 * abrisse a transferência por trás de um diálogo agiria sobre o que a pessoa
 * nem está vendo.
 */
export function teclaEmOutraCamada(evento: KeyboardEvent): boolean {
  const alvo = evento.target;
  if (
    alvo instanceof Element &&
    alvo.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
  ) {
    return true;
  }
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
    ) !== null
  );
}
