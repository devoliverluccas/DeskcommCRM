import { describe, expect, it } from "vitest";

import { ehFeriado, feriadoDaOrganizacaoNoDia, nacionaisDoAno, qualFeriado } from "./regra";

const PONTE = { data: "2026-11-23", nome: "Ponte", recorrente_anual: false };
const ANIVERSARIO = { data: "2025-03-19", nome: "Aniversário da cidade", recorrente_anual: true };

describe("ehFeriado — os cadastrados compostos com os nacionais", () => {
  it("feriado avulso vale só na data dele", () => {
    const org = { feriados: [PONTE], nacionais: false };
    expect(ehFeriado(org, "2026-11-23")).toBe(true);
    expect(ehFeriado(org, "2027-11-23")).toBe(false);
  });

  it("recorrente vale no mesmo dia e mês dos anos seguintes, nunca para trás", () => {
    const org = { feriados: [ANIVERSARIO], nacionais: false };
    expect(ehFeriado(org, "2026-03-19")).toBe(true);
    expect(ehFeriado(org, "2030-03-19")).toBe(true);
    expect(ehFeriado(org, "2024-03-19")).toBe(false);
    expect(ehFeriado(org, "2026-03-20")).toBe(false);
  });

  it("nacional só entra quando o chamador pede a composição", () => {
    expect(ehFeriado({ feriados: [], nacionais: false }, "2026-12-25")).toBe(false);
    expect(qualFeriado({ feriados: [], nacionais: true }, "2026-12-25")).toEqual({ origem: "nacional", nome: "Natal" });
  });

  it("o cadastrado vence o nacional no mesmo dia (o nome é o da organização)", () => {
    const org = { feriados: [{ data: "2026-12-25", nome: "Recesso", recorrente_anual: false }], nacionais: true };
    expect(qualFeriado(org, "2026-12-25")).toEqual({ origem: "organizacao", nome: "Recesso" });
  });

  it("data malformada não é feriado (nunca lança)", () => {
    expect(feriadoDaOrganizacaoNoDia([PONTE], "23/11/2026")).toBeNull();
  });
});

describe("nacionaisDoAno — o que 'importar nacionais' grava", () => {
  it("os 13 de 2026, em ordem, todos com nome, incluindo os móveis da Páscoa", () => {
    const lista = nacionaisDoAno(2026);
    expect(lista).toHaveLength(13);
    expect(lista.map((f) => f.data)).toEqual([...lista.map((f) => f.data)].sort());
    expect(lista.every((f) => f.nome !== "Feriado nacional")).toBe(true);
    // Páscoa de 2026 = 05/04: Sexta-feira Santa 03/04, Corpus Christi 04/06.
    expect(lista).toContainEqual({ data: "2026-04-03", nome: "Sexta-feira Santa", recorrente_anual: false });
    expect(lista).toContainEqual({ data: "2026-06-04", nome: "Corpus Christi", recorrente_anual: false });
  });
});
