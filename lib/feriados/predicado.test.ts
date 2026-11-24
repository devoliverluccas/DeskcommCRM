import { describe, expect, it } from "vitest";

import { podeAssumirAgora, type AtendenteDoRoster } from "@/lib/escalacao/atendentes";
import { estaDePlantao } from "@/lib/routing/eligibility";

import { predicadoDeFeriado } from "./regra";

/**
 * O feriado CADASTRADO chega também à escalação e ao plantão (item 3.8), não só
 * ao roteador: a tela da equipe, o aviso ao lead e a ferramenta do agente dizem
 * a mesma coisa que a distribuição. Sem o predicado, nada muda.
 */
const agenda = {
  timezone: "America/Sao_Paulo",
  windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "00:00", end: "23:59" })),
};
// 24/12/2026 15:00 UTC = 12:00 em São Paulo.
const agora = new Date("2026-12-24T15:00:00.000Z");
const natal = predicadoDeFeriado([{ data: "2026-12-24", nome: "Véspera", recorrente_anual: false }]);

describe("feriado da organização fora do roteador", () => {
  it("lista vazia não monta predicado", () => {
    expect(predicadoDeFeriado([])).toBeUndefined();
  });

  it("estaDePlantao: no feriado cadastrado, quem tem horário fica fora", () => {
    expect(estaDePlantao({ isAvailable: true, schedule: agenda }, agora)).toBe(true);
    expect(estaDePlantao({ isAvailable: true, schedule: agenda }, agora, natal)).toBe(false);
  });

  it("podeAssumirAgora: idem, com a mesma régua", () => {
    const a = {
      userId: "u",
      papel: "agent",
      disponivel: true,
      capacidade: 5,
      agenda,
      atualizadoEm: null,
      cargaAtual: 0,
      ultimoSinalEm: null,
      presente: true,
    } as unknown as AtendenteDoRoster;
    expect(podeAssumirAgora(a, agora)).toBe(true);
    expect(podeAssumirAgora(a, agora, natal)).toBe(false);
  });
});
