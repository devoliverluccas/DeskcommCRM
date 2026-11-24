import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSupportWrite: vi.fn(),
  createAdminClient: vi.fn(),
  criarLinkDaProposta: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/propostas/porta", () => ({ sePropostasDesligadas: vi.fn(async () => null) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: mocks.requireSupportWrite }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/propostas/link-publico", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  criarLinkDaProposta: mocks.criarLinkDaProposta,
}));

import { POST } from "./route";

const ORG = "22222222-2222-4222-8222-222222222222";
const ID = "44444444-4444-4444-8444-444444444444";

function mundo(proposta: Record<string, unknown> | null) {
  const filtros: Record<string, unknown> = {};
  mocks.createAdminClient.mockReturnValue({
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq(c: string, v: unknown) {
          filtros[c] = v;
          return q;
        },
        maybeSingle: async () => ({
          data: proposta && filtros.organization_id === ORG && filtros.id === ID ? proposta : null,
          error: null,
        }),
      };
      return q;
    },
  });
  return () => POST(new NextRequest(`http://localhost/api/v1/proposals/${ID}/link`, { method: "POST" }), { params: Promise.resolve({ id: ID }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSupportWrite.mockResolvedValue(null);
  mocks.requireRole.mockResolvedValue({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: ORG } });
  mocks.criarLinkDaProposta.mockResolvedValue({ id: "link-9", token: "TOKEN-NOVO", expiraEm: "2026-12-11T14:00:00.000Z" });
});

describe("POST /api/v1/proposals/[id]/link — copiar o link da proposta enviada", () => {
  it("proposta enviada: gera um link novo e devolve a URL; audita SEM o token", async () => {
    const res = await mundo({ id: ID, status: "enviada", valid_until: "2026-12-10" })();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.url).toMatch(/\/o\/TOKEN-NOVO$/);
    expect(mocks.criarLinkDaProposta).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, propostaId: ID, validUntil: "2026-12-10", criadoPor: "u1" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "proposal.link_gerado", resourceId: ID }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("TOKEN-NOVO");
  });

  it("rascunho ou decidida: 409, nenhum link", async () => {
    for (const status of ["rascunho", "aceita", "substituida"]) {
      const res = await mundo({ id: ID, status, valid_until: null })();
      expect(res.status).toBe(409);
    }
    expect(mocks.criarLinkDaProposta).not.toHaveBeenCalled();
  });

  it("proposta de outra organização: 404", async () => {
    mocks.requireRole.mockResolvedValue({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: "outra-org" } });
    const res = await mundo({ id: ID, status: "enviada", valid_until: null })();
    expect(res.status).toBe(404);
  });

  it("suporte só-leitura: recusa antes do efeito", async () => {
    mocks.requireSupportWrite.mockResolvedValue(new Response(null, { status: 403 }));
    const res = await mundo({ id: ID, status: "enviada", valid_until: null })();
    expect(res.status).toBe(403);
    expect(mocks.criarLinkDaProposta).not.toHaveBeenCalled();
  });

  it("papel abaixo de agent: 403", async () => {
    mocks.requireRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await mundo({ id: ID, status: "enviada", valid_until: null })();
    expect(res.status).toBe(403);
  });
});
