import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isAttendantEligible, isWithinSchedule } from "./eligibility";
import { loadEligibleAttendants, loadSectorWindow } from "./eligibles";

/**
 * Item 3.8 — feriado CADASTRADO pela organização é fora do expediente.
 *
 * Segunda-feira, 23/11/2026, 15h em São Paulo (18:00Z), dentro de uma jornada
 * de segunda das 08h às 18h. Sem feriado: dentro. Com a ponte cadastrada: fora.
 * Jornada vazia (24/7) continua aceitando — quem não restringiu horário não passa
 * a fechar no feriado sem ter pedido.
 */
const AGORA = new Date("2026-11-23T18:00:00Z");
const JORNADA = { timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "08:00", end: "18:00" }] };
const PONTE = (dataIso: string) => dataIso === "2026-11-23";

describe("isWithinSchedule com o feriado da organização", () => {
  it("dentro da jornada num dia comum", () => {
    expect(isWithinSchedule(JORNADA, AGORA)).toBe(true);
    expect(isWithinSchedule(JORNADA, AGORA, () => false)).toBe(true);
  });

  it("feriado da organização fecha o expediente", () => {
    expect(isWithinSchedule(JORNADA, AGORA, PONTE)).toBe(false);
    expect(
      isAttendantEligible({ isAvailable: true, capacity: 3, currentLoad: 0, schedule: JORNADA }, AGORA, PONTE),
    ).toBe(false);
  });

  it("a data perguntada é a do FUSO da jornada, não a UTC", () => {
    // 23/11 às 23h30 em São Paulo = 24/11 02:30Z. A ponte é do dia 23 LOCAL.
    const noite = new Date("2026-11-24T02:30:00Z");
    const todaNoite = { timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "00:00", end: "23:59" }] };
    const perguntadas: string[] = [];
    isWithinSchedule(todaNoite, noite, (d) => {
      perguntadas.push(d);
      return false;
    });
    expect(perguntadas).toEqual(["2026-11-23"]);
  });

  it("jornada vazia (24/7) não fecha no feriado", () => {
    expect(isWithinSchedule({ timezone: "America/Sao_Paulo", windows: [] }, AGORA, PONTE)).toBe(true);
  });
});

/** Banco de mentira só com o que o carregador lê; `feriados` é a tabela da 9486. */
function banco(rows: Record<string, unknown>) {
  const lidas: string[] = [];
  const db = {
    from(tabela: string) {
      lidas.push(tabela);
      const q = {
        select: () => q,
        order: () => q,
        eq: () => q,
        is: () => q,
        in: () => q,
        maybeSingle: () => Promise.resolve({ data: rows[tabela] ?? null, error: null }),
        then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: rows[tabela] ?? [], error: null }).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, lidas };
}

describe("o roteador lê os feriados da organização (lib/routing/eligibles.ts)", () => {
  const base = {
    user_organizations: [{ user_id: "ana" }],
    attendant_availability: [{ user_id: "ana", capacity: 2, schedule: JORNADA }],
    conversations: [],
    conversation_assignment_events: [],
  };

  it("na ponte cadastrada, a atendente com jornada não é elegível", async () => {
    const { db } = banco({ ...base, feriados: [{ data: "2026-11-23", nome: "Ponte", recorrente_anual: false }] });
    expect(await loadEligibleAttendants(db, "org", AGORA, { kind: "organization_summary" })).toEqual([]);
  });

  it("sem feriado cadastrado, ela é elegível (controle)", async () => {
    const { db } = banco({ ...base, feriados: [] });
    expect(await loadEligibleAttendants(db, "org", AGORA, { kind: "organization_summary" })).toMatchObject([
      { userId: "ana" },
    ]);
  });

  it("ninguém com jornada: a tabela de feriados nem é lida", async () => {
    const { db, lidas } = banco({
      ...base,
      attendant_availability: [{ user_id: "ana", capacity: 2, schedule: {} }],
      feriados: [{ data: "2026-11-23", nome: "Ponte", recorrente_anual: false }],
    });
    expect(await loadEligibleAttendants(db, "org", AGORA, { kind: "organization_summary" })).toHaveLength(1);
    expect(lidas).not.toContain("feriados");
  });

  it("a fila com horário fecha na ponte", async () => {
    const { db } = banco({
      attendant_sectors: { id: "setor", schedule: JORNADA },
      feriados: [{ data: "2026-11-23", nome: "Ponte", recorrente_anual: false }],
    });
    const { window } = await loadSectorWindow(db, "org", "setor", AGORA);
    expect(window.open).toBe(false);
  });
});
