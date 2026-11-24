/**
 * FERIADOS DA ORGANIZAÇÃO — a regra pura (item 3.8, migration 9486).
 *
 * Duas fontes, uma pergunta: "este DIA é feriado para esta organização?"
 *
 *   - os feriados que a organização CADASTROU (tabela `feriados`): avulsos, que
 *     valem numa data, e recorrentes, que valem no mesmo dia e mês todo ano;
 *   - os NACIONAIS do Brasil, de `lib/lgpd/holidays-br.ts` — a única régua de
 *     feriado nacional do produto. Nenhuma segunda lista de datas mora aqui:
 *     duas listas divergem no primeiro ano em que uma delas é atualizada.
 *
 * A pergunta é por DATA CIVIL (`AAAA-MM-DD`), não por instante: quem chama
 * escolhe o fuso e converte antes (`dataIsoNoFuso`). Um instante aqui dentro
 * obrigaria esta função a adivinhar o fuso — e feriado no dia errado é pior que
 * feriado nenhum (o mesmo argumento de `feriado-nacional.ts`).
 *
 * `nacionais` é opção do chamador, não da regra: o horário das jornadas e filas
 * (`isWithinSchedule`) pergunta SÓ pelos cadastrados — o nacional entra no
 * expediente quando a organização o importa (ver o cabeçalho da 9486).
 */
import { HOLIDAYS_BR_ISO, feriadosDoBrasilDoAno } from "@/lib/lgpd/holidays-br";
import { diaEmTornoDaPascoa } from "@/lib/lgpd/pascoa";

export interface FeriadoDaOrganizacao {
  /** `AAAA-MM-DD`. No recorrente, a data em que foi cadastrado (vale o dia e o mês). */
  data: string;
  nome: string;
  recorrente_anual: boolean;
}

export interface CalendarioDaOrganizacao {
  feriados: readonly FeriadoDaOrganizacao[];
  /** Compor com os nacionais do Brasil. */
  nacionais: boolean;
}

export type FeriadoEncontrado =
  | { origem: "organizacao"; nome: string }
  | { origem: "nacional"; nome: string };

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const NACIONAIS = new Set(HOLIDAYS_BR_ISO);

/** O feriado CADASTRADO que cai nesta data, ou `null`. Avulso vence recorrente. */
export function feriadoDaOrganizacaoNoDia(
  feriados: readonly FeriadoDaOrganizacao[],
  dataIso: string,
): FeriadoDaOrganizacao | null {
  if (!DATA_ISO.test(dataIso)) return null;
  const mesDia = dataIso.slice(5);
  let recorrente: FeriadoDaOrganizacao | null = null;
  for (const f of feriados) {
    if (f.data === dataIso) return f;
    // O recorrente vale a partir do ano em que foi cadastrado, não para trás.
    if (f.recorrente_anual && recorrente === null && f.data.slice(5) === mesDia && f.data <= dataIso) {
      recorrente = f;
    }
  }
  return recorrente;
}

/** Qual feriado cai neste dia para a organização — o cadastrado primeiro. */
export function qualFeriado(org: CalendarioDaOrganizacao, dataIso: string): FeriadoEncontrado | null {
  const daOrg = feriadoDaOrganizacaoNoDia(org.feriados, dataIso);
  if (daOrg) return { origem: "organizacao", nome: daOrg.nome };
  if (org.nacionais && NACIONAIS.has(dataIso)) {
    return { origem: "nacional", nome: nomeDoNacional(dataIso) ?? "Feriado nacional" };
  }
  return null;
}

/** Este dia é feriado para a organização? */
export function ehFeriado(org: CalendarioDaOrganizacao, dataIso: string): boolean {
  return qualFeriado(org, dataIso) !== null;
}

const NOMES_FIXOS: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Dia Nacional de Zumbi e da Consciência Negra",
  "12-25": "Natal",
};

/** O nome de um feriado nacional pela data, ou `null` se a data não é um. */
export function nomeDoNacional(dataIso: string): string | null {
  if (!NACIONAIS.has(dataIso)) return null;
  const ano = Number(dataIso.slice(0, 4));
  const moveis: Record<string, string> = {
    [diaEmTornoDaPascoa(ano, -48)]: "Carnaval (segunda-feira)",
    [diaEmTornoDaPascoa(ano, -47)]: "Carnaval (terça-feira)",
    [diaEmTornoDaPascoa(ano, -2)]: "Sexta-feira Santa",
    [diaEmTornoDaPascoa(ano, 60)]: "Corpus Christi",
  };
  return moveis[dataIso] ?? NOMES_FIXOS[dataIso.slice(5)] ?? null;
}

/** Os nacionais de um ano, com nome, em ordem — o que "importar nacionais" grava. */
export function nacionaisDoAno(ano: number): FeriadoDaOrganizacao[] {
  return feriadosDoBrasilDoAno(ano)
    .slice()
    .sort()
    .map((data) => ({ data, nome: nomeDoNacional(data) ?? "Feriado nacional", recorrente_anual: false }));
}

/**
 * O predicado que `isWithinSchedule` recebe: "esta data local é feriado da
 * organização?". Um lugar só monta o predicado a partir da lista cadastrada —
 * roteador, escalação, plantão e destinatários de aviso dizem a mesma coisa.
 */
export function predicadoDeFeriado(
  feriados: readonly FeriadoDaOrganizacao[],
): ((dataIso: string) => boolean) | undefined {
  if (feriados.length === 0) return undefined;
  return (dataIso) => feriadoDaOrganizacaoNoDia(feriados, dataIso) !== null;
}
