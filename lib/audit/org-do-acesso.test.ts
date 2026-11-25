/**
 * Em qual empresa um acesso fica registrado: a MESMA que `resolveActiveOrg`
 * abriria — cookie `active_org` se ainda é membro, senão a primeira operante.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  vinculos: [] as Array<{ organization_id: string; organizations: { status: string } | null }>,
  erro: null as { message: string } | null,
  cookie: undefined as string | undefined,
  filtros: [] as Array<[string, unknown]>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (nome: string) => (nome === "active_org" && m.cookie ? { value: m.cookie } : undefined) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        m.filtros.push([c, v]);
        return q;
      },
      is: (c: string, v: unknown) => {
        m.filtros.push([`is:${c}`, v]);
        return q;
      },
      order: () => q,
      then: (ok: (r: unknown) => unknown) => ok({ data: m.erro ? null : m.vinculos, error: m.erro }),
    };
    return { from: () => q };
  },
}));

import { orgDaSessaoDoAcesso } from "./org-do-acesso";

beforeEach(() => {
  m.vinculos = [
    { organization_id: "org-suspensa", organizations: { status: "suspended" } },
    { organization_id: "org-a", organizations: { status: "active" } },
    { organization_id: "org-b", organizations: { status: "active" } },
  ];
  m.erro = null;
  m.cookie = undefined;
  m.filtros = [];
});

describe("orgDaSessaoDoAcesso", () => {
  it("sem cookie, a primeira empresa operante — nunca a suspensa", async () => {
    expect(await orgDaSessaoDoAcesso("u1")).toBe("org-a");
    expect(m.filtros).toContainEqual(["user_id", "u1"]);
    expect(m.filtros).toContainEqual(["is:revoked_at", null]);
  });

  it("com cookie de uma empresa da pessoa, é ela (uma só: não replica nas outras)", async () => {
    m.cookie = "org-b";
    expect(await orgDaSessaoDoAcesso("u1")).toBe("org-b");
  });

  it("cookie de empresa alheia é ignorado — o cookie só ESCOLHE entre vínculos vivos", async () => {
    m.cookie = "org-de-outra-pessoa";
    expect(await orgDaSessaoDoAcesso("u1")).toBe("org-a");
  });

  it("sem vínculo, ou com a leitura falhando, devolve null em vez de lançar", async () => {
    m.vinculos = [];
    expect(await orgDaSessaoDoAcesso("u1")).toBeNull();
    m.erro = { message: "fora" };
    expect(await orgDaSessaoDoAcesso("u1")).toBeNull();
  });
});
