import { describe, expect, it } from "vitest";

import { linhaDaFila, operadoresDoPainel, type OperadorDoRoster } from "./contas-do-monitoramento";

/**
 * 3.5 — as contas do Monitoramento do Painel.
 *
 * SABOTAGEM: tirar o automático da conta faz o primeiro caso dizer 5 em vez de
 * 3; tirar o piso de zero faz o segundo dizer -1; tirar o `present` da ordem
 * põe o offline carregado em cima do online.
 */

describe("3.5 — a linha da fila", () => {
  it("em atendimento = vivas − fila − automático; a espera só existe com fila", () => {
    const linha = linhaDaFila({
      all: 20,
      closed: 9,
      archived: 1,
      fila: 5,
      automatico: 2,
      fila_mais_antiga_desde: "2026-11-24T10:00:00.000Z",
    });
    expect(linha).toEqual({ naFila: 5, emAtendimento: 3, esperaDesde: "2026-11-24T10:00:00.000Z" });

    expect(linhaDaFila({ all: 3, closed: 3, fila: 0, fila_mais_antiga_desde: "2026-11-24T10:00:00.000Z" })).toEqual({
      naFila: 0,
      emAtendimento: 0,
      esperaDesde: null,
    });
  });

  it("nunca negativo, e sem resposta é tudo zero", () => {
    expect(linhaDaFila({ all: 4, closed: 2, fila: 3 }).emAtendimento).toBe(0);
    expect(linhaDaFila(undefined)).toEqual({ naFila: 0, emAtendimento: 0, esperaDesde: null });
  });
});

describe("3.5 — os operadores", () => {
  const op = (id: string, present: boolean, carga: number, role = "agent"): OperadorDoRoster => ({
    user_id: id,
    role,
    name: id,
    email: null,
    present,
    is_available: true,
    current_load: carga,
  });

  it("online primeiro, depois a maior carga; viewer fica fora", () => {
    const lista = operadoresDoPainel([
      op("offline-carregado", false, 9),
      op("online-leve", true, 1),
      op("online-cheio", true, 4),
      op("leitor", true, 0, "viewer"),
    ]);
    expect(lista.map((o) => o.user_id)).toEqual(["online-cheio", "online-leve", "offline-carregado"]);
  });
});
