import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { resumoDoSlaDePrimeiraResposta } from "@/lib/inbox/sla-relatorio";
import { createAdminClient } from "@/lib/supabase/admin";

import { GET } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/inbox/sla-relatorio", () => ({ resumoDoSlaDePrimeiraResposta: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

/**
 * Aba SLA dos relatórios: organização da SESSÃO, período no fuso dela, gestor
 * para cima, e sem meta configurada a rota nem calcula.
 */
const ORG = "11111111-1111-4111-8111-111111111111";

function sessao(role: "agent" | "manager") {
  vi.mocked(requireRole).mockImplementation(async () =>
    role === "agent"
      ? ({ ok: false, response: new Response("{}", { status: 403 }) } as never)
      : ({ ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: ORG, role } } as never),
  );
}

function admin(settings: unknown) {
  const consulta: Record<string, unknown> = {};
  Object.assign(consulta, {
    select: () => consulta,
    eq: (col: string) =>
      col === "organization_id" ? Promise.resolve({ data: [{ id: "s-1", name: "Comercial" }], error: null }) : consulta,
    maybeSingle: async () => ({ data: { settings, timezone: "America/Sao_Paulo" }, error: null }),
  });
  return { from: () => consulta };
}

const pedir = () => GET(new NextRequest("http://localhost/api/v1/relatorios/sla?de=2026-11-01&ate=2026-11-01"));

beforeEach(() => vi.clearAllMocks());

describe("relatório de SLA", () => {
  it("atendente não vê (403) e nada é lido", async () => {
    sessao("agent");
    const r = await pedir();
    expect(r.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sem meta configurada: com_meta=false e a conta não roda", async () => {
    sessao("manager");
    vi.mocked(createAdminClient).mockReturnValue(admin({}) as never);
    const corpo = (await (await pedir()).json()) as { data: { com_meta: boolean } };
    expect(corpo.data.com_meta).toBe(false);
    expect(resumoDoSlaDePrimeiraResposta).not.toHaveBeenCalled();
  });

  it("com meta: conta na organização da sessão, janela no fuso, e devolve o nome do setor", async () => {
    sessao("manager");
    vi.mocked(createAdminClient).mockReturnValue(admin({ sla: { primeira_resposta_min: 15 } }) as never);
    vi.mocked(resumoDoSlaDePrimeiraResposta).mockResolvedValue({
      medidos: 2, dentro: 1, fora: 1, pendentes: 0, percentual_dentro: 50,
      por_setor: [{ sector_id: "s-1", medidos: 2, dentro: 1, fora: 1, pendentes: 0, percentual_dentro: 50 }],
    });
    const corpo = (await (await pedir()).json()) as {
      data: { com_meta: boolean; resumo: { percentual_dentro: number }; setores: Record<string, string> };
    };
    expect(corpo.data.com_meta).toBe(true);
    expect(corpo.data.resumo.percentual_dentro).toBe(50);
    expect(corpo.data.setores["s-1"]).toBe("Comercial");
    const [, opcoes] = vi.mocked(resumoDoSlaDePrimeiraResposta).mock.calls[0]!;
    expect(opcoes.organizationId).toBe(ORG);
    expect(opcoes.de.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});
