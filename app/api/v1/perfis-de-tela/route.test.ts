import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  support: vi.fn(),
  role: vi.fn(),
  audit: vi.fn(),
  adminFrom: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.adminFrom }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: vi.fn() }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { POST } from "./route";

const org = "f2210000-0000-4000-8000-000000000002";
const pedido = (corpo: unknown) =>
  new NextRequest("http://local/api/v1/perfis-de-tela", { method: "POST", body: JSON.stringify(corpo) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.support.mockResolvedValue(null);
  mocks.role.mockResolvedValue({ ok: true, user: { id: "eu", idioma: "pt-BR" }, org: { orgId: org } });
});

it("só admin cria", async () => {
  mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await POST(pedido({ nome: "Vendas", destinos: ["/app/inbox"] }))).status).toBe(403);
  expect(mocks.role).toHaveBeenCalledWith("admin", expect.anything());
});

it("área fora do catálogo não chega ao banco", async () => {
  expect((await POST(pedido({ nome: "Vendas", destinos: ["/app/inventada"] }))).status).toBe(422);
  expect(mocks.adminFrom).not.toHaveBeenCalled();
});

it("cria com a organização da SESSÃO e audita", async () => {
  const inserido = { id: "p1", nome: "Vendas", destinos: ["/app/inbox"], created_at: "", updated_at: "" };
  const insert = vi.fn().mockReturnValue({
    select: () => ({ single: async () => ({ data: inserido, error: null }) }),
  });
  mocks.adminFrom.mockReturnValue({
    select: () => ({ eq: async () => ({ count: 0, error: null }) }),
    insert,
  });
  const r = await POST(pedido({ nome: "Vendas", destinos: ["/app/inbox"] }));
  expect(r.status).toBe(201);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: org, destinos: ["/app/inbox"] }));
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "perfil_de_tela.criado", organizationId: org }));
});

it("nome repetido vira 409", async () => {
  mocks.adminFrom.mockReturnValue({
    select: () => ({ eq: async () => ({ count: 1, error: null }) }),
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "dup" } }) }) }),
  });
  expect((await POST(pedido({ nome: "Vendas", destinos: ["/app/inbox"] }))).status).toBe(409);
});
