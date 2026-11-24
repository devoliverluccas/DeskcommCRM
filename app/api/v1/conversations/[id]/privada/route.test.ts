import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
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
const OUTRO = "33333333-3333-4333-8333-333333333333";
const CONV = "44444444-4444-4444-8444-444444444444";

let linhaVisivel: Record<string, unknown> | null = null;
let patch: Record<string, unknown> | null = null;
const filtrosDoAdmin: Record<string, unknown> = {};

const req = (corpo: unknown) =>
  new NextRequest(`http://localhost/api/v1/conversations/${CONV}/privada`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
const contexto = { params: Promise.resolve({ id: CONV }) };

function papel(role: string) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: EU, idioma: "pt-BR" },
    org: { orgId: ORG, role },
  } as Awaited<ReturnType<typeof requireRole>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  patch = null;
  for (const k of Object.keys(filtrosDoAdmin)) delete filtrosDoAdmin[k];
  linhaVisivel = { id: CONV, assigned_to_user_id: EU, privada: false };
  vi.mocked(loadAuthUser).mockResolvedValue(null);
  papel("agent");

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
    maybeSingle: async () => ({ data: { id: CONV, privada: patch?.privada }, error: null }),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => admin } as unknown as ReturnType<typeof createAdminClient>);
});

describe("POST /conversations/[id]/privada (item 3.7)", () => {
  it("o responsável torna a própria conversa privada, com quem marcou, e audita", async () => {
    const r = await POST(req({ privada: true }), contexto);
    expect(r.status).toBe(200);
    expect(patch).toEqual({ privada: true, privada_por: EU });
    expect(filtrosDoAdmin.organization_id).toBe(ORG);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conversation.privada_alterada", resourceId: CONV, metadata: { privada: true } }),
    );
  });

  it("atendente que NÃO é o responsável recebe 403 e nada é gravado", async () => {
    linhaVisivel = { id: CONV, assigned_to_user_id: OUTRO, privada: false };
    const r = await POST(req({ privada: true }), contexto);
    expect(r.status).toBe(403);
    expect(patch).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it("gestor muda a de outra pessoa; tornar pública limpa quem marcou", async () => {
    papel("manager");
    linhaVisivel = { id: CONV, assigned_to_user_id: OUTRO, privada: true };
    const r = await POST(req({ privada: false }), contexto);
    expect(r.status).toBe(200);
    expect(patch).toEqual({ privada: false, privada_por: null });
  });

  it("conversa que a sessão não vê é 404 (não confirma que existe)", async () => {
    linhaVisivel = null;
    const r = await POST(req({ privada: true }), contexto);
    expect(r.status).toBe(404);
    expect(patch).toBeNull();
  });

  it("gesto sem efeito não grava nem audita", async () => {
    linhaVisivel = { id: CONV, assigned_to_user_id: EU, privada: true };
    const r = await POST(req({ privada: true }), contexto);
    expect(r.status).toBe(200);
    expect(patch).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it("corpo inválido é 422; viewer é barrado no requireRole('agent')", async () => {
    expect((await POST(req({ privada: "sim" }), contexto)).status).toBe(422);
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "Acesso negado.", 403) });
    expect((await POST(req({ privada: true }), contexto)).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("agent", expect.objectContaining({ resource: "conversations" }));
  });
});
