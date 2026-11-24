import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

import { GET } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

/** A lista da tela de Links de saída (fase 4, 4.4): `manager`, organização da sessão. */
const ORG = "11111111-1111-4111-8111-111111111111";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/links-de-saida", () => {
  it("manager lê o resumo da função do banco com a organização da SESSÃO", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u", idioma: "pt-BR" },
      org: { orgId: ORG, role: "manager" },
    } as Awaited<ReturnType<typeof requireRole>>);
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "l1", codigo: "AAAAAAAAAA", destino_url: "https://a.exemplo/", cliques: "3" }],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const res = await GET();
    const corpo = (await res.json()) as { data: { links: Array<{ cliques: number }> } };
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_links_de_saida_resumo", { p_org: ORG, p_limite: 500 });
    // `bigint` do PostgREST vira número.
    expect(corpo.data.links[0]!.cliques).toBe(3);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("manager");
  });

  it("abaixo de manager: 403 sem tocar no banco", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: fail("forbidden_role", "papel", 403),
    } as Awaited<ReturnType<typeof requireRole>>);
    expect((await GET()).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("erro do banco: 500 com texto para gente", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u", idioma: "pt-BR" },
      org: { orgId: ORG, role: "manager" },
    } as Awaited<ReturnType<typeof requireRole>>);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "x" } }),
    } as never);
    expect((await GET()).status).toBe(500);
  });
});
