import { describe, expect, it } from "vitest";

import type { MetasDoSla } from "@/lib/schemas/settings";

import {
  agregarSlaDePrimeiraResposta,
  resumoDoSlaDePrimeiraResposta,
  type LinhaDoSlaDePrimeiraResposta,
} from "./sla-relatorio";

const AGORA = new Date("2026-11-23T15:00:00.000Z");
const SETOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SETOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let n = 0;
function linha(parcial: Partial<LinhaDoSlaDePrimeiraResposta>): LinhaDoSlaDePrimeiraResposta {
  n += 1;
  return {
    conversation_id: `c-${n}`,
    service_revision: 1,
    sector_id: null,
    inicio: "2026-11-23T10:00:00.000Z",
    respondida_em: "2026-11-23T10:10:00.000Z",
    ignorado: false,
    ...parcial,
  };
}

const metas: MetasDoSla = {
  primeira_resposta_min: 15,
  resolucao_horas: null,
  por_setor: { [SETOR_B]: { primeira_resposta_min: 5, resolucao_horas: null } },
};

describe("agregarSlaDePrimeiraResposta", () => {
  it("conta dentro, fora e pendente, e a porcentagem só sobre os decididos", () => {
    const r = agregarSlaDePrimeiraResposta(
      [
        linha({}), // 10 min de 15: dentro
        linha({ respondida_em: "2026-11-23T10:30:00.000Z" }), // 30 min: fora
        linha({ inicio: "2026-11-23T14:55:00.000Z", respondida_em: null }), // 5 min sem resposta: pendente
        linha({ inicio: "2026-11-23T12:00:00.000Z", respondida_em: null }), // 3h sem resposta: fora
      ],
      metas,
      {},
      AGORA,
    );
    expect(r).toMatchObject({ medidos: 3, dentro: 1, fora: 2, pendentes: 1, percentual_dentro: 33.3 });
  });

  it("a meta do setor vence a da organização", () => {
    const r = agregarSlaDePrimeiraResposta([linha({ sector_id: SETOR_B })], metas, {}, AGORA);
    // 10 min contra a meta de 5 do setor B.
    expect(r).toMatchObject({ dentro: 0, fora: 1 });
    expect(r.por_setor).toEqual([expect.objectContaining({ sector_id: SETOR_B, fora: 1, percentual_dentro: 0 })]);
  });

  it("ignorado e sem meta ficam FORA da conta, não dentro", () => {
    const semMeta: MetasDoSla = { primeira_resposta_min: null, resolucao_horas: null, por_setor: {} };
    expect(agregarSlaDePrimeiraResposta([linha({})], semMeta, {}, AGORA)).toMatchObject({
      medidos: 0,
      percentual_dentro: null,
    });
    expect(agregarSlaDePrimeiraResposta([linha({ ignorado: true })], metas, {}, AGORA).medidos).toBe(0);
  });

  it("o tempo fora do expediente do setor não conta", () => {
    // Domingo inteiro sem expediente: escreveu domingo 10:00, respondido segunda 09:05 local.
    const expedientes = {
      [SETOR_A]: {
        timezone: "America/Sao_Paulo",
        windows: [{ dow: 1, start: "09:00", end: "18:00" }],
      },
    };
    const r = agregarSlaDePrimeiraResposta(
      [linha({ sector_id: SETOR_A, inicio: "2026-11-22T13:00:00.000Z", respondida_em: "2026-11-23T12:05:00.000Z" })],
      metas,
      expedientes,
      AGORA,
    );
    expect(r).toMatchObject({ dentro: 1, fora: 0 });
  });
});

describe("resumoDoSlaDePrimeiraResposta", () => {
  it("lê metas, horários e atendimentos da MESMA organização e filtra por setor", async () => {
    const filtros: Array<[string, string, unknown]> = [];
    const chamadas: Array<[string, unknown]> = [];
    const consulta = (tabela: string, dados: unknown) => {
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filtros.push([tabela, col, v]);
          return q;
        },
        maybeSingle: async () => ({ data: dados, error: null }),
        then: (ok: (v: unknown) => unknown) => ok({ data: dados, error: null }),
      };
      return q;
    };
    const supabase = {
      from: (tabela: string) =>
        tabela === "organizations"
          ? consulta(tabela, { settings: { sla: { primeira_resposta_min: 15 } } })
          : consulta(tabela, [{ id: SETOR_A, schedule: {} }]),
      rpc: async (fn: string, args: unknown) => {
        chamadas.push([fn, args]);
        return {
          data: [linha({ sector_id: SETOR_A }), linha({ sector_id: null, respondida_em: "2026-11-23T11:00:00.000Z" })],
          error: null,
        };
      },
    };
    const r = await resumoDoSlaDePrimeiraResposta(supabase as never, {
      organizationId: "org-1",
      de: new Date("2026-11-01T00:00:00.000Z"),
      ate: AGORA,
      setorId: SETOR_A,
      agora: AGORA,
    });
    expect(chamadas[0]?.[0]).toBe("fn_sla_primeiras_respostas");
    expect(chamadas[0]?.[1]).toMatchObject({ p_organization_id: "org-1" });
    expect(filtros).toContainEqual(["organizations", "id", "org-1"]);
    expect(filtros).toContainEqual(["attendant_sectors", "organization_id", "org-1"]);
    expect(r).toMatchObject({ medidos: 1, dentro: 1, percentual_dentro: 100 });
  });
});
