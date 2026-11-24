import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { GET, PATCH } from "./route";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const SETOR = "44444444-4444-4444-8444-444444444444";

let settingsAtuais: Record<string, unknown> = {};
let gravado: Record<string, unknown> | null = null;

function fakeClient() {
  const q = {
    select: () => q,
    eq: () => q,
    update: (v: Record<string, unknown>) => {
      gravado = v;
      return q;
    },
    maybeSingle: async () => ({ data: gravado ? { id: ORG } : { settings: settingsAtuais }, error: null }),
    then: (ok: (v: unknown) => unknown) =>
      ok({ data: [{ id: SETOR, schedule: { timezone: "UTC", windows: [] } }], error: null }),
  };
  return { from: () => q };
}

const patch = (corpo: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/v1/settings/sla", {
      method: "PATCH",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  settingsAtuais = { routing: { mode: "manual" } };
  gravado = null;
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" },
    org: { orgId: ORG, role: "manager" },
  } as Awaited<ReturnType<typeof requireRole>>);
  vi.mocked(createClient).mockResolvedValue(fakeClient() as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createAdminClient).mockReturnValue(fakeClient() as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(audit).mockResolvedValue(undefined);
});

describe("GET /api/v1/settings/sla", () => {
  it("quem atende lê metas (sem meta por padrão) e o horário dos setores", async () => {
    const r = await GET();
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("viewer");
    const corpo = (await r.json()) as { data: { metas: unknown; expedientes: Record<string, unknown> } };
    expect(corpo.data.metas).toEqual({ primeira_resposta_min: null, resolucao_horas: null, por_setor: {} });
    expect(Object.keys(corpo.data.expedientes)).toEqual([SETOR]);
  });
});

describe("PATCH /api/v1/settings/sla", () => {
  it("pede manager, grava o bloco e preserva as outras chaves", async () => {
    const r = await patch({
      primeira_resposta_min: 15,
      resolucao_horas: 24,
      por_setor: { [SETOR]: { primeira_resposta_min: 5, resolucao_horas: null } },
    });
    expect(r.status).toBe(200);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("manager");
    expect(gravado).toEqual({
      settings: {
        routing: { mode: "manual" },
        sla: {
          primeira_resposta_min: 15,
          resolucao_horas: 24,
          por_setor: { [SETOR]: { primeira_resposta_min: 5, resolucao_horas: null } },
        },
      },
    });
    expect(vi.mocked(audit).mock.calls[0]?.[0]?.action).toBe("settings.sla_alterado");
  });

  it("recusa meta zero, negativa ou chave desconhecida", async () => {
    for (const corpo of [
      { primeira_resposta_min: 0, resolucao_horas: null },
      { primeira_resposta_min: -5, resolucao_horas: null },
      { primeira_resposta_min: 10, resolucao_horas: null, outra: 1 },
      { primeira_resposta_min: 10, resolucao_horas: null, por_setor: { "nao-e-uuid": { primeira_resposta_min: 1, resolucao_horas: null } } },
    ]) {
      const r = await patch(corpo);
      expect(r.status).toBe(422);
    }
    expect(gravado).toBeNull();
  });
});
