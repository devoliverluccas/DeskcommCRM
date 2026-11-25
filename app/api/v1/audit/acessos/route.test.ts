/**
 * GET /api/v1/audit/acessos — o registro de acessos da empresa.
 *
 * O que fica preso aqui:
 *  - a porta é a da auditoria (manager+, plataforma em leitura);
 *  - a consulta filtra a organização da SESSÃO e só ações de acesso;
 *  - IP inteiro só para admin — gerente recebe mascarado JÁ no JSON;
 *  - metadados internos (hash de e-mail, texto de erro) não saem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { ACOES_DE_ACESSO } from "@/lib/audit/acessos";
import { requireRole } from "@/lib/auth/require-role";
import type { AuthUser } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const ANA = "11111111-1111-4111-8111-111111111111";

const registro = vi.hoisted(() => ({ chamadas: [] as Array<[string, unknown[]]> }));

function fakeSupabase(linhas: Array<Record<string, unknown>>) {
  const builder: Record<string, unknown> = {};
  for (const metodo of ["from", "select", "eq", "in", "order", "limit", "gte", "lte", "or"]) {
    builder[metodo] = (...args: unknown[]) => {
      registro.chamadas.push([metodo, args]);
      return builder;
    };
  }
  builder.then = (ok: (r: unknown) => unknown) => ok({ data: linhas, error: null });
  // O CLIENTE não é thenable (senão o `await createClient()` o desembrulharia);
  // só a consulta é.
  return { from: (...args: unknown[]) => (builder.from as (...a: unknown[]) => unknown)(...args) };
}

const LINHA = {
  id: "a1",
  created_at: "2026-11-25T10:00:00.000Z",
  actor_user_id: ANA,
  action: "auth.login_success",
  metadata: { provider: "google", email_hash: "segredo", reason: "texto cru" },
  actor_ip: "203.0.113.45",
  actor_user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0 Safari/537.36",
};

function comPapel(role: "manager" | "admin", platform = false) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "eu", idioma: "pt-BR", is_platform_admin: platform, support: null } as unknown as AuthUser,
    org: { orgId: ORG, name: "Org", role, org_status: "active", suspended_kind: null },
  });
}

async function chamar(qs = "") {
  const { GET } = await import("./route");
  const res = await GET(new NextRequest(`http://localhost/api/v1/audit/acessos${qs}`));
  return { res, body: (await res.json()) as { data: Array<Record<string, unknown>> } };
}

beforeEach(() => {
  registro.chamadas = [];
  vi.mocked(createClient).mockResolvedValue(
    fakeSupabase([LINHA]) as unknown as Awaited<ReturnType<typeof createClient>>,
  );
});

describe("GET /api/v1/audit/acessos", () => {
  it("usa a porta da auditoria: manager+, com leitura da plataforma", async () => {
    comPapel("manager");
    await chamar();
    expect(requireRole).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ resource: "audit", allowPlatformAdmin: "leitura" }),
    );
  });

  it("recusa de papel passa adiante", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: { code: "forbidden", message: "x" } }, { status: 403 }),
    });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost/api/v1/audit/acessos"));
    expect(res.status).toBe(403);
  });

  it("filtra a organização da sessão, só ações de acesso, pessoa e período", async () => {
    comPapel("admin");
    await chamar(`?actor_id=${ANA}&from=2026-11-01T00:00:00.000Z&to=2026-11-30T23:59:59.000Z`);
    expect(registro.chamadas).toContainEqual(["eq", ["organization_id", ORG]]);
    expect(registro.chamadas).toContainEqual(["in", ["action", [...ACOES_DE_ACESSO]]]);
    expect(registro.chamadas).toContainEqual(["eq", ["actor_user_id", ANA]]);
    expect(registro.chamadas).toContainEqual(["gte", ["created_at", "2026-11-01T00:00:00.000Z"]]);
    expect(registro.chamadas).toContainEqual(["lte", ["created_at", "2026-11-30T23:59:59.000Z"]]);
  });

  it("admin recebe o IP inteiro", async () => {
    comPapel("admin");
    const { body } = await chamar();
    expect(body.data[0]).toMatchObject({ ip: "203.0.113.45", ip_mascarado: false });
  });

  it("gerente recebe o IP mascarado já no JSON — o endereço inteiro não chega ao navegador", async () => {
    comPapel("manager");
    const { res, body } = await chamar();
    expect(body.data[0]).toMatchObject({ ip: "203.0.113.x", ip_mascarado: true });
    expect(JSON.stringify(body)).not.toContain("203.0.113.45");
    expect(res.status).toBe(200);
  });

  it("só os metadados de COMO entrou saem; hash de e-mail e texto de erro ficam", async () => {
    comPapel("admin");
    const { body } = await chamar();
    expect(body.data[0]!.metadata).toEqual({ provider: "google" });
  });

  it("filtro inválido é 422", async () => {
    comPapel("admin");
    const { res } = await chamar("?actor_id=nao-e-uuid");
    expect(res.status).toBe(422);
  });
});
