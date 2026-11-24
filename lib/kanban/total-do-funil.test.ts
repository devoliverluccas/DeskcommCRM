import { describe, expect, it } from "vitest";

import type { Stage } from "@/lib/kanban/types";
import type { Lead } from "@/lib/types/leads";

import { totaisDoFunil } from "./total-do-funil";

function etapa(id: string, extra: Partial<Stage> = {}): Stage {
  return {
    id,
    organization_id: "o",
    pipeline_id: "p",
    name: id,
    slug: id,
    position: 0,
    color: null,
    is_won: false,
    is_lost: false,
    is_archived: false,
    expected_duration_hours: null,
    win_probability: null,
    ...extra,
  };
}

function negocio(
  stage_id: string,
  value_cents: number | null,
  currency: string | null = "BRL",
): Lead {
  return {
    id: `${stage_id}-${value_cents}`,
    stage_id,
    value_cents,
    currency,
    status: "open",
  } as unknown as Lead;
}

describe("total do funil", () => {
  const etapas = [
    etapa("proposta", { win_probability: 40 }),
    etapa("contato"), // sem chance calibrada
    etapa("ganho", { is_won: true }),
    etapa("perdido", { is_lost: true, win_probability: 90 }),
  ];

  it("soma bruto e ponderado com a régua da coluna: ganho 100, perda 0, espera pela etapa", () => {
    const t = totaisDoFunil(
      [
        negocio("proposta", 100_000),
        negocio("proposta", 50_001),
        negocio("ganho", 20_000),
        negocio("perdido", 70_000),
      ],
      etapas,
    );
    expect(t.negocios).toBe(4);
    expect(t.bruto.get("BRL")).toBe(240_001);
    // 40% de 100.000 + round(40% de 50.001) + 100% de 20.000 + 0% de 70.000
    expect(t.ponderado.get("BRL")).toBe(40_000 + 20_000 + 20_000 + 0);
    expect(t.semChance).toBe(0);
  });

  it("etapa sem chance fica fora do ponderado e é contada à parte", () => {
    const t = totaisDoFunil([negocio("contato", 10_000), negocio("proposta", 10_000)], etapas);
    expect(t.ponderado.get("BRL")).toBe(4_000);
    expect(t.semChance).toBe(1);
  });

  it("moedas não se somam; currency nulo é a moeda padrão", () => {
    const t = totaisDoFunil(
      [
        negocio("proposta", 10_000, null),
        negocio("proposta", 10_000, "EUR"),
        negocio("proposta", 5_000, "EUR"),
      ],
      etapas,
    );
    expect(t.bruto.get("BRL")).toBe(10_000);
    expect(t.bruto.get("EUR")).toBe(15_000);
    expect(t.primeira).toBe("EUR");
  });

  it("negócio sem valor conta no N e não cria moeda", () => {
    const t = totaisDoFunil([negocio("proposta", null, "USD")], etapas);
    expect(t.negocios).toBe(1);
    expect(t.bruto.size).toBe(0);
    expect(t.ponderado.size).toBe(0);
  });
});
