/**
 * Configuração do chat do site — o schema CENTRAL de `channel_sessions.webchat_config`
 * (migration 9494).
 *
 * Ninguém lê path solto da coluna (anti-pattern 6, `jsonb` lock-in): a tela, a
 * rota de gestão, a rota pública e o script passam por `lerConfigDoChat`, e um
 * valor fora do schema cai no padrão em vez de vazar para o site do cliente.
 *
 * Módulo PURO (sem banco, sem `node:`): o formulário da tela importa daqui a
 * mesma validação que o servidor aplica.
 */
import { z } from "zod";

/** Quantos domínios uma conexão aceita. É lista de sites da empresa, não de público. */
export const MAX_DOMINIOS = 20;
export const MAX_NOME = 60;
export const MAX_SAUDACAO = 300;

/** As duas posições da bolha no canto da página. */
export const POSICOES = ["direita", "esquerda"] as const;
export type PosicaoDaBolha = (typeof POSICOES)[number];

/**
 * As cores sugeridas na tela — neutras ou de estado, nunca a marca de alguém.
 * A pessoa pode digitar outro hex; estas são só atalhos.
 */
export const CORES_SUGERIDAS = ["#1a1a1e", "#2554e8", "#128c4a", "#b4232c", "#7a4fd1", "#c26a00"] as const;

/** Cor padrão: a tinta do design system. Não é marca, é contraste. */
export const COR_PADRAO = "#1a1a1e";

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Host com porta opcional: `exemplo.com.br`, `loja.exemplo.com`, `localhost:3000`.
 * Rótulos de 1 a 63, letras/dígitos/hífen, sem hífen nas pontas.
 */
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

/**
 * Transforma o que a pessoa colou ("https://www.loja.com.br/contato") no host
 * que o navegador manda no `Origin` ("www.loja.com.br"). `null` quando não dá.
 */
export function normalizarDominio(valor: string): string | null {
  let texto = valor.trim().toLowerCase();
  if (!texto) return null;
  texto = texto.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  texto = texto.split(/[/?#]/)[0] ?? "";
  texto = texto.replace(/^\*\./, "");
  if (texto.endsWith(".")) texto = texto.slice(0, -1);
  return texto.length <= 260 && HOST.test(texto) ? texto : null;
}

const dominioSchema = z.string().transform((valor, ctx) => {
  const host = normalizarDominio(valor);
  if (!host) {
    ctx.addIssue({ code: "custom", message: "Domínio inválido. Use o endereço do site, por exemplo example.com." });
    return z.NEVER;
  }
  return host;
});

export const configDoChatSchema = z.object({
  nome: z.string().trim().min(1).max(MAX_NOME),
  saudacao: z.string().trim().max(MAX_SAUDACAO),
  cor: z.string().trim().regex(HEX, "Use uma cor em hexadecimal, por exemplo #1a1a1e."),
  posicao: z.enum(POSICOES),
  dominios: z
    .array(dominioSchema)
    .max(MAX_DOMINIOS)
    .transform((lista) => [...new Set(lista)]),
  ativo: z.boolean(),
});

export type ConfigDoChat = z.infer<typeof configDoChatSchema>;

export const CONFIG_PADRAO: ConfigDoChat = {
  nome: "Atendimento",
  saudacao: "Olá! Como podemos ajudar?",
  cor: COR_PADRAO,
  posicao: "direita",
  dominios: [],
  ativo: false,
};

/**
 * A configuração gravada, campo a campo: o que não passar no schema volta ao
 * padrão. NUNCA lança — quem chama é a rota pública e o script do site.
 *
 * Coluna ilegível inteira (não é objeto) = padrão, e o padrão é DESLIGADO: um
 * chat sem configuração conhecida não aparece em site nenhum.
 */
export function lerConfigDoChat(bruto: unknown): ConfigDoChat {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ...CONFIG_PADRAO };
  const obj = bruto as Record<string, unknown>;
  const campo = <K extends keyof ConfigDoChat>(chave: K): ConfigDoChat[K] => {
    const parsed = configDoChatSchema.shape[chave].safeParse(obj[chave]);
    return parsed.success ? (parsed.data as ConfigDoChat[K]) : CONFIG_PADRAO[chave];
  };
  return {
    nome: campo("nome"),
    saudacao: campo("saudacao"),
    cor: campo("cor"),
    posicao: campo("posicao"),
    dominios: campo("dominios"),
    ativo: campo("ativo"),
  };
}

/**
 * O `Origin` desta requisição é de um site permitido?
 *
 * Casa o host exato (com a porta, quando a lista a traz) ou um SUBDOMÍNIO de um
 * domínio da lista: `loja.com.br` permite `www.loja.com.br`. Lista vazia não
 * permite nada — o chat só aparece onde a empresa disse.
 *
 * É proteção de NAVEGADOR (CORS): um cliente fora do navegador forja o
 * cabeçalho. O que segura abuso fora dele é o limite por IP e por visitante, e
 * o fato de nenhuma rota pública devolver dado sem o token do visitante.
 */
export function origemPermitida(origin: string | null | undefined, dominios: readonly string[]): boolean {
  if (!origin || dominios.length === 0) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.host.toLowerCase();
  const hostname = url.hostname.toLowerCase();
  return dominios.some((d) => {
    if (d.includes(":")) return host === d;
    return hostname === d || hostname.endsWith(`.${d}`);
  });
}

/** O snippet que a empresa cola no site. A chave é pública por natureza. */
export function snippetDoChat(baseUrl: string, chave: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `<script src="${base}/webchat.js" data-chave="${chave}" async></script>`;
}
