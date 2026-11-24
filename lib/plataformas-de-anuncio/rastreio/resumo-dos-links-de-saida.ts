/**
 * O RESUMO DOS LINKS DE SAÍDA — o que a tela mostra (migration 9490).
 *
 * A leitura passa por `fn_links_de_saida_resumo` (só service role): a conta de
 * cliques exclui o robô de prévia, e o nome do contato vem do cadastro na hora
 * — o link não copia o nome (anonimizar o contato o tira da lista sozinho).
 *
 * Os agrupamentos ("por rótulo", "por contato") são CONTA sobre a lista, aqui,
 * puros, para a tela e o teste lerem a mesma regra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LinkDeSaidaResumo {
  id: string;
  codigo: string;
  destino_url: string;
  rotulo: string | null;
  contact_id: string | null;
  contato_nome: string | null;
  anonimizado: boolean;
  created_at: string;
  cliques: number;
  ultimo_clique: string | null;
}

/** A organização vem da SESSÃO de quem chama — nunca do navegador. */
export async function lerResumoDosLinks(
  admin: SupabaseClient,
  organizationId: string,
): Promise<LinkDeSaidaResumo[]> {
  const { data, error } = await admin.rpc("fn_links_de_saida_resumo", { p_org: organizationId, p_limite: 500 });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Omit<LinkDeSaidaResumo, "cliques"> & { cliques: number | string }>).map((l) => ({
    ...l,
    // `bigint` chega do PostgREST como número ou texto, conforme o tamanho.
    cliques: Number(l.cliques) || 0,
  }));
}

export interface GrupoDeLinks {
  /** O rótulo (campanha) ou o id do contato; `null` = sem rótulo / sem contato. */
  chave: string | null;
  /** O que a tela escreve: o próprio rótulo, ou o nome do contato. */
  nome: string | null;
  links: number;
  cliques: number;
  /** Quantos links do grupo tiveram ao menos um clique de gente. */
  abertos: number;
}

function agrupar(
  lista: readonly LinkDeSaidaResumo[],
  chaveDe: (l: LinkDeSaidaResumo) => { chave: string | null; nome: string | null },
): GrupoDeLinks[] {
  const grupos = new Map<string, GrupoDeLinks>();
  for (const l of lista) {
    const { chave, nome } = chaveDe(l);
    const id = chave ?? "\u0000";
    const g = grupos.get(id) ?? { chave, nome, links: 0, cliques: 0, abertos: 0 };
    g.links += 1;
    g.cliques += l.cliques;
    if (l.cliques > 0) g.abertos += 1;
    grupos.set(id, g);
  }
  // Mais clicado primeiro; o grupo "sem" sempre por último.
  return [...grupos.values()].sort((a, b) =>
    a.chave === null ? 1 : b.chave === null ? -1 : b.cliques - a.cliques || (a.nome ?? a.chave).localeCompare(b.nome ?? b.chave),
  );
}

/** Cliques por rótulo (a campanha do `{{link:…|rótulo}}`). */
export function porRotulo(lista: readonly LinkDeSaidaResumo[]): GrupoDeLinks[] {
  return agrupar(lista, (l) => ({ chave: l.rotulo, nome: l.rotulo }));
}

/** Cliques por contato (pelo id; o nome é o do cadastro). Anonimizado e sem contato caem no "sem". */
export function porContato(lista: readonly LinkDeSaidaResumo[]): GrupoDeLinks[] {
  return agrupar(lista, (l) => ({ chave: l.contact_id, nome: l.contact_id === null ? null : l.contato_nome }));
}
