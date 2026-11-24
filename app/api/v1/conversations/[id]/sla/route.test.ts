import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

import { POST } from "./route";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

/**
 * IGNORAR O SLA DE UMA CONVERSA (fase 3, item 3.3).
 *
 * ─── SABOTAGEM (linha para reverter: `route.ts`) ────────────────────────────
 * - Baixar o piso para `agent`: cai "pede manager".
 * - Tirar o `.eq("organization_id", ...)`: cai "grava no org da sessão".
 * - Auditar a mesma ação nos dois sentidos: cai "restaurar audita restored".
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "22222222-2222-4222-8222-222222222222";
const USUARIO = "33333333-3333-4333-8333-333333333333";

let gravado: Record<string, unknown> | null = null;
let filtros: Array<[string, unknown]> = [];
let linhaExiste = true;

function fakeAdmin() {
  const q = {
    update: (v: Record<string, unknown>) => {
      gravado = v;
      return q;
    },
    eq: (col: string, v: unknown) => {
      filtros.push([col, v]);
      return q;
    },
    select: () => q,
    maybeSingle: async () => ({
      data: linhaExiste ? { id: CONVERSA, ...gravado } : null,
      error: null,
    }),
  };
  return { from: () => q };
}

const enviar = (corpo: unknown, id = CONVERSA) =>
  POST(
    new NextRequest(`http://localhost/api/v1/conversations/${id}/sla`, {
      method: "POST",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  gravado = null;
  filtros = [];
  linhaExiste = true;
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USUARIO, idioma: "pt-BR" },
    org: { orgId: ORG, role: "manager" },
  } as Awaited<ReturnType<typeof requireRole>>);
  vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(audit).mockResolvedValue(undefined);
});

describe("POST /api/v1/conversations/[id]/sla", () => {
  it("pede manager", async () => {
    await enviar({ ignorar: true });
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("manager");
  });

  it("suporte em leitura não grava", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(new Response(null, { status: 403 }));
    const r = await enviar({ ignorar: true });
    expect(r.status).toBe(403);
    expect(gravado).toBeNull();
  });

  it("ignorar grava quem e quando, no org da sessão, e audita sla_ignored", async () => {
    const r = await enviar({ ignorar: true });
    expect(r.status).toBe(200);
    expect(gravado).toMatchObject({ sla_ignorado_por: USUARIO });
    expect(typeof gravado?.sla_ignorado_em).toBe("string");
    expect(filtros).toContainEqual(["organization_id", ORG]);
    expect(filtros).toContainEqual(["id", CONVERSA]);
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      action: "conversation.sla_ignored",
      resourceId: CONVERSA,
      organizationId: ORG,
    });
  });

  it("restaurar zera as duas colunas e audita sla_restored", async () => {
    const r = await enviar({ ignorar: false });
    expect(r.status).toBe(200);
    expect(gravado).toEqual({ sla_ignorado_em: null, sla_ignorado_por: null });
    expect(vi.mocked(audit).mock.calls[0]?.[0]?.action).toBe("conversation.sla_restored");
  });

  it("corpo inválido é 422 e não grava", async () => {
    const r = await enviar({ ignorar: "sim" });
    expect(r.status).toBe(422);
    expect(gravado).toBeNull();
  });

  it("conversa de outra organização (ou inexistente) é 404 e não audita", async () => {
    linhaExiste = false;
    const r = await enviar({ ignorar: true });
    expect(r.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });
});
