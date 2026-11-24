/**
 * OS FILTROS SALVOS DO FUNIL — por aparelho, por funil (fase 1, item 1.6).
 *
 * Quem olha o funil todo dia repete as mesmas perguntas ("os meus atrasados",
 * "perdidos por preço") e montava o filtro chip a chip a cada visita. Aqui a
 * combinação ganha um nome e fica no `localStorage`, no molde de
 * `lib/inbox/filtros-lembrados.ts`: preferência de quem olha a tela, não dado
 * do sistema — por isso não é coluna nem `settings` do funil.
 *
 * Por FUNIL: responsável, etiqueta e motivo de perda só existem no funil onde o
 * filtro foi montado. Aplicado em outro, viraria um quadro vazio sem motivo
 * aparente.
 *
 * O filtro é guardado como a QUERY STRING do quadro (`filtersToParams`), e
 * volta por `filtersFromParams` — a mesma porta do deep-link. Assim um filtro
 * salvo e um link colado no chat têm um único sentido, e o que estiver torto
 * no armazenamento cai nos padrões que a URL já tolera.
 */
import { filtersFromParams, filtersToParams, type LeadFilters } from "@/lib/kanban/filters";

export interface FiltroSalvo {
  nome: string;
  /** A query string do filtro, como `filtersToParams` a escreve. */
  consulta: string;
}

type Armazenamento = Pick<Storage, "getItem" | "setItem">;

export const CHAVE_DOS_FILTROS_SALVOS = "funil:filtros-salvos:v1";

/** Teto por funil: a lista é um seletor, não um arquivo. */
export const MAXIMO_DE_FILTROS_SALVOS = 20;

/** Teto do nome: cabe no menu sem quebrar a linha. */
export const TAMANHO_MAXIMO_DO_NOME = 60;

function lerTudo(storage: Armazenamento): Record<string, unknown> {
  try {
    const cru = JSON.parse(storage.getItem(CHAVE_DOS_FILTROS_SALVOS) ?? "{}");
    return cru && typeof cru === "object" && !Array.isArray(cru) ? cru : {};
  } catch {
    return {};
  }
}

function gravarTudo(storage: Armazenamento, tudo: Record<string, unknown>): void {
  try {
    storage.setItem(CHAVE_DOS_FILTROS_SALVOS, JSON.stringify(tudo));
  } catch {
    // Quota cheia ou armazenamento bloqueado: o filtro só não fica salvo.
  }
}

const mesmoNome = (a: string, b: string) =>
  a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

/** Os filtros salvos deste funil, na ordem em que foram salvos; `[]` quando nada (ou lixo). */
export function lerFiltrosSalvos(storage: Armazenamento | null, pipelineId: string): FiltroSalvo[] {
  if (!storage) return [];
  const lista = lerTudo(storage)[pipelineId];
  if (!Array.isArray(lista)) return [];
  const saida: FiltroSalvo[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const { nome, consulta } = item as Record<string, unknown>;
    if (typeof nome !== "string" || !nome.trim()) continue;
    if (typeof consulta !== "string") continue;
    if (saida.some((f) => mesmoNome(f.nome, nome))) continue;
    saida.push({ nome: nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME), consulta });
    if (saida.length >= MAXIMO_DE_FILTROS_SALVOS) break;
  }
  return saida;
}

/**
 * Salva o filtro com este nome neste funil, sem tocar nos dos outros funis.
 * O mesmo nome (sem diferenciar maiúscula) SUBSTITUI o anterior no lugar dele;
 * nome vazio não salva. Devolve a lista resultante.
 */
export function salvarFiltro(
  storage: Armazenamento | null,
  pipelineId: string,
  nome: string,
  filtros: LeadFilters,
): FiltroSalvo[] {
  const limpo = nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME);
  const atuais = lerFiltrosSalvos(storage, pipelineId);
  if (!storage || !limpo) return atuais;
  const novo: FiltroSalvo = { nome: limpo, consulta: filtersToParams(filtros) };
  const indice = atuais.findIndex((f) => mesmoNome(f.nome, limpo));
  const proximos =
    indice >= 0
      ? atuais.map((f, i) => (i === indice ? novo : f))
      : [...atuais, novo].slice(-MAXIMO_DE_FILTROS_SALVOS);
  const tudo = lerTudo(storage);
  tudo[pipelineId] = proximos;
  gravarTudo(storage, tudo);
  return proximos;
}

/** Apaga o filtro com este nome deste funil. Devolve a lista resultante. */
export function apagarFiltroSalvo(
  storage: Armazenamento | null,
  pipelineId: string,
  nome: string,
): FiltroSalvo[] {
  const atuais = lerFiltrosSalvos(storage, pipelineId);
  if (!storage) return atuais;
  const proximos = atuais.filter((f) => !mesmoNome(f.nome, nome));
  const tudo = lerTudo(storage);
  if (proximos.length === 0) delete tudo[pipelineId];
  else tudo[pipelineId] = proximos;
  gravarTudo(storage, tudo);
  return proximos;
}

/** O filtro que um salvo representa — pela mesma porta do deep-link. */
export function filtrosDoSalvo(salvo: FiltroSalvo): LeadFilters {
  return filtersFromParams(new URLSearchParams(salvo.consulta));
}
