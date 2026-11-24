import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { GET as atendimentos } from "./atendimentos/route";
import { GET as atribuicao } from "./atribuicao/route";
import { GET as satisfacao } from "./satisfacao/route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * 3.6 — as rotas de leitura de `/api/v1/relatorios/*`.
 *
 * O que fica preso: a organização é a da SESSÃO (nunca da URL); o período é
 * recortado no fuso da organização; período torto é 422; satisfação e
 * atribuição pedem `manager` (a recusa vem antes de qualquer leitura).
 *
 * SABOTAGEM: trocar o `p_org` pelo `org` da query faz o caso da sessão acusar;
 * recortar em UTC faz o `p_de` virar `T00:00Z` e o caso do fuso acusa.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA = "99999999-9999-4999-8999-999999999999";

function sessao(role: "agent" | "manager") {
  vi.mocked(requireRole).mockImplementation(async (piso) => {
    const ordem = { viewer: 1, agent: 2, manager: 3, admin: 4 } as const;
    if (ordem[role] < ordem[piso as keyof typeof ordem]) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), { status: 403 }),
      } as unknown as Awaited<ReturnType<typeof requireRole>>;
    }
    return {
      ok: true,
      user: { id: "u-1", idioma: "pt-BR" },
      org: { orgId: ORG, role },
    } as Awaited<ReturnType<typeof requireRole>>;
  });
}

/** Um client que responde a organização (fuso/settings) e grava as chamadas de rpc. */
function clienteFalso(
  rpcData: unknown,
  org: Record<string, unknown> = { timezone: "America/Sao_Paulo" },
  linhas: unknown[] = [],
) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
  const consulta: Record<string, unknown> = {};
  Object.assign(consulta, {
    select: () => consulta,
    eq: () => consulta,
    not: () => consulta,
    in: () => consulta,
    gte: () => consulta,
    lt: () => consulta,
    order: () => consulta,
    limit: async () => ({ data: linhas, error: null }),
    maybeSingle: async () => ({ data: org, error: null }),
  });
  return { client: { from: () => consulta, rpc }, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(nomesDosAtendentes).mockResolvedValue(new Map([["u-9", "Bia"]]));
});

describe("3.6 — atendimentos", () => {
  it("recorta no fuso da organização, com a organização da sessão", async () => {
    sessao("agent");
    const { client, rpc } = clienteFalso({
      abertos: 2,
      encerrados: 1,
      primeira_resposta: { media: 60, mediana: 30, amostra: 2 },
      resolucao: { media: null, mediana: null, amostra: 0 },
      por_dia: [{ dia: "2026-11-01", abertos: 2, encerrados: 1 }],
      por_setor: [],
      por_atendente: [{ user_id: "u-9", abertos: 2, encerrados: 1, primeira_resposta_media: 60, resolucao_media: null }],
      desfechos: { resolvida: 1 },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);

    const resposta = await atendimentos(
      new NextRequest(`http://localhost/api/v1/relatorios/atendimentos?de=2026-11-01&ate=2026-11-01&org=${OUTRA}`),
    );
    const corpo = (await resposta.json()) as { data: Record<string, unknown> };

    expect(resposta.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_relatorio_atendimentos", {
      p_org: ORG,
      p_de: "2026-11-01T03:00:00.000Z",
      p_ate: "2026-11-02T03:00:00.000Z",
      p_fuso: "America/Sao_Paulo",
    });
    expect(corpo.data.abertos).toBe(2);
    expect((corpo.data.por_atendente as Array<{ nome: string }>)[0]?.nome).toBe("Bia");
    // Nenhuma demanda fechada com motivo no período: lista vazia (não `null`).
    expect(corpo.data.motivos).toEqual([]);
  });

  it("conta os motivos de encerramento das demandas fechadas no período", async () => {
    sessao("agent");
    const { client } = clienteFalso({}, undefined, [
      { motivo: { nome: "Resolvido" } },
      { motivo: { nome: "Spam" } },
      { motivo: [{ nome: "Resolvido" }] },
      { motivo: null },
    ]);
    vi.mocked(createClient).mockResolvedValue(client as never);

    const resposta = await atendimentos(
      new NextRequest("http://localhost/api/v1/relatorios/atendimentos?de=2026-11-01&ate=2026-11-01"),
    );
    const corpo = (await resposta.json()) as { data: Record<string, unknown> };
    expect(corpo.data.motivos).toEqual([
      { motivo: "Resolvido", quantidade: 2 },
      { motivo: "Spam", quantidade: 1 },
    ]);
  });

  it("período invertido é 422 e não consulta nada", async () => {
    sessao("agent");
    const { client, rpc } = clienteFalso({});
    vi.mocked(createClient).mockResolvedValue(client as never);

    const resposta = await atendimentos(
      new NextRequest("http://localhost/api/v1/relatorios/atendimentos?de=2026-11-10&ate=2026-11-01"),
    );
    expect(resposta.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("3.6 — satisfação e atribuição são de quem gerencia", () => {
  it("agent recebe 403 nas duas, sem tocar o banco", async () => {
    sessao("agent");
    expect((await satisfacao(new NextRequest("http://localhost/api/v1/relatorios/satisfacao"))).status).toBe(403);
    expect((await atribuicao(new NextRequest("http://localhost/api/v1/relatorios/atribuicao"))).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("satisfação devolve a régua configurada e o resumo por régua", async () => {
    sessao("manager");
    const { client } = clienteFalso(
      {
        respostas: 2,
        pedidos: 2,
        sem_nota: 0,
        aguardando: 0,
        media: null,
        notas: {},
        por_escala: {
          csat_1_5: { respostas: 0, media: null, notas: {} },
          nps_0_10: { respostas: 2, media: 9.5, notas: { "9": 1, "10": 1 } },
        },
      },
      { timezone: "UTC", settings: { satisfacao: { ligado: true, escala: "nps_0_10" } } },
    );
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const resposta = await satisfacao(new NextRequest("http://localhost/api/v1/relatorios/satisfacao?de=2026-11-01&ate=2026-11-30"));
    const corpo = (await resposta.json()) as {
      data: { escala: string; resumo: { por_escala: { nps_0_10: { respostas: number } } }; recentes: unknown[] };
    };
    expect(resposta.status).toBe(200);
    expect(corpo.data.escala).toBe("nps_0_10");
    expect(corpo.data.resumo.por_escala.nps_0_10.respostas).toBe(2);
    expect(corpo.data.recentes).toEqual([]);
  });

  it("atribuição chama a função com a organização da sessão e devolve os links", async () => {
    sessao("manager");
    const { client, rpc } = clienteFalso(
      [{ link_id: null, nome: null, uso: null, cliques: 5, contatos: 2, negocios: 1, ganhos: 1, conversoes: 0 }],
      { timezone: "UTC" },
    );
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const resposta = await atribuicao(
      new NextRequest(`http://localhost/api/v1/relatorios/atribuicao?de=2026-11-01&ate=2026-11-01&org=${OUTRA}`),
    );
    const corpo = (await resposta.json()) as { data: { links: Array<{ cliques: number }> } };
    expect(resposta.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_relatorio_atribuicao", {
      p_org: ORG,
      p_de: "2026-11-01T00:00:00.000Z",
      p_ate: "2026-11-02T00:00:00.000Z",
    });
    expect(corpo.data.links[0]?.cliques).toBe(5);
  });
});
