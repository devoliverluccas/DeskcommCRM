/**
 * GET /api/v1/conversations/[id]/media — a galeria da aba Mídias do painel.
 *
 * O dublê do Supabase APLICA os filtros que a rota pede (eq, in, is, or,
 * ordem, limite) sobre linhas de duas organizações. Assim o que se mede é o
 * RESULTADO — o que sai para a tela —, e não só que um método foi chamado:
 * tirar o filtro de organização, de tipo ou de cursor da rota deixa estes casos
 * vermelhos.
 *
 * Roda com: pnpm vitest run "app/api/v1/conversations/[id]/media/route.galeria.test.ts"
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONV_A = "33333333-3333-4333-8333-333333333333";
const CONV_B = "44444444-4444-4444-8444-444444444444";
const CONTATO_A = "55555555-5555-4555-8555-555555555555";
const CONTATO_B = "66666666-6666-4666-8666-666666666666";

type Linha = Record<string, unknown>;

const h = vi.hoisted(() => ({
  autorizado: true,
  orgAtiva: "",
  tabelas: {} as Record<string, Array<Record<string, unknown>>>,
  consultas: [] as Array<{ tabela: string; ors: string[]; ins: Array<[string, unknown[]]> }>,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () =>
    h.autorizado
      ? { ok: true, user: { id: "u-1", idioma: "pt-BR" }, org: { orgId: h.orgAtiva, name: "Org", role: "viewer" } }
      : {
          ok: false,
          response: new Response(JSON.stringify({ error: { code: "unauthenticated" } }), { status: 401 }),
        },
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

/** Lê `a->b` como o PostgREST: caminho dentro do jsonb. */
function valor(linha: Linha, coluna: string): unknown {
  const [raiz, chave] = coluna.split("->");
  const v = linha[raiz!];
  if (!chave) return v;
  return v && typeof v === "object" ? (v as Record<string, unknown>)[chave] : undefined;
}

/** O `.or()` do cursor (tupla sent_at, created_at, id) e o da presença de arquivo. */
function aplicarOr(linhas: Linha[], expr: string): Linha[] {
  if (expr === "media_storage_path.not.is.null,media_url.not.is.null") {
    return linhas.filter((l) => l.media_storage_path != null || l.media_url != null);
  }
  const m = /^sent_at\.lt\.([^,]+),and\(sent_at\.eq\.[^,]+,created_at\.lt\.([^)]+)\),and\(sent_at\.eq\.[^,]+,created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)$/.exec(expr);
  if (!m) throw new Error(`or() não modelado: ${expr}`);
  const [, s, c, id] = m as unknown as [string, string, string, string];
  const chave = (l: Linha) => [String(l.sent_at), String(l.created_at), String(l.id)];
  return linhas.filter((l) => {
    const [ls, lc, li] = chave(l);
    return ls! < s || (ls === s && lc! < c) || (ls === s && lc === c && li! < id);
  });
}

function clienteFalso() {
  return {
    from(tabela: string) {
      let linhas = [...(h.tabelas[tabela] ?? [])];
      const ordem: Array<[string, boolean]> = [];
      let limite = Infinity;
      const registro = { tabela, ors: [] as string[], ins: [] as Array<[string, unknown[]]> };
      h.consultas.push(registro);
      const resultado = () => {
        const ordenadas = [...linhas].sort((x, y) => {
          for (const [col, asc] of ordem) {
            const a = String(valor(x, col));
            const b = String(valor(y, col));
            if (a !== b) return (a < b ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
        return { data: ordenadas.slice(0, limite), error: null };
      };
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => ((linhas = linhas.filter((l) => valor(l, col) === v)), q),
        in: (col: string, vs: unknown[]) => {
          registro.ins.push([col, vs]);
          linhas = linhas.filter((l) => vs.includes(valor(l, col)));
          return q;
        },
        is: (col: string, v: null) => ((linhas = linhas.filter((l) => (valor(l, col) ?? null) === v)), q),
        or: (expr: string) => {
          registro.ors.push(expr);
          linhas = aplicarOr(linhas, expr);
          return q;
        },
        order: (col: string, o: { ascending: boolean }) => (ordem.push([col, o.ascending]), q),
        limit: (n: number) => ((limite = n), q),
        maybeSingle: async () => ({ data: resultado().data[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          Promise.resolve(resultado()).then(ok, erro),
      };
      return q;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clienteFalso() }));

function mensagem(p: Partial<Linha> & { id: string; sent_at: string }): Linha {
  return {
    organization_id: ORG_A,
    conversation_id: CONV_A,
    type: "image",
    direction: "inbound",
    media_mime: "image/jpeg",
    media_size_bytes: 1000,
    media_storage_path: `${ORG_A}/${CONV_A}/${p.id}.jpg`,
    media_url: null,
    revoked_at: null,
    metadata: {},
    created_at: p.sent_at,
    ...p,
  };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const instante = (min: number) => `2026-11-20T10:${String(min).padStart(2, "0")}:00.000Z`;

function semear() {
  h.tabelas = {
    conversations: [
      { id: CONV_A, organization_id: ORG_A, contact_id: CONTATO_A },
      { id: CONV_B, organization_id: ORG_B, contact_id: CONTATO_B },
    ],
    contacts: [
      { id: CONTATO_A, organization_id: ORG_A, is_personal: false },
      { id: CONTATO_B, organization_id: ORG_B, is_personal: false },
    ],
    messages: [
      mensagem({ id: uuid(1), sent_at: instante(1) }),
      mensagem({ id: uuid(2), sent_at: instante(2), type: "video", media_mime: "video/mp4" }),
      mensagem({
        id: uuid(3),
        sent_at: instante(3),
        type: "document",
        media_mime: "application/pdf",
        metadata: { media_filename: "contrato.pdf" },
      }),
      mensagem({ id: uuid(4), sent_at: instante(4), type: "audio", media_mime: "audio/ogg" }),
      mensagem({ id: uuid(5), sent_at: instante(5), type: "text", media_storage_path: null, media_mime: null }),
      // Ainda não persistida (só no canal): o balão mostra, a galeria também.
      mensagem({ id: uuid(6), sent_at: instante(6), media_storage_path: null, media_url: "https://canal/x" }),
      // Retenção apagou o arquivo: nada para abrir.
      mensagem({ id: uuid(7), sent_at: instante(7), media_storage_path: null, media_url: null }),
      // Apagada pelo autor e oculta no CRM: o balão não oferece, a galeria não lista.
      mensagem({ id: uuid(8), sent_at: instante(8), revoked_at: instante(9) }),
      mensagem({ id: uuid(9), sent_at: instante(9), metadata: { crm_hidden_at: instante(9) } }),
      mensagem({ id: uuid(10), sent_at: instante(10) }),
      // OUTRA organização, mesma forma de linha.
      mensagem({
        id: uuid(11),
        sent_at: instante(11),
        organization_id: ORG_B,
        conversation_id: CONV_B,
        media_storage_path: `${ORG_B}/${CONV_B}/x.jpg`,
      }),
    ],
  };
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string, qs = "") => new NextRequest(`http://localhost/api/v1/conversations/${id}/media${qs}`);

interface Resposta {
  data: Array<{ id: string; type: string; nome: string | null }>;
  meta: { cursor: string | null; has_more: boolean };
}

async function pedir(id: string, qs = "") {
  const { GET } = await import("./route");
  const res = await GET(req(id, qs), ctx(id));
  return { res, corpo: (await res.json()) as Resposta & { error?: { code: string } } };
}

beforeEach(() => {
  h.autorizado = true;
  h.orgAtiva = ORG_A;
  h.consultas = [];
  semear();
});

describe("GET /conversations/[id]/media — quem pode ler", () => {
  it("sem sessão: a resposta do requireRole volta, e nada é consultado", async () => {
    h.autorizado = false;
    const { res } = await pedir(CONV_A);
    expect(res.status).toBe(401);
    expect(h.consultas).toHaveLength(0);
  });

  it("conversa de OUTRA organização é 404 e as mensagens dela não são lidas", async () => {
    const { res, corpo } = await pedir(CONV_B);
    expect(res.status).toBe(404);
    expect(corpo.error?.code).toBe("not_found");
    expect(h.consultas.some((c) => c.tabela === "messages")).toBe(false);
  });

  it("a org ativa vê só as mensagens dela, mesmo com a conversa da outra no banco", async () => {
    h.orgAtiva = ORG_B;
    const { res, corpo } = await pedir(CONV_B);
    expect(res.status).toBe(200);
    expect(corpo.data.map((m) => m.id)).toEqual([uuid(11)]);
  });

  it("conversa de contato PESSOAL dá o mesmo 404 do histórico", async () => {
    h.tabelas.contacts![0]!.is_personal = true;
    const { res } = await pedir(CONV_A);
    expect(res.status).toBe(404);
    expect(h.consultas.some((c) => c.tabela === "messages")).toBe(false);
  });

  it("id que não é uuid é 404 sem consulta", async () => {
    const { res } = await pedir("nao-e-uuid");
    expect(res.status).toBe(404);
    expect(h.consultas).toHaveLength(0);
  });
});

describe("GET /conversations/[id]/media — o que entra", () => {
  it("sem filtro: só mídia com arquivo, mais nova primeiro, sem apagada nem oculta", async () => {
    const { res, corpo } = await pedir(CONV_A);
    expect(res.status).toBe(200);
    expect(corpo.data.map((m) => m.id)).toEqual([uuid(10), uuid(6), uuid(4), uuid(3), uuid(2), uuid(1)]);
  });

  it.each([
    ["imagem", ["image"], [uuid(10), uuid(6), uuid(1)]],
    ["video", ["video"], [uuid(2)]],
    ["documento", ["document"], [uuid(3)]],
    ["audio", ["audio"], [uuid(4)]],
  ])("?tipo=%s filtra pelo tipo da mensagem", async (tipo, tipos, esperado) => {
    const { corpo } = await pedir(CONV_A, `?tipo=${tipo}`);
    expect(corpo.data.map((m) => m.id)).toEqual(esperado);
    expect(h.consultas.find((c) => c.tabela === "messages")?.ins).toContainEqual(["type", tipos]);
  });

  it("devolve o id e o nome original — nunca URL assinada", async () => {
    const { corpo } = await pedir(CONV_A, "?tipo=documento");
    expect(corpo.data[0]).toMatchObject({ id: uuid(3), type: "document", nome: "contrato.pdf" });
    expect(JSON.stringify(corpo)).not.toMatch(/https?:\/\//);
  });

  it("tipo desconhecido é 422", async () => {
    const { res } = await pedir(CONV_A, "?tipo=figurinha");
    expect(res.status).toBe(422);
  });
});

describe("GET /conversations/[id]/media — paginação por cursor", () => {
  it("as páginas andam para o passado sem repetir nem pular", async () => {
    const p1 = await pedir(CONV_A, "?tipo=imagem&limit=2");
    expect(p1.corpo.data.map((m) => m.id)).toEqual([uuid(10), uuid(6)]);
    expect(p1.corpo.meta.has_more).toBe(true);
    expect(p1.corpo.meta.cursor).toBeTruthy();

    const p2 = await pedir(CONV_A, `?tipo=imagem&limit=2&cursor=${p1.corpo.meta.cursor}`);
    expect(p2.corpo.data.map((m) => m.id)).toEqual([uuid(1)]);
    expect(p2.corpo.meta).toEqual({ cursor: null, has_more: false });
  });

  it("três fotos no mesmo segundo: o desempate pela chegada não perde nenhuma", async () => {
    h.tabelas.messages = [
      mensagem({ id: uuid(21), sent_at: instante(30), created_at: "2026-11-20T10:30:00.100Z" }),
      mensagem({ id: uuid(22), sent_at: instante(30), created_at: "2026-11-20T10:30:00.200Z" }),
      mensagem({ id: uuid(23), sent_at: instante(30), created_at: "2026-11-20T10:30:00.300Z" }),
    ];
    const p1 = await pedir(CONV_A, "?limit=1");
    const p2 = await pedir(CONV_A, `?limit=1&cursor=${p1.corpo.meta.cursor}`);
    const p3 = await pedir(CONV_A, `?limit=1&cursor=${p2.corpo.meta.cursor}`);
    expect([...p1.corpo.data, ...p2.corpo.data, ...p3.corpo.data].map((m) => m.id)).toEqual([
      uuid(23),
      uuid(22),
      uuid(21),
    ]);
    expect(p3.corpo.meta.has_more).toBe(false);
  });

  it("cursor forjado (fora do formato que o servidor emite) é 400 sem consulta", async () => {
    const forjado = Buffer.from(
      JSON.stringify({ sent_at: "x),id.gt.(0", created_at: instante(1), id: uuid(1) }),
    ).toString("base64url");
    const { res, corpo } = await pedir(CONV_A, `?cursor=${forjado}`);
    expect(res.status).toBe(400);
    expect(corpo.error?.code).toBe("invalid_cursor");
    expect(h.consultas).toHaveLength(0);
  });
});
