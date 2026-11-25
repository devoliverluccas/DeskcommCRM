import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type * as SaudeDoNumero from "@/lib/channels/meta/saude-do-numero";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  saude: vi.fn(),
  atualizar: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/meta/saude-do-numero", async (orig) => ({
  ...(await orig<typeof SaudeDoNumero>()),
  saudeDaConexaoOficial: mocks.saude,
  atualizarSaudePelaGraph: mocks.atualizar,
}));

import { GET } from "./route";

const org = "f2210000-0000-4000-8000-000000000002";
const pedido = (q = "") => new NextRequest(`http://local/api/v1/channels/official/saude${q}`);
const conexao = (atualizadaEm: string | null) => ({
  channelSessionId: "s1",
  phoneNumberId: "123",
  qualidade: "YELLOW",
  limite: "TIER_1K",
  conversasPorDia: 1000,
  eventoDaConta: null,
  atualizadaEm,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue({ ok: true, user: { id: "eu" }, org: { orgId: org } });
});

it("só admin lê", async () => {
  mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await GET(pedido())).status).toBe(403);
  expect(mocks.role).toHaveBeenCalledWith("admin", expect.anything());
});

it("sem conexão oficial: conectado false, sem Graph", async () => {
  mocks.saude.mockResolvedValue(null);
  const r = await (await GET(pedido())).json();
  expect(r.data).toEqual({ conectado: false, saude: null, leitura: null });
  expect(mocks.atualizar).not.toHaveBeenCalled();
});

it("leitura recente: devolve a guardada sem perguntar à Meta", async () => {
  mocks.saude.mockResolvedValue(conexao(new Date().toISOString()));
  const r = await (await GET(pedido())).json();
  expect(mocks.saude).toHaveBeenCalledWith(expect.anything(), org);
  expect(mocks.atualizar).not.toHaveBeenCalled();
  expect(r.data.saude).toMatchObject({ qualidade: "YELLOW", limite: "TIER_1K", conversas_por_dia: 1000, sem_limite: false });
});

it("leitura velha: pergunta à Graph; falha dela não derruba a resposta", async () => {
  mocks.saude.mockResolvedValue(conexao("2020-01-01T00:00:00Z"));
  mocks.atualizar.mockResolvedValue({ desfecho: "saude:falhou", motivo: "rede" });
  const res = await GET(pedido());
  expect(res.status).toBe(200);
  expect(mocks.atualizar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: org }));
  expect((await res.json()).data.leitura).toEqual({ origem: "guardada", erro: "rede" });
});

it("?atualizar=1 força a pergunta mesmo com leitura recente", async () => {
  mocks.saude.mockResolvedValue(conexao(new Date().toISOString()));
  mocks.atualizar.mockResolvedValue({ desfecho: "saude" });
  const r = await (await GET(pedido("?atualizar=1"))).json();
  expect(mocks.atualizar).toHaveBeenCalled();
  expect(r.data.leitura.origem).toBe("graph");
});
