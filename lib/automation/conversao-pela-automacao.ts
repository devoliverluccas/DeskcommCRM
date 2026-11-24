/**
 * O vocabulário da ação "Enviar conversão para plataforma de anúncio".
 *
 * A ação escolhe O EVENTO; a PLATAFORMA não é escolha dela. Quem decide para
 * onde vai é a atribuição do contato (o clique que o trouxe) e o registro de
 * transportes (`lib/plataformas-de-anuncio/registry.ts`), pelo MESMO caminho das
 * regras de conversão — `processarConversao`, em `lib/conversoes/envio.handler.ts`.
 * Uma plataforma que ganhar transporte no registro passa a receber a conversão
 * desta ação sem nenhuma linha aqui.
 *
 * Dois tipos de evento, porque o caminho de envio tem dois:
 *
 *  - `Purchase` (a venda): vai a QUALQUER plataforma com transporte, e exige o
 *    negócio ganho — é a mesma trava da regra de venda. Negócio aberto não é
 *    venda, e reportar uma venda que não houve ensinaria o otimizador errado.
 *  - os eventos padrão da Meta (`LeadSubmitted`, `QualifiedLead`…): o caminho
 *    de evento de ETAPA só existe para a Meta hoje, e quem veio de outra
 *    plataforma sai como pulo nomeado (`etapa_sem_origem_meta`), nunca como
 *    envio inventado.
 *
 * A chave no livro-razão do evento de etapa é `MetaEtapa:<id da regra>`: uma
 * conversão por negócio e por automação (rodar de novo não duplica), e o
 * reenvio da tela de Conversões funciona sobre ela como sobre a de uma etapa.
 */
import { EVENTOS_DA_META, VALORES_DE_EVENTO_DA_META, type EventoDaMeta } from "@/lib/conversoes/regras-meta";

export const EVENTO_DA_VENDA = "Purchase";

export const EVENTOS_DA_CONVERSAO_NA_AUTOMACAO = [EVENTO_DA_VENDA, ...VALORES_DE_EVENTO_DA_META] as [
  typeof EVENTO_DA_VENDA,
  ...EventoDaMeta[],
];
export type EventoDaConversaoNaAutomacao = (typeof EVENTOS_DA_CONVERSAO_NA_AUTOMACAO)[number];

/** Os rótulos da tela — os mesmos das regras de etapa da Meta, mais a venda. */
export const ROTULOS_DA_CONVERSAO_NA_AUTOMACAO: ReadonlyArray<{ valor: EventoDaConversaoNaAutomacao; rotulo: string }> = [
  { valor: EVENTO_DA_VENDA, rotulo: "Venda (negócio ganho)" },
  ...EVENTOS_DA_META.map((e) => ({ valor: e.valor, rotulo: e.rotulo })),
];

export function ehEventoDaConversaoNaAutomacao(valor: unknown): valor is EventoDaConversaoNaAutomacao {
  return typeof valor === "string" && (EVENTOS_DA_CONVERSAO_NA_AUTOMACAO as readonly string[]).includes(valor);
}
