import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { PATCH } from "./[id]/route";
import { GET, POST } from "./route";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

/**
 * REGRAS DE PONTUAÇÃO — as rotas da tela de Configurações (fase 4, 4.5).
 *
 * Prende: `manager` para ler e gravar, a organização do CONTEXTO em toda escrita
 * (nunca do corpo), a condição conferida pelo schema do evento, a etapa da
 * organização, o evento imutável na edição, o 404 de regra alheia e a auditoria.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const REGRA = "66666666-6666-4666-8666-666666666666";
const ETAPA = "77777777-7777-4777-8777-777777777777";

function cadeia(resultado: unknown) {
  const filtros: Array<[string, unknown]> = [];
  const chamadas: Record<string, unknown[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok);
        return (...args: unknown[]) => {
          chamadas[prop] = args;
          if (prop === "eq") filtros.push([args[0] as string, args[1]]);
          if (prop === "single" || prop === "maybeSingle") return Promise.resolve(resultado);
          return q;
        };
      },
    },
  );
  return { q, filtros, chamadas };
}

function papel(atual: "agent" | "manager") {
  vi.mocked(requireRole).mockImplementation(async (min) => {
    const ordem = { viewer: 1, agent: 2, manager: 3, admin: 4 } as const;
    if (ordem[atual] < ordem[min as keyof typeof ordem]) {
      return { ok: false, response: fail("forbidden_role", "papel", 403) } as Awaited<ReturnType<typeof requireRole>>;
    }
    return { ok: true, user: { id: USER, idioma: "pt-BR" }, org: { orgId: ORG, role: atual } } as Awaited<
      ReturnType<typeof requireRole>
    >;
  });
}

function req(corpo: unknown, metodo = "POST", headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/pontuacao/regras", {
    method: metodo,
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...headers },
  });
}

const linha = (extra: Record<string, unknown> = {}) => ({
  id: REGRA,
  nome: "Respondeu",
  evento: "respondeu_followup",
  condicao: {},
  pontos: 10,
  ativo: true,
  teto_por_contato: null,
  created_at: "2026-11-24T00:00:00Z",
  updated_at: "2026-11-24T00:00:00Z",
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("GET — a lista (manager)", () => {
  it("agent recebe 403", async () => {
    papel("agent");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("manager lê pela sessão, filtrando a organização do contexto, ativas primeiro", async () => {
    papel("manager");
    const lista = cadeia({
      data: [linha({ id: "a", nome: "B", ativo: false }), linha({ id: "b", nome: "Z", ativo: true })],
      error: null,
    });
    vi.mocked(createClient).mockResolvedValue({ from: () => lista.q } as never);

    const res = await GET();
    const corpo = (await res.json()) as { data: { regras: Array<{ id: string }> } };
    expect(res.status).toBe(200);
    expect(lista.filtros).toContainEqual(["organization_id", ORG]);
    expect(corpo.data.regras.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("POST — criar (manager)", () => {
  it("agent recebe 403 e nada é gravado", async () => {
    papel("agent");
    const res = await POST(req({ nome: "x", evento: "mensagem_recebida", pontos: 1 }));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("cria com a organização do contexto e audita", async () => {
    papel("manager");
    const insercao = cadeia({ data: linha(), error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => insercao.q } as never);

    const res = await POST(req({ nome: "Respondeu", evento: "respondeu_followup", pontos: 10 }));
    expect(res.status).toBe(201);
    expect(insercao.chamadas.insert![0]).toMatchObject({
      organization_id: ORG,
      evento: "respondeu_followup",
      pontos: 10,
      condicao: {},
      teto_por_contato: null,
      created_by: USER,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "pontuacao.regra_criada", resourceId: REGRA }));
  });

  it("organization_id no corpo é recusado (422)", async () => {
    papel("manager");
    const res = await POST(req({ nome: "x", evento: "mensagem_recebida", pontos: 1, organization_id: ORG }));
    expect(res.status).toBe(422);
  });

  it("zero pontos, evento fora do vocabulário e tag sem alvo: 422", async () => {
    papel("manager");
    expect((await POST(req({ nome: "x", evento: "mensagem_recebida", pontos: 0 }))).status).toBe(422);
    expect((await POST(req({ nome: "x", evento: "link_clicado", pontos: 1 }))).status).toBe(422);
    expect((await POST(req({ nome: "x", evento: "tag_aplicada", pontos: 1, condicao: {} }))).status).toBe(422);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("etapa que não é da organização: 422, e nada é inserido", async () => {
    papel("manager");
    const etapa = cadeia({ data: null, error: null });
    const insercao = cadeia({ data: linha(), error: null });
    vi.mocked(createAdminClient).mockReturnValue({
      from: (t: string) => (t === "crm_stages" ? etapa.q : insercao.q),
    } as never);

    const res = await POST(req({ nome: "Proposta", evento: "etapa_alcancada", pontos: 20, condicao: { stage_id: ETAPA } }));
    expect(res.status).toBe(422);
    expect(etapa.filtros).toContainEqual(["organization_id", ORG]);
    expect(insercao.chamadas.insert).toBeUndefined();
  });

  it("Idempotency-Key que não é uuid: 400", async () => {
    papel("manager");
    const res = await POST(req({ nome: "x", evento: "mensagem_recebida", pontos: 1 }, "POST", { "Idempotency-Key": "abc" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH — editar (manager)", () => {
  const ctx = { params: Promise.resolve({ id: REGRA }) };

  it("trocar o evento é recusado (422)", async () => {
    papel("manager");
    const res = await PATCH(req({ evento: "mensagem_recebida" }, "PATCH"), ctx);
    expect(res.status).toBe(422);
  });

  it("regra de outra organização: 404", async () => {
    papel("manager");
    const leitura = cadeia({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => leitura.q } as never);
    const res = await PATCH(req({ ativo: false }, "PATCH"), ctx);
    expect(res.status).toBe(404);
    expect(leitura.filtros).toContainEqual(["organization_id", ORG]);
  });

  it("condição conferida contra o evento GRAVADO", async () => {
    papel("manager");
    const leitura = cadeia({ data: { evento: "tag_aplicada" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => leitura.q } as never);
    const res = await PATCH(req({ condicao: { stage_id: ETAPA } }, "PATCH"), ctx);
    expect(res.status).toBe(422);
  });

  it("desativar grava na organização do contexto e audita", async () => {
    papel("manager");
    const leitura = cadeia({ data: { evento: "mensagem_recebida" }, error: null });
    const escrita = cadeia({ data: linha({ evento: "mensagem_recebida", ativo: false }), error: null });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? leitura.q : escrita.q) } as never);

    const res = await PATCH(req({ ativo: false }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(escrita.filtros).toContainEqual(["organization_id", ORG]);
    expect(escrita.chamadas.update![0]).toMatchObject({ ativo: false });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pontuacao.regra_alterada", metadata: expect.objectContaining({ campos: ["ativo"] }) }),
    );
  });
});
