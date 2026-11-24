/**
 * OS CANDIDATOS DA BUSCA VÊM DO BANCO — do catálogo INTEIRO, sem teto.
 *
 * ─── O defeito que isto conserta ────────────────────────────────────────────
 *
 * `crm_search_products` trazia os produtos ativos em páginas de 1000, até 10
 * páginas, e pontuava em memória. Teto: 10 mil itens. Num catálogo de 77 mil,
 * o produto que existe "não era encontrado" — estava além do teto, e o máximo
 * que a busca conseguia dizer era `varredura_parcial` ("não sei se tem").
 *
 * ─── A divisão de trabalho ──────────────────────────────────────────────────
 *
 * `fn_buscar_produtos` (migration 9481) escolhe QUEM CONCORRE: os
 * `CANDIDATOS_DA_BUSCA` mais parecidos do catálogo inteiro, com o código exato
 * na frente e o número que algum produto da loja tem já filtrando (o 128GB não
 * entra como candidato de quem pediu 256GB). A NOTA que decide o que o agente
 * vê continua sendo a de `lib/catalogo/busca.ts` — `buscarComRelaxamento` roda
 * em cima dos candidatos, com a mesma régua, o mesmo empate e o mesmo
 * relaxamento de número.
 *
 * Por que os dois lados, e não só o banco: a régua (palavra difusa, número
 * exato, inicial vale mais que distância) foi medida e tem teste em
 * TypeScript; reescrevê-la inteira em SQL seria ter duas, e a segunda
 * divergiria da primeira na próxima correção. O banco só precisa não deixar o
 * produto certo de fora — e para isso ele imita a nota de perto.
 *
 * A função é `security invoker`: pela sessão da tela a RLS vale; pelo service
 * role (o agente) quem corta é `p_org`, que aqui vem SEMPRE de quem chama a
 * partir de fonte confiável (sessão, token), nunca do input.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ordenarPorRelevancia, type ProdutoBuscavel } from "./busca";
import type { FiltrosDoCatalogo } from "./busca-da-tela";

/** Quantos candidatos a nota em memória recebe. */
export const CANDIDATOS_DA_BUSCA = 200;

export interface OpcoesDosCandidatos {
  /** As colunas de `catalog_products` que voltam (lista do PostgREST). */
  colunas: string;
  limite?: number;
  /** Só o que dá para vender: sem controle de estoque, ou com quantidade. */
  somenteDisponiveis?: boolean;
  categoria?: string | null;
  offset?: number;
}

/**
 * Os candidatos de `termo` na organização `orgId`, na ordem de semelhança.
 *
 * Erro do banco LANÇA: "não consegui procurar" não pode virar "não achei", que
 * é a frase que faz o agente dizer ao cliente que a loja não tem.
 */
export async function candidatosDaBusca<T>(
  supabase: SupabaseClient,
  orgId: string,
  termo: string,
  opcoes: OpcoesDosCandidatos,
): Promise<T[]> {
  const { data, error } = await supabase
    .rpc("fn_buscar_produtos", {
      p_org: orgId,
      p_termo: termo,
      p_limite: opcoes.limite ?? CANDIDATOS_DA_BUSCA,
      p_somente_disponiveis: opcoes.somenteDisponiveis ?? false,
      p_categoria: opcoes.categoria ?? null,
      p_offset: opcoes.offset ?? 0,
    })
    .select(opcoes.colunas);
  if (error) throw new Error(`buscar_produtos_falhou: ${error.message}`);
  return (data ?? []) as unknown as T[];
}

/** Quantos "parecidos" a tela mostra quando o texto digitado não está em produto nenhum. */
export const PARECIDOS_NA_TELA = 12;

/**
 * Os mais parecidos com `termo`, para a tela de Produtos quando a busca por
 * texto não acha nada ("ifone" num catálogo que escreve "iPhone").
 *
 * É a MESMA busca do agente — os candidatos da função e a nota de
 * `ordenarPorRelevancia` —, com os filtros da tela. Quem administra passa a ver
 * o que o atendente de IA acharia com aquelas palavras.
 */
export async function parecidosDaBusca<T extends ProdutoBuscavel>(
  supabase: SupabaseClient,
  orgId: string,
  termo: string,
  filtros: FiltrosDoCatalogo,
  colunas: string,
): Promise<T[]> {
  const candidatos = await candidatosDaBusca<T>(supabase, orgId, termo, {
    colunas,
    somenteDisponiveis: filtros.soComEstoque,
    categoria: filtros.categoria,
  });
  return ordenarPorRelevancia(candidatos, termo)
    .slice(0, PARECIDOS_NA_TELA)
    .map((a) => a.produto);
}

/**
 * As categorias que existem no catálogo da organização, em ordem alfabética —
 * as opções do filtro da tela (`fn_categorias_do_catalogo`, migration 9481).
 *
 * NUNCA lança: o filtro é conforto; sem ele a lista continua inteira. Um erro
 * aqui derrubar a tela de Produtos seria trocar um seletor por uma página de erro.
 */
export async function categoriasDoCatalogo(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("fn_categorias_do_catalogo", { p_org: orgId });
    if (error || !Array.isArray(data)) return [];
    return (data as Array<{ categoria?: unknown }>)
      .map((l) => (typeof l.categoria === "string" ? l.categoria : ""))
      .filter((c) => c.trim() !== "");
  } catch {
    return [];
  }
}
