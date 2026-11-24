import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

import { GET } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

/**
 * O EXTRATO DE PONTOS de um contato (fase 4, 4.5): total pela função (soma, não
 * coluna) e as linhas mais recentes, pela SESSÃO e com a organização do contexto.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "33333333-3333-4333-8333-333333333333";

function cadeia(resultado: unknown) {
  const filtros: Array<[string, unknown]> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok);
        return (...args: unknown[]) => {
          if (prop === "eq") filtros.push([args[0] as string, args[1]]);
          return q;
        };
      },
    },
  );
  return { q, filtros };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u", idioma: "pt-BR" },
    org: { orgId: ORG, role: "viewer" },
  } as Awaited<ReturnType<typeof requireRole>>);
});

describe("GET /api/v1/pontuacao/extrato", () => {
  it("contact_id que não é uuid: 422", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/pontuacao/extrato?contact_id=x"));
    expect(res.status).toBe(422);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("total da função e linhas filtradas pela organização do contexto", async () => {
    const linhas = cadeia({
      data: [{ id: "e1", contact_id: CONTATO, pontos: 10, evento: "respondeu_followup", motivo: "Respondeu" }],
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({ data: 25, error: null });
    vi.mocked(createClient).mockResolvedValue({ from: () => linhas.q, rpc } as never);

    const res = await GET(new NextRequest(`http://localhost/api/v1/pontuacao/extrato?contact_id=${CONTATO}`));
    const corpo = (await res.json()) as { data: { total: number; itens: unknown[] } };

    expect(res.status).toBe(200);
    expect(corpo.data.total).toBe(25);
    expect(corpo.data.itens).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("fn_pontuacao_do_contato", { p_org: ORG, p_contato: CONTATO });
    expect(linhas.filtros).toEqual(
      expect.arrayContaining([
        ["organization_id", ORG],
        ["contact_id", CONTATO],
      ]),
    );
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("viewer");
  });
});
