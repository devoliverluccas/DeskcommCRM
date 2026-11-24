import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { PATCH as PATCH_MOTIVO } from "./[id]/route";
import { PATCH as PATCH_CONFIG } from "./config/route";
import { GET, POST } from "./route";
import { POST as POST_SUGESTOES } from "./sugestoes/route";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

/**
 * MOTIVOS DE ENCERRAMENTO — as rotas da tela de Configurações (fase 3, 3.2).
 *
 * Prende: o piso de papel (listar = agent, gravar = manager, pelo `requireRole`
 * que cada rota pede), a organização do CONTEXTO como filtro em toda escrita,
 * o 409 de nome repetido, "Usar sugestões" só com a lista vazia, o 404 de
 * motivo alheio e o merge da exigência sem apagar o resto de `settings`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const MOTIVO = "66666666-6666-4666-8666-666666666666";

/** Cadeia PostgREST que registra os filtros e resolve com `resultado`. */
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

function papel(minimo: "agent" | "manager", atual: "agent" | "manager") {
  vi.mocked(requireRole).mockImplementation(async (min) => {
    const ordem = { viewer: 1, agent: 2, manager: 3, admin: 4 } as const;
    if (ordem[atual] < ordem[min as keyof typeof ordem]) {
      return { ok: false, response: fail("forbidden_role", "papel", 403) } as Awaited<ReturnType<typeof requireRole>>;
    }
    return { ok: true, user: { id: USER, idioma: "pt-BR" }, org: { orgId: ORG, role: atual } } as Awaited<
      ReturnType<typeof requireRole>
    >;
  });
  return minimo;
}

function req(corpo: unknown, metodo = "POST", headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/motivos-de-encerramento", {
    method: metodo,
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
});

describe("GET — a lista e a exigência (agent)", () => {
  it("agent lê; a exigência sai de settings.atendimento", async () => {
    papel("agent", "agent");
    const motivos = cadeia({ data: [{ id: MOTIVO, nome: "Spam", categoria: "nao_procede", ativo: true, ordem: 0 }], error: null });
    const org = cadeia({ data: { settings: { atendimento: { motivo_obrigatorio_ao_encerrar: true } } }, error: null });
    vi.mocked(createClient).mockResolvedValue({
      from: (t: string) => (t === "organizations" ? org.q : motivos.q),
    } as never);

    const res = await GET();
    const corpo = (await res.json()) as { data: { motivos: unknown[]; motivo_obrigatorio_ao_encerrar: boolean } };

    expect(res.status).toBe(200);
    expect(corpo.data.motivos).toHaveLength(1);
    expect(corpo.data.motivo_obrigatorio_ao_encerrar).toBe(true);
    expect(motivos.filtros).toContainEqual(["organization_id", ORG]);
    expect(vi.mocked(requireRole).mock.calls[0]![0]).toBe("agent");
  });
});

describe("POST — criar (manager)", () => {
  it("agent recebe 403 e nada é gravado", async () => {
    papel("manager", "agent");
    const res = await POST(req({ nome: "Spam", categoria: "nao_procede" }));
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("manager cria com a organização do contexto, na próxima ordem, e audita", async () => {
    papel("manager", "manager");
    const ultima = cadeia({ data: { ordem: 4 }, error: null });
    const insercao = cadeia({ data: { id: MOTIVO, nome: "Spam", categoria: "nao_procede", ativo: true, ordem: 5 }, error: null });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? ultima.q : insercao.q) } as never);

    const res = await POST(req({ nome: "Spam", categoria: "nao_procede" }));

    expect(res.status).toBe(201);
    expect(ultima.filtros).toContainEqual(["organization_id", ORG]);
    expect(insercao.chamadas.insert![0]).toEqual({ organization_id: ORG, nome: "Spam", categoria: "nao_procede", ordem: 5 });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "motivo_de_encerramento.criado", resourceId: MOTIVO }));
  });

  it("organization_id no corpo é recusado (422)", async () => {
    papel("manager", "manager");
    const res = await POST(req({ nome: "Spam", categoria: "nao_procede", organization_id: ORG }));
    expect(res.status).toBe(422);
  });

  it("nome repetido (23505): 409", async () => {
    papel("manager", "manager");
    const ultima = cadeia({ data: null, error: null });
    const insercao = cadeia({ data: null, error: { code: "23505", message: "dup" } });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? ultima.q : insercao.q) } as never);

    const res = await POST(req({ nome: "spam", categoria: "nao_procede" }));
    expect(res.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("Idempotency-Key que não é uuid: 400", async () => {
    papel("manager", "manager");
    const res = await POST(req({ nome: "Spam", categoria: "nao_procede" }, "POST", { "Idempotency-Key": "abc" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /sugestoes — só com a lista vazia", () => {
  it("lista com itens: 409 lista_nao_vazia, sem inserir", async () => {
    papel("manager", "manager");
    const contagem = cadeia({ count: 2, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => contagem.q } as never);

    const res = await POST_SUGESTOES();
    const corpo = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(409);
    expect(corpo.error.code).toBe("lista_nao_vazia");
    expect(contagem.chamadas.insert).toBeUndefined();
  });

  it("lista vazia: cria as cinco sugestões na organização do contexto", async () => {
    papel("manager", "manager");
    const contagem = cadeia({ count: 0, error: null });
    const insercao = cadeia({ data: [], error: null });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? contagem.q : insercao.q) } as never);

    const res = await POST_SUGESTOES();
    expect(res.status).toBe(201);
    const linhas = insercao.chamadas.insert![0] as Array<{ organization_id: string; nome: string; categoria: string }>;
    expect(linhas.map((l) => l.nome)).toEqual(["Resolvido", "Sem resposta do cliente", "Duplicado", "Spam", "Venda realizada"]);
    expect(linhas.every((l) => l.organization_id === ORG)).toBe(true);
    expect(contagem.filtros).toContainEqual(["organization_id", ORG]);
  });
});

describe("PATCH /[id] — renomear, ordenar, desativar", () => {
  function chamarPatch(corpo: unknown, id = MOTIVO) {
    return PATCH_MOTIVO(req(corpo, "PATCH"), { params: Promise.resolve({ id }) });
  }

  it("filtra pela organização; sem linha devolvida é 404 (motivo de outra org)", async () => {
    papel("manager", "manager");
    const upd = cadeia({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => upd.q } as never);

    const res = await chamarPatch({ ativo: false });
    expect(res.status).toBe(404);
    expect(upd.filtros).toContainEqual(["organization_id", ORG]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("desativar audita", async () => {
    papel("manager", "manager");
    const upd = cadeia({ data: { id: MOTIVO, nome: "Spam", categoria: "nao_procede", ativo: false, ordem: 0 }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ from: () => upd.q } as never);

    const res = await chamarPatch({ ativo: false });
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "motivo_de_encerramento.alterado" }));
  });

  it("agent: 403", async () => {
    papel("manager", "agent");
    expect((await chamarPatch({ ativo: false })).status).toBe(403);
  });

  it("id que não é uuid: 404 sem tocar no banco", async () => {
    papel("manager", "manager");
    expect((await chamarPatch({ ativo: false }, "x")).status).toBe(404);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("PATCH /config — a exigência", () => {
  it("grava sem apagar as outras chaves de settings, e audita", async () => {
    papel("manager", "manager");
    const leitura = cadeia({ data: { settings: { satisfacao: { ligado: true }, atendimento: { x: 1 } } }, error: null });
    const escrita = cadeia({ error: null });
    let n = 0;
    vi.mocked(createAdminClient).mockReturnValue({ from: () => (n++ === 0 ? leitura.q : escrita.q) } as never);

    const res = await PATCH_CONFIG(req({ motivo_obrigatorio_ao_encerrar: true }, "PATCH"));

    expect(res.status).toBe(200);
    expect(escrita.chamadas.update![0]).toEqual({
      settings: { satisfacao: { ligado: true }, atendimento: { x: 1, motivo_obrigatorio_ao_encerrar: true } },
    });
    expect(escrita.filtros).toContainEqual(["id", ORG]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.motivo_obrigatorio_alterado" }));
  });

  it("corpo inválido: 422", async () => {
    papel("manager", "manager");
    expect((await PATCH_CONFIG(req({ motivo_obrigatorio_ao_encerrar: "sim" }, "PATCH"))).status).toBe(422);
  });
});
