import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  support: vi.fn(),
  role: vi.fn(),
  audit: vi.fn(),
  from: vi.fn(),
  invalidar: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.support }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/auth/cache-curto", () => ({ invalidarUsuario: mocks.invalidar }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));

import { PATCH } from "./route";

const membro = "f2210000-0000-4000-8000-000000000001";
const org = "f2210000-0000-4000-8000-000000000002";
const perfil = "f2210000-0000-4000-8000-000000000003";
const ctx = { params: Promise.resolve({ user_id: membro }) };
const pedido = (corpo: unknown) =>
  new NextRequest("http://local/api/v1/team/x/perfil-de-tela", { method: "PATCH", body: JSON.stringify(corpo) });

function cadeia(respostas: Array<{ data: unknown; error: unknown }>) {
  const c = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  for (const r of respostas) c.maybeSingle.mockResolvedValueOnce(r);
  mocks.from.mockReturnValue(c);
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.support.mockResolvedValue(null);
  mocks.role.mockResolvedValue({ ok: true, user: { id: "eu", idioma: "pt-BR" }, org: { orgId: org } });
});

it("suporte em leitura nega antes de tocar no banco", async () => {
  mocks.support.mockResolvedValue(new Response(null, { status: 403 }));
  expect((await PATCH(pedido({ perfil_de_tela_id: perfil }), ctx)).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});

it("só admin atribui", async () => {
  mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await PATCH(pedido({ perfil_de_tela_id: perfil }), ctx)).status).toBe(403);
  expect(mocks.role).toHaveBeenCalledWith("admin", expect.anything());
});

it("organização no corpo é recusada (o schema é estrito)", async () => {
  expect((await PATCH(pedido({ perfil_de_tela_id: perfil, organization_id: org }), ctx)).status).toBe(400);
  expect(mocks.from).not.toHaveBeenCalled();
});

it("admin não recebe perfil — e o banco não é escrito", async () => {
  const c = cadeia([{ data: { id: "v1", role: "admin" }, error: null }]);
  expect((await PATCH(pedido({ perfil_de_tela_id: perfil }), ctx)).status).toBe(422);
  expect(c.update).not.toHaveBeenCalled();
});

it("perfil de outra organização: a FK composta recusa e vira 422", async () => {
  cadeia([
    { data: { id: "v1", role: "agent" }, error: null },
    { data: null, error: { code: "23503", message: "fk" } },
  ]);
  expect((await PATCH(pedido({ perfil_de_tela_id: perfil }), ctx)).status).toBe(422);
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("atribui filtrando a organização da sessão, derruba o cache e audita", async () => {
  const c = cadeia([
    { data: { id: "v1", role: "agent" }, error: null },
    { data: { id: "v1", user_id: membro, perfil_de_tela_id: perfil }, error: null },
  ]);
  expect((await PATCH(pedido({ perfil_de_tela_id: perfil }), ctx)).status).toBe(200);
  expect(c.update).toHaveBeenCalledWith({ perfil_de_tela_id: perfil });
  expect(c.eq).toHaveBeenCalledWith("organization_id", org);
  expect(mocks.invalidar).toHaveBeenCalledWith(membro);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "team.perfil_de_tela_changed", organizationId: org }),
  );
});

it("tirar o perfil (null) vale até para quem administra", async () => {
  cadeia([
    { data: { id: "v1", role: "admin" }, error: null },
    { data: { id: "v1", user_id: membro, perfil_de_tela_id: null }, error: null },
  ]);
  expect((await PATCH(pedido({ perfil_de_tela_id: null }), ctx)).status).toBe(200);
});
