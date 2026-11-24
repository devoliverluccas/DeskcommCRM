import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "22222222-2222-4222-8222-222222222222";
const CONV = "44444444-4444-4444-8444-444444444444";

let linhaVisivel: Record<string, unknown> | null = null;
let patch: Record<string, unknown> | null = null;
const filtrosDoAdmin: Record<string, unknown> = {};

const req = (corpo: unknown) =>
  new NextRequest(`http://localhost/api/v1/conversations/${CONV}/pendente`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
const contexto = { params: Promise.resolve({ id: CONV }) };

beforeEach(() => {
  vi.clearAllMocks();
  patch = null;
  for (const k of Object.keys(filtrosDoAdmin)) delete filtrosDoAdmin[k];
  linhaVisivel = { id: CONV, status: "open", pendente_em: null };
  vi.mocked(loadAuthUser).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: EU, idioma: "pt-BR" },
    org: { orgId: ORG, role: "agent" },
  } as Awaited<ReturnType<typeof requireRole>>);

  const sessao = {
    select: () => sessao,
    eq: () => sessao,
    maybeSingle: async () => ({ data: linhaVisivel, error: null }),
  };
  vi.mocked(createClient).mockResolvedValue({ from: () => sessao } as unknown as Awaited<ReturnType<typeof createClient>>);
  const admin = {
    update: (v: Record<string, unknown>) => {
      patch = v;
      return admin;
    },
    eq: (k: string, v: unknown) => {
      filtrosDoAdmin[k] = v;
      return admin;
    },
    select: () => admin,
    maybeSingle: async () => ({ data: { id: CONV, pendente_em: patch?.pendente_em ?? null }, error: null }),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => admin } as unknown as ReturnType<typeof createAdminClient>);
});

describe("POST /conversations/[id]/pendente (item 3.7)", () => {
  it("marca com o instante, no recorte da organização, e audita", async () => {
    const r = await POST(req({ pendente: true }), contexto);
    expect(r.status).toBe(200);
    expect(typeof patch?.pendente_em).toBe("string");
    expect(filtrosDoAdmin.organization_id).toBe(ORG);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conversation.pendente_alterada", metadata: { pendente: true } }),
    );
  });

  it("tira a marca gravando nulo — inclusive em conversa encerrada", async () => {
    linhaVisivel = { id: CONV, status: "closed", pendente_em: "2026-11-24T10:00:00Z" };
    const r = await POST(req({ pendente: false }), contexto);
    expect(r.status).toBe(200);
    expect(patch).toEqual({ pendente_em: null });
  });

  it("marcar conversa encerrada é 409 e não grava", async () => {
    linhaVisivel = { id: CONV, status: "archived", pendente_em: null };
    const r = await POST(req({ pendente: true }), contexto);
    expect(r.status).toBe(409);
    expect(patch).toBeNull();
  });

  it("conversa fora do escopo da sessão é 404; gesto sem efeito não audita", async () => {
    linhaVisivel = null;
    expect((await POST(req({ pendente: true }), contexto)).status).toBe(404);
    linhaVisivel = { id: CONV, status: "open", pendente_em: "2026-11-24T10:00:00Z" };
    expect((await POST(req({ pendente: true }), contexto)).status).toBe(200);
    expect(patch).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });
});
