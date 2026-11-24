/**
 * A MARCAÇÃO `{{link:https://…}}` — a URL que sai encurtada e rastreada (fase 4, item 4.4).
 *
 * Não é variável do contato: nenhuma tela a resolve na prévia, e o resolvedor
 * único (`./resolvedor.ts`) nem a enxerga — a marcação dele é `[\w.]+`, e o `:`
 * e a `/` ficam de fora. Quem a troca é o ENVIO (`sendMessageHandler`, pela
 * `resolverNoEnvio`), porque só ele sabe para QUAL contato a mensagem vai: o
 * link curto é um por contato, e é isso que faz o clique dizer quem clicou.
 *
 * Duas formas:
 *
 *   `{{link:https://loja.exemplo/oferta}}`
 *   `{{link:https://loja.exemplo/oferta|black-friday}}`   ← rótulo (a campanha)
 *
 * O rótulo agrupa os cliques na tela de Links de saída. A URL tem de ser http
 * ou https com host — `javascript:`, `data:` e afins NÃO viram link: a marcação
 * fica como foi escrita, para quem escreveu ver que não saiu.
 */

/** `{{link:URL}}` ou `{{link:URL|rótulo}}`. Grupo 1 = URL, grupo 2 = rótulo. */
export const MARCACAO_DE_LINK = /\{\{\s*link:\s*([^\s|{}]+)\s*(?:\|\s*([^{}|]{1,60}?)\s*)?\}\}/gi;

/** Teto da URL de destino — o mesmo do CHECK da migration 9490. */
export const TAMANHO_MAXIMO_DO_DESTINO = 2048;

export interface LinkMarcado {
  /** A marcação inteira, como está no texto. */
  marca: string;
  destino: string;
  rotulo: string | null;
}

/** A URL normalizada, ou `null` quando não pode virar link (esquema, host, tamanho). */
export function destinoValido(bruto: string): string | null {
  const texto = bruto.trim();
  if (texto.length < 10 || texto.length > TAMANHO_MAXIMO_DO_DESTINO) return null;
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  // Credencial embutida (`https://user:senha@host`) não vai para a mensagem de ninguém.
  if (url.username || url.password) return null;
  return url.toString().length > TAMANHO_MAXIMO_DO_DESTINO ? null : url.toString();
}

/** O rótulo limpo, ou `null` (vazio é ausência). */
export function rotuloValido(bruto: string | undefined): string | null {
  const texto = (bruto ?? "").trim().replace(/\s+/g, " ");
  return texto === "" ? null : texto.slice(0, 60);
}

/** As marcações de link do texto, na ordem, com a URL já validada (as inválidas ficam de fora). */
export function linksNoTexto(texto: string): LinkMarcado[] {
  const achados: LinkMarcado[] = [];
  for (const m of texto.matchAll(MARCACAO_DE_LINK)) {
    const destino = destinoValido(m[1] ?? "");
    if (destino === null) continue;
    achados.push({ marca: m[0], destino, rotulo: rotuloValido(m[2]) });
  }
  return achados;
}

/** O texto tem alguma marcação de link (válida ou não)? Barato: decide se vale ir ao banco. */
export function temMarcacaoDeLink(texto: string): boolean {
  return /\{\{\s*link:/i.test(texto);
}

/**
 * Troca cada marcação VÁLIDA pelo que `trocar` devolver para ela. A inválida
 * fica como foi escrita. Mesmo destino + rótulo no mesmo texto pede UMA vez.
 */
export async function trocarLinks(
  texto: string,
  trocar: (link: { destino: string; rotulo: string | null }) => Promise<string>,
): Promise<string> {
  if (!temMarcacaoDeLink(texto)) return texto;
  const cache = new Map<string, Promise<string>>();
  const pedir = (destino: string, rotulo: string | null) => {
    const chave = `${destino}\u0000${rotulo ?? ""}`;
    let p = cache.get(chave);
    if (!p) {
      p = trocar({ destino, rotulo });
      cache.set(chave, p);
    }
    return p;
  };
  const partes: Array<string | Promise<string>> = [];
  let cursor = 0;
  for (const m of texto.matchAll(MARCACAO_DE_LINK)) {
    const inicio = m.index ?? cursor;
    partes.push(texto.slice(cursor, inicio));
    cursor = inicio + m[0].length;
    const destino = destinoValido(m[1] ?? "");
    partes.push(destino === null ? m[0] : pedir(destino, rotuloValido(m[2])));
  }
  partes.push(texto.slice(cursor));
  return (await Promise.all(partes)).join("");
}
