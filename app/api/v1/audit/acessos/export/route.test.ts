/**
 * GET /api/v1/audit/acessos/export — a planilha .xlsx do registro de acessos.
 * Lida de volta pelo leitor do próprio repositório, para provar que é XLSX de
 * verdade, com aparelho legível e IP mascarado para quem não administra.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { parseImportFile } from "@/lib/planilha/ler-arquivo";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: () => false,
}));

const ORG = "22222222-2222-4222-8222-222222222222";

function fakeSupabase(linhas: Array<Record<string, unknown>>) {
  const builder: Record<string, unknown> = {};
  let paginas = 0;
  for (const metodo of ["from", "select", "eq", "in", "order", "gte", "lte", "or"]) {
    builder[metodo] = () => builder;
  }
  builder.range = () => builder;
  builder.then = (ok: (r: unknown) => unknown) =>
    ok({ data: paginas++ === 0 ? linhas : [], count: linhas.length, error: null });
  // O CLIENTE não é thenable (senão o `await createClient()` o desembrulharia);
  // só a consulta é.
  return { from: (...args: unknown[]) => (builder.from as (...a: unknown[]) => unknown)(...args) };
}

function comPapel(role: "manager" | "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "eu", idioma: "pt-BR", is_platform_admin: false, support: null } as unknown as AuthUser,
    org: { orgId: ORG, name: "Org", role, org_status: "active", suspended_kind: null, timezone: "America/Sao_Paulo" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(
    fakeSupabase([
      {
        id: "a1",
        created_at: "2026-11-25T13:00:00.000Z",
        actor_user_id: "11111111-1111-4111-8111-111111111111",
        action: "auth.login_success",
        metadata: {},
        actor_ip: "203.0.113.45",
        actor_user_agent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      },
    ]) as unknown as Awaited<ReturnType<typeof createClient>>,
  );
});

async function baixar() {
  const { GET } = await import("./route");
  return GET(new NextRequest("http://localhost/api/v1/audit/acessos/export"));
}

describe("GET /api/v1/audit/acessos/export", () => {
  it("devolve um .xlsx legível, com aparelho resumido e IP mascarado para gerente", async () => {
    comPapel("manager");
    const res = await baixar();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("content-disposition")).toMatch(/acessos-.*\.xlsx/);

    const lida = await parseImportFile(await res.arrayBuffer(), "acessos.xlsx");
    expect(lida.ok).toBe(true);
    if (!lida.ok) return;
    expect(lida.sheet.headers).toEqual(["Quando", "Pessoa", "Evento", "Aparelho", "Endereço IP"]);
    const [linha] = lida.sheet.rows;
    expect(linha?.[2]).toBe("Entrou");
    expect(linha?.[3]).toBe("Safari no iPhone");
    expect(linha?.[4]).toBe("203.0.113.x");
  });

  it("admin recebe o IP inteiro", async () => {
    comPapel("admin");
    const lida = await parseImportFile(await (await baixar()).arrayBuffer(), "acessos.xlsx");
    expect(lida.ok && lida.sheet.rows[0]?.[4]).toBe("203.0.113.45");
  });

  it("o gesto de baixar fica auditado, sem a pessoa filtrada", async () => {
    comPapel("admin");
    await baixar();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "audit.access_log_exported",
        organizationId: ORG,
        metadata: expect.objectContaining({ total: 1, filtrou_pessoa: false }),
      }),
    );
  });
});
