/**
 * MENSAGEM INTERATIVA — botões (até 3) e lista (até 10 itens) que o fluxo de
 * mensagens manda (nós `buttons` e `list`, `lib/followup/graph-schema.ts`).
 *
 * Mora em `lib/channels/` porque a pergunta "este canal desenha botão?" é do
 * canal, e quem responde é a capability `mensagemInterativa`
 * (`./capabilities.ts`) — nunca o nome do provedor (invariante 1 de
 * `docs/doctrine/restricao-de-canal.md`).
 *
 * O contrato de degradação, que é o que mantém o fluxo útil em todo canal:
 *
 *   - o `body` da mensagem é SEMPRE o texto numerado ("Responda 1, 2 ou 3"),
 *     montado por `textoNumerado`. É ele que sai no canal que não desenha
 *     botão, e é ele que fica no histórico da conversa;
 *   - o `interativo` viaja ao lado, e só o adapter que declarou a capability o
 *     transforma em botões de verdade (`interativoParaOCanal` corta o resto);
 *   - a resposta do cliente casa pelo id do botão, pelo número ou pelo rótulo
 *     (`casarOpcaoInterativa`) — o mesmo casamento nos dois caminhos.
 */
import { z } from "zod";

import { capabilitiesOf, transportaMensagem } from "./capabilities";
import type { ProviderDeMensagem } from "./types";

/** Teto da plataforma: 3 botões de resposta rápida. */
export const MAX_BOTOES = 3;
/** Teto da plataforma: 10 linhas numa lista. */
export const MAX_ITENS_DA_LISTA = 10;
/** Rótulo de botão: 20 caracteres (limite da Cloud API). */
export const MAX_ROTULO_DO_BOTAO = 20;
/** Título de linha de lista: 24 caracteres (limite da Cloud API). */
export const MAX_ROTULO_DA_LISTA = 24;
/** Descrição de linha de lista: 72 caracteres (limite da Cloud API). */
export const MAX_DESCRICAO_DA_LISTA = 72;
/** Corpo de mensagem interativa: 1024 caracteres (limite da Cloud API). */
export const MAX_CORPO_INTERATIVO = 1024;

const opcaoSchema = z.strictObject({
  id: z.string().min(1).max(64),
  rotulo: z.string().min(1).max(MAX_ROTULO_DA_LISTA),
  descricao: z.string().max(MAX_DESCRICAO_DA_LISTA).optional(),
});

/**
 * O que viaja no job e em `messages.metadata.interativo`. `strictObject` para
 * que um payload torto (jsonb é de quem administra o banco) caia no texto
 * numerado em vez de virar um corpo que a plataforma recusa.
 */
export const mensagemInterativaSchema = z.discriminatedUnion("tipo", [
  z.strictObject({
    tipo: z.literal("botoes"),
    corpo: z.string().min(1).max(MAX_CORPO_INTERATIVO),
    opcoes: z
      .array(opcaoSchema.extend({ rotulo: z.string().min(1).max(MAX_ROTULO_DO_BOTAO) }))
      .min(1)
      .max(MAX_BOTOES),
  }),
  z.strictObject({
    tipo: z.literal("lista"),
    corpo: z.string().min(1).max(MAX_CORPO_INTERATIVO),
    botao: z.string().min(1).max(MAX_ROTULO_DO_BOTAO),
    opcoes: z.array(opcaoSchema).min(1).max(MAX_ITENS_DA_LISTA),
  }),
]);
export type MensagemInterativa = z.infer<typeof mensagemInterativaSchema>;
export type OpcaoInterativa = MensagemInterativa["opcoes"][number];

/** "1, 2 ou 3" — a enumeração em português do convite a responder. */
function numerosEmFrase(n: number): string {
  const nums = Array.from({ length: n }, (_, i) => String(i + 1));
  if (nums.length === 1) return nums[0]!;
  return `${nums.slice(0, -1).join(", ")} ou ${nums.at(-1)}`;
}

/**
 * O texto que sai no canal que NÃO desenha botão — e que fica no histórico.
 *
 * Ex.: "Qual horário?\n\n1. Manhã\n2. Tarde\n\nResponda 1 ou 2."
 */
export function textoNumerado(msg: MensagemInterativa): string {
  const linhas = msg.opcoes.map((o, i) =>
    o.descricao ? `${i + 1}. ${o.rotulo} — ${o.descricao}` : `${i + 1}. ${o.rotulo}`,
  );
  return `${msg.corpo.trim()}\n\n${linhas.join("\n")}\n\nResponda ${numerosEmFrase(msg.opcoes.length)}.`;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qual opção a resposta do cliente escolheu — `null` quando não dá para dizer.
 *
 * Três formas, na ordem: o id do botão (o que o canal interativo devolve), o
 * NÚMERO da opção ("2", "2.", "opção 2") e o RÓTULO exato, sem acento e sem
 * caixa ("tarde"). Rótulo contido numa frase longa NÃO casa: "de manhã não
 * posso, só à tarde" escolheria a primeira opção citada, e escolher errado é
 * pior que cair na saída "Outros casos".
 */
export function casarOpcaoInterativa(
  opcoes: readonly { id: string; rotulo: string }[],
  resposta: string,
): string | null {
  const bruto = resposta.trim();
  if (bruto === "") return null;
  const porId = opcoes.find((o) => o.id === bruto);
  if (porId) return porId.id;

  const texto = normalizar(bruto);
  const numero = /^(?:opcao |op |n )?(\d{1,2})$/.exec(texto);
  if (numero) {
    const i = Number(numero[1]) - 1;
    return opcoes[i]?.id ?? null;
  }
  const porRotulo = opcoes.filter((o) => normalizar(o.rotulo) === texto);
  return porRotulo.length === 1 ? porRotulo[0]!.id : null;
}

/**
 * O `interativo` que o adapter deste canal deve receber — ou `undefined`.
 *
 * Decide pela CAPABILITY: canal que não declarou `mensagemInterativa` recebe só
 * o `body` (o texto numerado), e o adapter dele nem fica sabendo que havia
 * botão. Provider desconhecido e payload torto também caem no texto: falhar
 * aqui é mandar texto, nunca deixar de mandar.
 *
 * É o ponto que o handler de envio chama ao montar o envelope:
 *   `interativo: interativoParaOCanal(c.channel_sessions?.provider, input.metadata?.interativo)`
 */
export function interativoParaOCanal(
  provider: string | null | undefined,
  bruto: unknown,
): MensagemInterativa | undefined {
  if (!transportaMensagem(provider)) return undefined;
  if (!capabilitiesOf(provider as ProviderDeMensagem).mensagemInterativa) return undefined;
  const lido = mensagemInterativaSchema.safeParse(bruto);
  return lido.success ? lido.data : undefined;
}

/**
 * O corpo `interactive` da WhatsApp Cloud API. Exportado porque os parceiros
 * que espelham a Cloud API falam o mesmo dialeto — quando um deles declarar a
 * capability, o adapter dele reusa esta função em vez de ter uma cópia.
 */
export function corpoInterativoDaCloudApi(msg: MensagemInterativa): Record<string, unknown> {
  if (msg.tipo === "botoes") {
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: msg.corpo },
        action: {
          buttons: msg.opcoes.map((o) => ({ type: "reply", reply: { id: o.id, title: o.rotulo } })),
        },
      },
    };
  }
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: msg.corpo },
      action: {
        button: msg.botao,
        sections: [
          {
            rows: msg.opcoes.map((o) => ({
              id: o.id,
              title: o.rotulo,
              ...(o.descricao ? { description: o.descricao } : {}),
            })),
          },
        ],
      },
    },
  };
}
