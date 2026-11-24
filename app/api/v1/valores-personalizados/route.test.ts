import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { DELETE, PATCH } from "./[id]/route";
import { GET, POST } from "./route";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

/**
 * VALORES PERSONALIZADOS — as rotas da tela (fase 4, item 4.6).
 *
 * Prende: o piso de papel (ler = agent, gravar = manager), a organização do
 * CONTEXTO como filtro em toda escrita (nunca do corpo), o 409 de chave
 * repetida, o formato da chave, o 404 de valor alheio e a auditoria sem o VALOR.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const VALOR = "66666666-6666-4666-8666-666666666666";

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
  return new NextRequest("http://localhost/api/v1/valores-personalizados", {
    method: metodo,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...headers },
  });
}

const LINHA = {
  id: VALOR,
  chave: "pix",
  valor: "pix@loja.exemplo",
  descricao: null,
  created_at: "2026-11-24T00:00:00Z",
  updated_at: "2026-11-24T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("GET — agent lê, pela sessão, filtrado pela organização", () => {
  it("devolve a lista em ordem de chave", async () => {
    papel("agent");
    const lista = cadeia({ data: [{ ...LINHA, chave: "pix" }, { ...LINHA, id: "b", chave: "endereco" }], error: null });
    vi.mocked(createClient).mockResolvedValue({ from: () => lista.q } as never);

    const res = await GET();
    const corpo = (await res.json()) as { data: { valores: Array<{ chave: string }> } };
    expect(res.status).toBe(200);
    expect(corpo.data.valores.map((v) => v.chave)).toEqual(["endereco", "pix"]);
    expect(lista.filtros).toContainEqual(["organization_id", ORG]);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("agent");
  });
});

describe("POST — criar (manager)", () => {
  it("agent recebe 403 e nada é gravado", async () => {
    papel("agent");
    const res = await POST(req({ chave: "pix", valor: "x" }));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("manager cria com a organização do contexto e audita SÓ a chave", async () => {
    papel("manager");
    const conta = cadeia({ count: 3, error: null });
    const insercao = cadeia({ data: LINHA, error: null });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? conta.q : insercao.q) } as never);

    const res = await POST(req({ chave: " PIX ", valor: "pix@loja.exemplo", descricao: "" }));

    expect(res.status).toBe(201);
    expect(conta.filtros).toContainEqual(["organization_id", ORG]);
    expect(insercao.chamadas.insert![0]).toEqual({
      organization_id: ORG,
      chave: "pix",
      valor: "pix@loja.exemplo",
      descricao: null,
    });
    const auditoria = vi.mocked(audit).mock.calls[0]![0] as { action: string; metadata: Record<string, unknown> };
    expect(auditoria.action).toBe("valor_personalizado.criado");
    expect(auditoria.metadata).toEqual({ chave: "pix" });
    expect(JSON.stringify(auditoria)).not.toContain("pix@loja.exemplo");
  });

  it("organization_id no corpo é recusado (422)", async () => {
    papel("manager");
    expect((await POST(req({ chave: "pix", valor: "x", organization_id: ORG }))).status).toBe(422);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([["1pix"], ["p"], ["pix-da-loja"], ["a".repeat(41)]])("chave fora do formato (%s): 422", async (chave) => {
    papel("manager");
    expect((await POST(req({ chave, valor: "x" }))).status).toBe(422);
  });

  it("valor vazio ou acima de 2000: 422", async () => {
    papel("manager");
    expect((await POST(req({ chave: "pix", valor: "   " }))).status).toBe(422);
    expect((await POST(req({ chave: "pix", valor: "x".repeat(2001) }))).status).toBe(422);
  });

  it("chave repetida (23505): 409", async () => {
    papel("manager");
    const conta = cadeia({ count: 0, error: null });
    const insercao = cadeia({ data: null, error: { code: "23505", message: "dup" } });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? conta.q : insercao.q) } as never);
    expect((await POST(req({ chave: "pix", valor: "x" }))).status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("no teto de 200: 422 sem inserir", async () => {
    papel("manager");
    const conta = cadeia({ count: 200, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => conta.q } as never);
    expect((await POST(req({ chave: "pix", valor: "x" }))).status).toBe(422);
    expect(conta.chamadas.insert).toBeUndefined();
  });

  it("Idempotency-Key que não é uuid: 400", async () => {
    papel("manager");
    expect((await POST(req({ chave: "pix", valor: "x" }, "POST", { "Idempotency-Key": "abc" }))).status).toBe(400);
  });
});

describe("PATCH / DELETE /[id] (manager)", () => {
  const ctx = (id = VALOR) => ({ params: Promise.resolve({ id }) });

  it("PATCH filtra pela organização; sem linha devolvida é 404 (valor de outra org)", async () => {
    papel("manager");
    const upd = cadeia({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => upd.q } as never);
    const res = await PATCH(req({ valor: "novo" }, "PATCH"), ctx());
    expect(res.status).toBe(404);
    expect(upd.filtros).toContainEqual(["organization_id", ORG]);
    expect(upd.filtros).toContainEqual(["id", VALOR]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("PATCH grava só os campos enviados e audita os nomes deles", async () => {
    papel("manager");
    const upd = cadeia({ data: { ...LINHA, valor: "novo" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => upd.q } as never);
    const res = await PATCH(req({ valor: "novo" }, "PATCH"), ctx());
    expect(res.status).toBe(200);
    expect(upd.chamadas.update![0]).toEqual({ valor: "novo" });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "valor_personalizado.alterado", metadata: { campos: ["valor"], chave: "pix" } }),
    );
  });

  it("PATCH vazio: 422; agent: 403; id que não é uuid: 404 sem banco", async () => {
    papel("manager");
    expect((await PATCH(req({}, "PATCH"), ctx())).status).toBe(422);
    expect((await PATCH(req({ valor: "x" }, "PATCH"), ctx("x"))).status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
    papel("agent");
    expect((await PATCH(req({ valor: "x" }, "PATCH"), ctx())).status).toBe(403);
  });

  it("DELETE apaga filtrando a organização e audita a chave", async () => {
    papel("manager");
    const del = cadeia({ data: { id: VALOR, chave: "pix" }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => del.q } as never);
    const res = await DELETE(req(undefined, "DELETE"), ctx());
    expect(res.status).toBe(200);
    expect(del.chamadas.delete).toBeDefined();
    expect(del.filtros).toContainEqual(["organization_id", ORG]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "valor_personalizado.removido", metadata: { chave: "pix" } }),
    );
  });

  it("DELETE de valor alheio: 404 e nenhuma auditoria", async () => {
    papel("manager");
    const del = cadeia({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => del.q } as never);
    expect((await DELETE(req(undefined, "DELETE"), ctx())).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });
});
