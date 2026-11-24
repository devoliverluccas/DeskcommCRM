import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { resumirEnvio } from "@/lib/campanhas/resumo-do-envio";
import type * as ResumoDoEnvioModulo from "@/lib/campanhas/resumo-do-envio";
import { createAdminClient } from "@/lib/supabase/admin";

import { POST } from "./route";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/campanhas/resumo-do-envio", async (importOriginal) => ({
  ...(await importOriginal<typeof ResumoDoEnvioModulo>()),
  resumirEnvio: vi.fn(),
}));

/**
 * POST /api/v1/campaigns/resumo (fase 4, 4.7): `manager`, Zod na porta, e a
 * organização do CONTEXTO passada ao resumo — nunca a do corpo.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const NUMERO = "55555555-5555-4555-8555-555555555555";

function req(corpo: unknown) {
  return new NextRequest("http://localhost/api/v1/campaigns/resumo", {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
}

function papel(atual: "agent" | "manager") {
  vi.mocked(requireRole).mockImplementation(async (min) => {
    const ordem = { viewer: 1, agent: 2, manager: 3, admin: 4 } as const;
    if (ordem[atual] < ordem[min as keyof typeof ordem]) {
      return { ok: false, response: fail("forbidden_role", "papel", 403) } as Awaited<ReturnType<typeof requireRole>>;
    }
    return { ok: true, user: { id: "u", idioma: "pt-BR" }, org: { orgId: ORG, role: atual } } as Awaited<
      ReturnType<typeof requireRole>
    >;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("POST /api/v1/campaigns/resumo", () => {
  it("agent recebe 403", async () => {
    papel("agent");
    const res = await POST(req({ audience_filter: { com_alguma_tag: ["vip"] } }));
    expect(res.status).toBe(403);
    expect(resumirEnvio).not.toHaveBeenCalled();
  });

  it("filtro sem critério: 422", async () => {
    papel("manager");
    const res = await POST(req({ audience_filter: {} }));
    expect(res.status).toBe(422);
  });

  it("manager recebe o resumo da organização do contexto", async () => {
    papel("manager");
    vi.mocked(resumirEnvio).mockResolvedValue({ custo: null } as never);
    const res = await POST(
      req({ audience_filter: { com_alguma_tag: ["vip"] }, channel_session_id: NUMERO, organization_id: "outra" }),
    );
    expect(res.status).toBe(200);
    expect(createAdminClient).toHaveBeenCalled();
    expect(vi.mocked(resumirEnvio).mock.calls[0]![1]).toMatchObject({
      organizationId: ORG,
      pedido: expect.objectContaining({ channel_session_id: NUMERO, velocidade: "gradual" }),
    });
  });
});
