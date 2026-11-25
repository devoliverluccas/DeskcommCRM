import { describe, expect, it } from "vitest";

import { escolherMembroAtivo } from "./membro-ativo";

const VINCULOS = [
  { organization_id: "suspensa", org_status: "suspended" },
  { organization_id: "a", org_status: "active" },
  { organization_id: "b", org_status: "active" },
];

describe("escolherMembroAtivo", () => {
  it("cookie de empresa da pessoa vence — mesmo suspensa (é por ela que se chega ao hub)", () => {
    expect(escolherMembroAtivo(VINCULOS, "b")?.organization_id).toBe("b");
    expect(escolherMembroAtivo(VINCULOS, "suspensa")?.organization_id).toBe("suspensa");
  });

  it("sem cookie, ou com cookie alheio, a primeira operante na ordem dada", () => {
    expect(escolherMembroAtivo(VINCULOS, undefined)?.organization_id).toBe("a");
    expect(escolherMembroAtivo(VINCULOS, "alheia")?.organization_id).toBe("a");
  });

  it("nenhuma operante: a primeira; nenhuma: null", () => {
    expect(escolherMembroAtivo([VINCULOS[0]!], undefined)?.organization_id).toBe("suspensa");
    expect(escolherMembroAtivo([], "a")).toBeNull();
  });
});
