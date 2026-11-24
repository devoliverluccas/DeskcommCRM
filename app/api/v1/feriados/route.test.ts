import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

import { DELETE } from "./[id]/route";
import { POST as importar } from "./importar-nacionais/route";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "22222222-2222-4222-8222-222222222222";
const FERIADO = "33333333-3333-4333-8333-333333333333";

let inserido: Record<string, unknown> | null = null;
let upsertado: { linhas: Array<Record<string, unknown>>; opcoes: Record<string, unknown> } | null = null;
let erroDoInsert: { code: string; message: string } | null = null;
let linhasNovasDoUpsert = 13;
const filtros: Record<string, unknown> = {};

const post = (url: string, corpo: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(corpo) });

beforeEach(() => {
  vi.clearAllMocks();
  inserido = null;
  upsertado = null;
  erroDoInsert = null;
  linhasNovasDoUpsert = 13;
  for (const k of Object.keys(filtros)) delete filtros[k];
  vi.mocked(loadAuthUser).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: EU, idioma: "pt-BR" },
    org: { orgId: ORG, role: "manager" },
  } as Awaited<ReturnType<typeof requireRole>>);
  const q: Record<string, unknown> = {};
  q.insert = (v: Record<string, unknown>) => ((inserido = v), q);
  q.upsert = (linhas: Array<Record<string, unknown>>, opcoes: Record<string, unknown>) => ((upsertado = { linhas, opcoes }), q);
  q.delete = () => q;
  q.eq = (k: string, v: unknown) => ((filtros[k] = v), q);
  q.select = () => q;
  q.single = async () => (erroDoInsert ? { data: null, error: erroDoInsert } : { data: { id: FERIADO, ...inserido }, error: null });
  q.maybeSingle = async () =>
    filtros.id === FERIADO && filtros.organization_id === ORG
      ? { data: { id: FERIADO, data: "2026-11-23", nome: "Ponte" }, error: null }
      : { data: null, error: null };
  q.then = (resolve: (x: unknown) => unknown) =>
    Promise.resolve({ data: Array.from({ length: linhasNovasDoUpsert }, (_, i) => ({ id: `n${i}` })), error: null }).then(resolve);
  vi.mocked(createAdminClient).mockReturnValue({ from: () => q } as unknown as ReturnType<typeof createAdminClient>);
});

describe("/api/v1/feriados (item 3.8)", () => {
  it("POST cadastra com a organização da SESSÃO (nunca a do corpo) e audita", async () => {
    const r = await POST(
      post("/api/v1/feriados", { data: "2026-11-23", nome: " Ponte ", recorrente_anual: false, organization_id: "outra" }),
    );
    expect(r.status).toBe(200);
    expect(inserido).toEqual({ organization_id: ORG, data: "2026-11-23", nome: "Ponte", recorrente_anual: false, created_by: EU });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "feriado.criado", organizationId: ORG }));
  });

  it("POST: data repetida é 409 (único por organização + data), sem auditoria", async () => {
    erroDoInsert = { code: "23505", message: "duplicate" };
    const r = await POST(post("/api/v1/feriados", { data: "2026-11-23", nome: "Ponte" }));
    expect(r.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("POST: data inválida é 422; exige gestor", async () => {
    expect((await POST(post("/api/v1/feriados", { data: "23/11/2026", nome: "x" }))).status).toBe(422);
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "Acesso negado.", 403) });
    expect((await POST(post("/api/v1/feriados", { data: "2026-11-23", nome: "x" }))).status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith("manager", expect.anything());
  });

  it("DELETE filtra por organização ALÉM do id — id de outra organização é 404", async () => {
    const ok = await DELETE(new NextRequest(`http://localhost/api/v1/feriados/${FERIADO}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: FERIADO }),
    });
    expect(ok.status).toBe(200);
    expect(filtros.organization_id).toBe(ORG);
    const outro = "44444444-4444-4444-8444-444444444444";
    const r = await DELETE(new NextRequest(`http://localhost/api/v1/feriados/${outro}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: outro }),
    });
    expect(r.status).toBe(404);
  });

  it("importar nacionais: 13 datas do ano, sem duplicar (ignoreDuplicates), e audita só quando entrou alguma", async () => {
    const r = await importar(post("/api/v1/feriados/importar-nacionais", { ano: 2026 }));
    expect(r.status).toBe(200);
    expect(upsertado?.linhas).toHaveLength(13);
    expect(upsertado?.linhas.every((l) => l.organization_id === ORG)).toBe(true);
    expect(upsertado?.opcoes).toEqual({ onConflict: "organization_id,data", ignoreDuplicates: true });
    expect(audit).toHaveBeenCalledTimes(1);

    vi.mocked(audit).mockClear();
    linhasNovasDoUpsert = 0;
    await importar(post("/api/v1/feriados/importar-nacionais", { ano: 2026 }));
    expect(audit).not.toHaveBeenCalled();
  });
});
