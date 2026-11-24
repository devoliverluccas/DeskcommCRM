import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "55555555-5555-4555-8555-555555555555";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const OUTRO = "33333333-3333-4333-8333-333333333333";

let linha: Record<string, unknown> | null = null;
let patch: Record<string, unknown> | null = null;
const filtros: Record<string, unknown> = {};

const req = (corpo: unknown) =>
  new NextRequest(`http://localhost/api/v1/contacts/${CONTATO}/bloquear`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
const contexto = (id = CONTATO) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  patch = null;
  for (const k of Object.keys(filtros)) delete filtros[k];
  linha = { id: CONTATO, is_blocked: false, blocked_reason: null, blocked_at: null };
  vi.mocked(loadAuthUser).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: EU, idioma: "pt-BR" },
    org: { orgId: ORG, role: "manager" },
  } as Awaited<ReturnType<typeof requireRole>>);
  const q = {
    select: () => q,
    update: (v: Record<string, unknown>) => {
      patch = v;
      return q;
    },
    eq: (k: string, v: unknown) => {
      filtros[k] = v;
      return q;
    },
    maybeSingle: async () => {
      const casa = filtros.id === CONTATO && filtros.organization_id === ORG;
      if (!casa) return { data: null, error: null };
      return { data: patch ? { ...linha, ...patch } : linha, error: null };
    },
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: () => q } as unknown as ReturnType<typeof createAdminClient>);
});

describe("POST /contacts/[id]/bloquear (item 3.7)", () => {
  it("grava os TRÊS campos que o desbloqueio limpa, com o motivo, e audita contact.blocked sem o texto", async () => {
    const r = await POST(req({ motivo: "  spam repetido  " }), contexto());
    expect(r.status).toBe(200);
    expect(patch).toMatchObject({ is_blocked: true, blocked_reason: "spam repetido" });
    expect(typeof patch?.blocked_at).toBe("string");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contact.blocked",
        actorUserId: EU,
        organizationId: ORG,
        resourceId: CONTATO,
        metadata: { reason: "manual", contact_id: CONTATO, origem: "tela_da_conversa" },
      }),
    );
  });

  it("exige gestor", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "Acesso negado.", 403) });
    const r = await POST(req({ motivo: "x" }), contexto());
    expect(r.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("manager", expect.objectContaining({ resource: "contacts" }));
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sem motivo é 422 e não toca o banco", async () => {
    const r = await POST(req({ motivo: "   " }), contexto());
    expect(r.status).toBe(422);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("contato de outra organização é 404", async () => {
    const r = await POST(req({ motivo: "abuso" }), contexto(OUTRO));
    expect(r.status).toBe(404);
    expect(filtros.organization_id).toBe(ORG);
    expect(patch).toBeNull();
  });

  it("já bloqueado: devolve a linha sem regravar nem auditar de novo", async () => {
    linha = { id: CONTATO, is_blocked: true, blocked_reason: "stop_keyword", blocked_at: "2026-11-01T00:00:00Z" };
    const r = await POST(req({ motivo: "abuso" }), contexto());
    expect(r.status).toBe(200);
    expect(patch).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });
});
