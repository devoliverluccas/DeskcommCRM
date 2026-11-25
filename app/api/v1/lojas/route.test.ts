/**
 * As rotas de LOJAS (item 5.4) e o filtro "Loja" do relatório de Atendimentos.
 *
 * O que fica preso:
 *  - sem o módulo instalado, TODA rota responde 404 antes de qualquer leitura
 *    das tabelas do módulo — e o relatório recusa `?loja=` em vez de devolver o
 *    número da organização inteira com rótulo de loja;
 *  - com o módulo instalado e a empresa desligada, só a configuração responde;
 *  - a organização é a da SESSÃO: o corpo não escolhe (`.strict()` → 422) e todo
 *    filtro/insert leva a organização do cookie;
 *  - a primeira loja nasce padrão;
 *  - cadastrar é `admin`.
 *
 * SABOTAGEM: tirar o `lojasLigadas` do portão faz o caso "empresa desligada"
 * acusar; trocar `orgId` pelo corpo faz o caso da organização acusar.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: vi.fn(async () => new Map()) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { GET as relatorioDeAtendimentos } from "../relatorios/atendimentos/route";
import { PATCH as configurar } from "./configuracao/route";
import { GET as listar, POST as criar } from "./route";

const ORG = "11111111-1111-4111-8111-111111111111";
const LOJA = "22222222-2222-4222-8222-222222222222";

type Op = { tabela: string; op: string; args: unknown[] };

/** Cliente de serviço de mentira: grava cada chamada; cada tabela responde o que o teste mandar. */
function bancoFalso(estado: {
  instalado: boolean;
  empresaLigada: boolean;
  lojas?: unknown[];
  contagem?: number;
}) {
  const ops: Op[] = [];
  const rpc = vi.fn(async (nome: string) => ({ data: nome === "fn_lojas_definir_padrao" || nome === "fn_lojas_configurar" ? true : {}, error: null }));
  function from(tabela: string) {
    const linhas: Record<string, unknown[]> = {
      modulos_instalados: estado.instalado ? [{ modulo: "lojas", estado: "ativo" }] : [],
      organizations: [{ settings: estado.empresaLigada ? { lojas: { enabled: true } } : {}, timezone: "America/Sao_Paulo" }],
      lojas: estado.lojas ?? [],
    };
    const resposta = { data: linhas[tabela] ?? [], error: null, count: estado.contagem ?? 0 };
    const cadeia: Record<string, unknown> = {};
    const registra =
      (op: string) =>
      (...args: unknown[]) => {
        ops.push({ tabela, op, args });
        return cadeia;
      };
    for (const m of ["select", "eq", "in", "is", "order", "limit", "not", "gte", "lt", "insert", "update"]) cadeia[m] = registra(m);
    cadeia.maybeSingle = async () => ({ data: (linhas[tabela] ?? [])[0] ?? null, error: null });
    cadeia.single = async () => {
      const inserido = ops.filter((o) => o.tabela === tabela && o.op === "insert").at(-1)?.args[0] as Record<string, unknown> | undefined;
      return { data: { id: LOJA, codigo: null, endereco: null, telefone: null, ativa: true, ...inserido }, error: null };
    };
    cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
    return cadeia;
  }
  return { client: { from, rpc }, ops, rpc };
}

function sessao(role: "agent" | "manager" | "admin") {
  vi.mocked(requireRole).mockImplementation(async (piso) => {
    const ordem = { viewer: 1, agent: 2, manager: 3, admin: 4 } as const;
    if (ordem[role] < ordem[piso as keyof typeof ordem]) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), { status: 403 }),
      } as unknown as Awaited<ReturnType<typeof requireRole>>;
    }
    return { ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: ORG, role } } as Awaited<ReturnType<typeof requireRole>>;
  });
}

function usar(banco: ReturnType<typeof bancoFalso>) {
  vi.mocked(createAdminClient).mockReturnValue(banco.client as never);
  vi.mocked(createClient).mockResolvedValue(banco.client as never);
}

const post = (corpo: unknown) =>
  new NextRequest("http://x/api/v1/lojas", { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sem o módulo, nada responde", () => {
  it("módulo não instalado: listar, cadastrar e configurar são 404 e nenhuma tabela do módulo é lida", async () => {
    sessao("admin");
    const banco = bancoFalso({ instalado: false, empresaLigada: true });
    usar(banco);
    expect((await listar()).status).toBe(404);
    expect((await criar(post({ nome: "Centro" }))).status).toBe(404);
    const patch = new NextRequest("http://x/api/v1/lojas/configuracao", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect((await configurar(patch)).status).toBe(404);
    expect(banco.ops.some((o) => o.tabela === "lojas")).toBe(false);
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("instalado e a empresa desligada: as rotas de uso são 404; a configuração liga", async () => {
    sessao("admin");
    const banco = bancoFalso({ instalado: true, empresaLigada: false });
    usar(banco);
    expect((await listar()).status).toBe(404);
    const patch = new NextRequest("http://x/api/v1/lojas/configuracao", { method: "PATCH", body: JSON.stringify({ enabled: true }) });
    expect((await configurar(patch)).status).toBe(200);
    expect(banco.rpc).toHaveBeenCalledWith("fn_lojas_configurar", { p_organization_id: ORG, p_enabled: true });
  });

  it("o relatório recusa ?loja= sem o módulo e não chama a conta da loja", async () => {
    sessao("agent");
    const banco = bancoFalso({ instalado: false, empresaLigada: true });
    usar(banco);
    const req = new NextRequest(`http://x/api/v1/relatorios/atendimentos?de=2026-11-01&ate=2026-11-07&loja=${LOJA}`);
    expect((await relatorioDeAtendimentos(req)).status).toBe(404);
    expect(banco.rpc).not.toHaveBeenCalled();
  });

  it("sem ?loja= o relatório é o de sempre, mesmo com o módulo", async () => {
    sessao("agent");
    const banco = bancoFalso({ instalado: true, empresaLigada: true });
    usar(banco);
    const req = new NextRequest("http://x/api/v1/relatorios/atendimentos?de=2026-11-01&ate=2026-11-07");
    expect((await relatorioDeAtendimentos(req)).status).toBe(200);
    expect(banco.rpc.mock.calls.map((c) => c[0])).toEqual(["fn_relatorio_atendimentos"]);
  });
});

describe("com o módulo ligado", () => {
  it("o relatório com ?loja= usa a conta recortada, com a organização da sessão", async () => {
    sessao("agent");
    const banco = bancoFalso({ instalado: true, empresaLigada: true });
    usar(banco);
    const req = new NextRequest(`http://x/api/v1/relatorios/atendimentos?de=2026-11-01&ate=2026-11-07&loja=${LOJA}`);
    expect((await relatorioDeAtendimentos(req)).status).toBe(200);
    expect(banco.rpc).toHaveBeenCalledWith("fn_lojas_relatorio_atendimentos", expect.objectContaining({ p_org: ORG, p_loja: LOJA }));
    const lixo = new NextRequest("http://x/api/v1/relatorios/atendimentos?de=2026-11-01&ate=2026-11-07&loja=centro");
    expect((await relatorioDeAtendimentos(lixo)).status).toBe(422);
  });

  it("listar filtra pela organização da sessão", async () => {
    sessao("agent");
    const banco = bancoFalso({ instalado: true, empresaLigada: true, lojas: [{ id: LOJA, nome: "Centro", ativa: true, padrao: true }] });
    usar(banco);
    const res = await listar();
    expect(res.status).toBe(200);
    expect(banco.ops).toContainEqual({ tabela: "lojas", op: "eq", args: ["organization_id", ORG] });
  });

  it("a primeira loja nasce padrão, com a organização da sessão", async () => {
    sessao("admin");
    const banco = bancoFalso({ instalado: true, empresaLigada: true, contagem: 0 });
    usar(banco);
    const res = await criar(post({ nome: "Centro", codigo: " C1 " }));
    expect(res.status).toBe(201);
    const insert = banco.ops.find((o) => o.tabela === "lojas" && o.op === "insert");
    expect(insert?.args[0]).toMatchObject({ organization_id: ORG, nome: "Centro", codigo: "C1", padrao: true });
  });

  it("a segunda não nasce padrão; pedir padrão troca pela função atômica", async () => {
    sessao("admin");
    const banco = bancoFalso({ instalado: true, empresaLigada: true, contagem: 1 });
    usar(banco);
    expect((await criar(post({ nome: "Bairro" }))).status).toBe(201);
    expect(banco.ops.find((o) => o.op === "insert")?.args[0]).toMatchObject({ padrao: false });
    expect(banco.rpc).not.toHaveBeenCalled();
    expect((await criar(post({ nome: "Shopping", padrao: true }))).status).toBe(201);
    expect(banco.rpc).toHaveBeenCalledWith("fn_lojas_definir_padrao", { p_org: ORG, p_loja: LOJA });
  });

  it("o corpo não escolhe a organização, e cadastrar é admin", async () => {
    sessao("admin");
    usar(bancoFalso({ instalado: true, empresaLigada: true }));
    expect((await criar(post({ nome: "Centro", organization_id: "99999999-9999-4999-8999-999999999999" }))).status).toBe(422);
    sessao("manager");
    expect((await criar(post({ nome: "Centro" }))).status).toBe(403);
  });
});
