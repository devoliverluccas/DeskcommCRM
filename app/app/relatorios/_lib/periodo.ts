/**
 * O PERÍODO E A ABA DE `/app/relatorios` (3.6), lidos da URL.
 *
 * A URL é a fonte: `?aba=atendimentos&p=30` (ou `p=personalizado&de=…&ate=…`)
 * abre a mesma tela em qualquer aba do navegador e pode ser mandada a um
 * colega. Os dias são CIVIS no fuso da ORGANIZAÇÃO — o mesmo que as rotas usam
 * para recortar (`janelaDoRelatorio`) —, nunca no fuso do navegador.
 */
import { dataNoFuso, fusoDoRelatorio, janelaDoRelatorio, periodoPassaDoTeto } from "@/lib/relatorios/janela";

export const ABAS = ["desempenho", "atendimentos", "sla", "satisfacao", "origens", "atribuicao"] as const;
export type Aba = (typeof ABAS)[number];

/** As abas que só quem gerencia vê (as rotas cobram `manager`). */
const ABAS_DE_GESTAO: readonly Aba[] = ["sla", "satisfacao", "atribuicao"];

export function abasVisiveis(podeGerenciar: boolean): Aba[] {
  return ABAS.filter((a) => podeGerenciar || !ABAS_DE_GESTAO.includes(a));
}

/** Aba desconhecida, ou de gestão para quem não gerencia, abre em Desempenho. */
export function abaDaUrl(valor: string | null | undefined, podeGerenciar: boolean): Aba {
  const visiveis = abasVisiveis(podeGerenciar);
  return (visiveis as readonly string[]).includes(valor ?? "") ? (valor as Aba) : "desempenho";
}

export const PRESETS = ["7", "30", "90"] as const;
export type Preset = (typeof PRESETS)[number] | "personalizado";

export interface Periodo {
  preset: Preset;
  /** Primeiro dia civil, inclusivo (`YYYY-MM-DD`). */
  de: string;
  /** Último dia civil, inclusivo. */
  ate: string;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` deslocado em dias de calendário (aritmética em UTC, sem fuso). */
export function deslocarDia(dia: string, delta: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Os N dias que terminam hoje, no fuso da organização (hoje incluído). */
export function periodoDoPreset(dias: number, agora: Date, fuso: string): { de: string; ate: string } {
  const ate = dataNoFuso(agora, fusoDoRelatorio(fuso));
  return { de: deslocarDia(ate, -(dias - 1)), ate };
}

/**
 * Lê o período da URL. Sem nada = últimos 30 dias. Personalizado com datas
 * tortas, invertidas ou acima do teto da casa volta para os 30 dias — a tela
 * nunca pede à rota um período que ela recusaria.
 */
export function periodoDaUrl(
  sp: { get(chave: string): string | null },
  agora: Date,
  fuso: string,
): Periodo {
  const p = sp.get("p");
  if (p === "personalizado") {
    const de = sp.get("de") ?? "";
    const ate = sp.get("ate") ?? "";
    if (
      DIA.test(de) &&
      DIA.test(ate) &&
      !Number.isNaN(Date.parse(`${de}T00:00:00Z`)) &&
      !Number.isNaN(Date.parse(`${ate}T00:00:00Z`)) &&
      de <= ate &&
      !periodoPassaDoTeto(de, ate)
    ) {
      return { preset: "personalizado", de, ate };
    }
  }
  const preset = (PRESETS as readonly string[]).includes(p ?? "") ? (p as Preset) : "30";
  const dias = preset === "personalizado" ? 30 : Number(preset);
  return { preset: preset === "personalizado" ? "30" : preset, ...periodoDoPreset(dias, agora, fuso) };
}

/** Os instantes `[from, to)` do período, para as rotas que pedem ISO. */
export function instantesDoPeriodo(periodo: Pick<Periodo, "de" | "ate">, fuso: string): { from: string; to: string } {
  const j = janelaDoRelatorio(periodo.de, periodo.ate, fuso);
  return { from: j.from, to: j.to };
}
