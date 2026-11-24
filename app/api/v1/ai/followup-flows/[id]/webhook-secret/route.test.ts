/**
 * GET do segredo do webhook do fluxo (4.3): manager+, organização da sessão, e
 * fluxo de outra organização é 404 — nunca um segredo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const deps = vi.hoisted(() => ({ role: vi.fn(), client: vi.fn(), eqs: [] as Array<[string, unknown]> }));

vi.mock("@/lib/auth/require-role", () => ({ requireRole: deps.role }));
vi.mock("@/lib/supabase/server", () => ({ createClient: deps.client }));

import { segredoDoWebhookDoFluxo } from "@/lib/followup/webhook-do-fluxo";
import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const raizOriginal = process.env.INTERNAL_SECRET;

function clientCom(linha: { id: string } | null) {
  const busca = {
    select: () => busca,
    eq: (col: string, v: unknown) => {
      deps.eqs.push([col, v]);
      return busca;
    },
    maybeSingle: async () => ({ data: linha, error: null }),
  };
  return { from: () => busca };
}

function chamar(id = ID) {
  return GET(new NextRequest(`http://localhost/api/v1/ai/followup-flows/${id}/webhook-secret`), {
    params: Promise.resolve({ id }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  deps.eqs.length = 0;
  process.env.INTERNAL_SECRET = "raiz-de-teste";
  deps.role.mockResolvedValue({ ok: true, user: { id: "eu", idioma: "pt-BR" }, org: { orgId: "org", role: "manager" } });
});
afterEach(() => {
  process.env.INTERNAL_SECRET = raizOriginal;
});

describe("GET /api/v1/ai/followup-flows/[id]/webhook-secret", () => {
  it("devolve o segredo derivado da organização da SESSÃO e do fluxo", async () => {
    deps.client.mockResolvedValue(clientCom({ id: ID }));
    const res = await chamar();
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data: { segredo: string } };
    expect(corpo.data.segredo).toBe(segredoDoWebhookDoFluxo("org", ID, "raiz-de-teste"));
    expect(deps.eqs).toContainEqual(["organization_id", "org"]);
    expect(deps.role).toHaveBeenCalledWith("manager", expect.anything());
  });

  it("fluxo que a organização não tem: 404", async () => {
    deps.client.mockResolvedValue(clientCom(null));
    expect((await chamar()).status).toBe(404);
  });

  it("papel insuficiente: a resposta do requireRole", async () => {
    deps.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await chamar()).status).toBe(403);
  });
});
