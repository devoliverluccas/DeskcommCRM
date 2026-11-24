/**
 * A BUSCA DA TELA DE PRODUTOS — a mesma régua para a página e para a rota.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * A tela carregava os 500 primeiros produtos e filtrava NO NAVEGADOR. Num
 * catálogo maior que isso, o resto não aparecia nem pela busca: medido numa
 * instalação com ~4.400 produtos, cerca de 3.900 eram inalcançáveis para quem
 * administra — enquanto o agente, que busca no servidor
 * (`lib/mcp/tools/comercio.ts`), enxergava todos. Agora a busca vai ao banco.
 *
 * ─── O termo, antes de virar filtro ─────────────────────────────────────────
 *
 * A mesma composição da busca de contatos (`app/api/v1/contacts/_handler.ts`):
 *
 *   parênteses saem ANTES  → são delimitador do DSL do `.or()` do PostgREST, e
 *                            a normalização não os conhece
 *   normalizarTermoDeBusca → como a pessoa digita: espaço, vírgula e ponto e
 *                            vírgula viram um curinga só ("glock 17" acha
 *                            "Glock G17") — e a vírgula, que injetaria uma
 *                            condição no `.or()`, some
 *   `\`, `%`, `_` escapados → gramática do LIKE: curinga digitado é literal, e a
 *                            própria barra (o escape do LIKE) também — sem isso
 *                            `abc\` engolia o curinga do fim e não achava nada
 *
 * A rota montava o `.or()` com o texto cru: um nome com vírgula injetava
 * condição, um parêntese sem par derrubava a busca com 400 e `%` virava
 * curinga. E `buscaValeConsulta` barra o termo curto ou só de pontuação, que
 * normalizado viraria `%%`: aqui ele vira `null`, e o QUE fazer com o `null`
 * é de quem chama. A rota devolve lista vazia, como a busca de contatos (sem
 * isso, `null` era consulta sem filtro — o catálogo inteiro no seletor da
 * proposta); a tela mostra a lista sem filtro, como se não houvesse busca.
 *
 * A busca da TELA continua sendo substring simples, de propósito: quem opera a
 * loja digita como cadastrou, e a lista tem contagem exata e páginas. A busca
 * por token, que tolera "ifone", é a do agente, em `lib/catalogo/busca.ts`.
 * Desde a migration 9481 a tela usa a do agente quando a substring não acha
 * nada: em vez de "nenhum produto", mostra os mais parecidos
 * (`parecidosDaBusca`, na página) — o mesmo `fn_buscar_produtos` e a mesma
 * pontuação, sem paginar.
 */
import { buscaValeConsulta, normalizarTermoDeBusca } from "@/lib/inbox/termo-de-busca";

/** Produtos por página na tela. */
export const PRODUTOS_POR_PAGINA = 50;

/**
 * O filtro `or=` da busca, ou `null` quando o termo não vale uma consulta
 * (vazio, curto demais ou só pontuação). `null` NÃO significa "sem filtro":
 * cada chamador decide (ver o cabeçalho deste arquivo).
 */
export function filtroDaBuscaDoCatalogo(bruto: string | null | undefined): string | null {
  const termo = (bruto ?? "").trim();
  if (!buscaValeConsulta(termo)) return null;
  const s = normalizarTermoDeBusca(termo.replace(/[()]/g, " ")).replace(/[\\%_]/g, (m) => `\\${m}`);
  const colunas = ["nome", "codigo", "marca", "categoria"].map((c) => `${c}.ilike.*${s}*`);
  // SEM ACENTO (9481): "sofa" acha "Sofá". A coluna gerada `busca_normalizada`
  // guarda o texto sem acento e minúsculo; o termo é dobrado do mesmo jeito.
  // Só ACRESCENTA uma condição ao `or`: tudo que a substring achava continua
  // achado, e a contagem segue exata.
  const semAcento = s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  colunas.push(`busca_normalizada.ilike.*${semAcento}*`);
  return colunas.join(",");
}

/**
 * A página pedida, quando a URL pede uma de verdade: inteiro ≥ 1, escrito só
 * com dígitos. `null` para ausente ou inválida (`0`, `-3`, `abc`, `2x`).
 */
export function paginaPedida(bruto: string | null | undefined): number | null {
  if (bruto === null || bruto === undefined || !/^\d+$/.test(bruto.trim())) return null;
  const n = Number(bruto.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** A página pedida na URL, sempre um inteiro ≥ 1 (a 1 quando ausente ou inválida). */
export function paginaDaUrl(bruto: string | null | undefined): number {
  return paginaPedida(bruto) ?? 1;
}

/** O intervalo `range(de, ate)` do PostgREST para a página. */
export function intervaloDaPagina(pagina: number, porPagina = PRODUTOS_POR_PAGINA): [number, number] {
  const de = (pagina - 1) * porPagina;
  return [de, de + porPagina - 1];
}

/**
 * Página além da última. O PostgREST NÃO devolve lista vazia quando o `range`
 * começa depois do total: responde 416 com este código ("Requested range not
 * satisfiable"). Medido contra o PostgREST do Supabase local (CLI 2.117.0),
 * tabela com 3 linhas: `Range: 3-4` → 206 e `[]`; `Range: 50-99` → 416
 * `PGRST103`. Acontece de verdade quando alguém apaga o único produto da última
 * página, ou abre um link antigo.
 *
 * ⚠️ O 416 só vem quando o início PASSA do total. Começar EXATAMENTE no total
 * (50 produtos, página 2) é 206 com lista vazia, sem erro — quem chama trata
 * os dois casos como "página além da última".
 */
export const FAIXA_ALEM_DO_FIM = "PGRST103";

/** A última página que existe para `total` produtos (1 quando não há nenhum). */
export function ultimaPagina(total: number, porPagina = PRODUTOS_POR_PAGINA): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

/**
 * OS FILTROS DA TELA E DA ROTA — categoria e "só com estoque" (migration 9481).
 *
 * Moram na URL como a busca: a lista que a pessoa vê é a do servidor, do
 * catálogo inteiro, e o link copiado abre a mesma lista.
 */
export interface FiltrosDoCatalogo {
  /** Categoria exata (como cadastrada). `null` = todas. */
  categoria: string | null;
  /** Só o que dá para vender: sem controle de estoque, ou com quantidade. */
  soComEstoque: boolean;
}

export const SEM_FILTROS: FiltrosDoCatalogo = { categoria: null, soComEstoque: false };

/** Mesmo teto do campo no schema do produto: categoria maior que isso não existe. */
const TETO_DA_CATEGORIA = 80;

/** A categoria pedida, aparada; `null` para ausente, vazia ou maior que o campo. */
export function categoriaPedida(bruto: string | null | undefined): string | null {
  const c = (bruto ?? "").trim();
  return c === "" || c.length > TETO_DA_CATEGORIA ? null : c;
}

/** `?estoque=1` (ou `true`) liga o filtro; qualquer outra coisa, não. */
export function soComEstoquePedido(bruto: string | null | undefined): boolean {
  const v = (bruto ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Os filtros lidos da URL (tela) ou da query string (rota). */
export function filtrosDaUrl(params: {
  categoria?: string | null;
  estoque?: string | null;
}): FiltrosDoCatalogo {
  return { categoria: categoriaPedida(params.categoria), soComEstoque: soComEstoquePedido(params.estoque) };
}

/**
 * O filtro `or=` de "só com estoque": a mesma regra da busca do agente
 * (`controla_estoque` falso conta como disponível — decant, sob encomenda).
 *
 * Vai num `.or()` PRÓPRIO, separado do da busca: o PostgREST junta dois
 * parâmetros `or` com E (medido contra o PostgREST local: `or=(a,b)&or=(b,c)`
 * devolve só `b`).
 */
export const FILTRO_COM_ESTOQUE = "controla_estoque.eq.false,quantidade.gt.0";

/** A query string da tela: busca vazia, página 1 e filtros desligados ficam de fora. */
export function queryDaTela(
  busca: string,
  pagina: number,
  filtros: FiltrosDoCatalogo = SEM_FILTROS,
): string {
  const qs = new URLSearchParams();
  if (busca.trim() !== "") qs.set("busca", busca.trim());
  if (filtros.categoria) qs.set("categoria", filtros.categoria);
  if (filtros.soComEstoque) qs.set("estoque", "1");
  if (pagina > 1) qs.set("pagina", String(pagina));
  const s = qs.toString();
  return s ? `?${s}` : "";
}
