/**
 * `audit()` grava a organização da sessão nas linhas de ACESSO (item 5.2).
 *
 * Antes, login/saída/MFA/senha entravam com `organization_id` nulo e
 * `/app/audit` não os mostrava. O que este arquivo prende:
 *  - ação de acesso com a pessoa identificada → ganha a empresa da sessão;
 *  - falha sem pessoa identificada (senha errada) → continua sem empresa;
 *  - `organizationId` explícito do emissor (inclusive `null`) é respeitado;
 *  - ação que não é acesso não dispara a resolução.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  insert: vi.fn(async (_linha: Record<string, unknown>) => ({ error: null })),
  resolver: vi.fn(async (_userId: string) => "org-da-sessao" as string | null),
}));

vi.mock("@/lib/env", () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: "test-key" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => {
    throw new Error("sem requisição");
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: m.insert }) }),
}));
vi.mock("./org-do-acesso", () => ({ orgDaSessaoDoAcesso: m.resolver }));

import { audit } from "./index";

function gravada(): Record<string, unknown> {
  return m.insert.mock.calls.at(-1)![0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("audit() e o registro de acessos", () => {
  it("login com a pessoa identificada vai para a empresa da sessão, com IP e navegador", async () => {
    await audit({ action: "auth.login_success", actorUserId: "u1", ip: "203.0.113.7", userAgent: "UA" });
    expect(m.resolver).toHaveBeenCalledWith("u1");
    expect(gravada()).toMatchObject({
      organization_id: "org-da-sessao",
      actor_ip: "203.0.113.7",
      actor_user_agent: "UA",
    });
  });

  it("saída e troca de senha também", async () => {
    await audit({ action: "auth.logout", actorUserId: "u1" });
    expect(gravada().organization_id).toBe("org-da-sessao");
    await audit({ action: "auth.password_change_completed", actorUserId: "u1" });
    expect(gravada().organization_id).toBe("org-da-sessao");
  });

  it("senha errada sem pessoa identificada continua sem empresa — não procura conta pelo e-mail", async () => {
    await audit({ action: "auth.login_failed", metadata: { email_hash: "h" } });
    expect(m.resolver).not.toHaveBeenCalled();
    expect(gravada().organization_id).toBeNull();
  });

  it("empresa explícita do emissor é respeitada, inclusive null", async () => {
    await audit({ action: "auth.mfa_enrolled", actorUserId: "u1", organizationId: "org-x" });
    expect(gravada().organization_id).toBe("org-x");
    await audit({ action: "auth.logout", actorUserId: "u1", organizationId: null });
    expect(gravada().organization_id).toBeNull();
    expect(m.resolver).not.toHaveBeenCalled();
  });

  it("ação que não é acesso não consulta vínculo", async () => {
    await audit({ action: "auth.signup_confirmed", actorUserId: "u1" });
    expect(m.resolver).not.toHaveBeenCalled();
    expect(gravada().organization_id).toBeNull();
  });

  it("resolução sem empresa grava null, como antes", async () => {
    m.resolver.mockResolvedValueOnce(null);
    await audit({ action: "auth.login_success", actorUserId: "u-sem-empresa" });
    expect(gravada().organization_id).toBeNull();
  });
});
