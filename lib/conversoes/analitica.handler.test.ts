/**
 * GA4 e TikTok recebem a venda e o lead novo — à parte do envio principal.
 *
 * Cada bloco vigia um modo de falha concreto: a venda que não chega ao GA4
 * porque o contato veio da Meta, o TikTok que recebe venda de quem nunca clicou
 * no anúncio dele, a mesma venda enviada duas vezes, a falha de uma plataforma
 * derrubando a outra, e a linha de análise colidindo com a do envio principal
 * no índice único do livro-razão. Nenhuma chamada de rede real: o `fetch` é
 * dublado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { chaveAnalitica, lerChaveAnalitica } from "./analitica";
import { conversaoAnaliticaHandler, identidadeParaAnalise } from "./analitica.handler";
import { rotuloDoEvento } from "./historico";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const ORG = "11111111-1111-1111-1111-111111111111";
const LEAD = "22222222-2222-2222-2222-222222222222";
const CONTATO = "33333333-3333-3333-3333-333333333333";

interface Cenario {
  lead?: Record<string, unknown> | null;
  contato?: Record<string, unknown> | null;
  conexoes?: Partial<Record<"ga4" | "tiktok", Record<string, unknown>>>;
  /** Linhas já no livro-razão, por `event_name`. */
  livro?: Record<string, Record<string, unknown>>;
}

const upserts: Record<string, unknown>[] = [];

function fakeAdmin(c: Cenario) {
  return {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filtros[col] = v;
          return q;
        },
        maybeSingle: async () => {
          if (tabela === "crm_leads") return { data: c.lead ?? null, error: null };
          if (tabela === "contacts") return { data: c.contato ?? null, error: null };
          if (tabela === "ad_platform_connections") {
            const p = filtros.platform as "ga4" | "tiktok";
            return { data: c.conexoes?.[p] ?? null, error: null };
          }
          if (tabela === "ad_conversion_dispatches") {
            return { data: c.livro?.[filtros.event_name as string] ?? null, error: null };
          }
          return { data: null, error: null };
        },
        upsert: async (valores: Record<string, unknown>, opts: { onConflict: string }) => {
          expect(opts.onConflict).toBe("organization_id,lead_id,event_name");
          upserts.push(valores);
          return { error: null };
        },
      };
      return q;
    },
    rpc: async () => ({ data: "segredo-decifrado", error: null }),
  };
}

const leadGanho = {
  id: LEAD,
  status: "won",
  value_cents: 350_00,
  currency: "BRL",
  closed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  contact_id: CONTATO,
  source_metadata: {},
};

const conexaoGa4 = {
  dataset_id: "G-ABC1234",
  access_token_encrypted: "\\xdead",
  test_event_code: null,
  enabled: true,
  event_mapping: {},
};
const conexaoTiktok = {
  dataset_id: "C4ABCDEF12345678",
  access_token_encrypted: "\\xbeef",
  test_event_code: null,
  enabled: true,
  event_mapping: {},
};

function evento(tipo: string): EventRow {
  return {
    id: "evt",
    organization_id: ORG,
    event_type: tipo,
    entity_kind: "crm_lead",
    entity_id: LEAD,
    payload: {},
    metadata: {},
    consumed_by: [],
    attempts: 0,
    created_at: new Date().toISOString(),
  };
}

function cenario(c: Cenario) {
  vi.mocked(createAdminClient).mockReturnValue(fakeAdmin(c) as never);
}

type Chamada = { url: string; corpo: Record<string, unknown> };
function dublarFetch(responder: (url: string) => Response = () => new Response(null, { status: 204 })) {
  const chamadas: Chamada[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    chamadas.push({ url: u, corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return responder(u);
  });
  return chamadas;
}

const respostaTiktokOk = () => new Response('{"code":0,"message":"OK"}', { status: 200 });
const ehGa4 = (u: string) => u.includes("google-analytics.com");

beforeEach(() => {
  upserts.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a chave no livro-razão", () => {
  it("é uma por plataforma e nunca colide com o evento do envio principal", () => {
    // O índice único é (organização, negócio, event_name) — sem a plataforma.
    // `Purchase` puro é da Meta/Google; a análise grava a SUA chave.
    expect(chaveAnalitica("ga4", "Purchase")).toBe("ga4:Purchase");
    expect(chaveAnalitica("tiktok", "LeadSubmitted")).toBe("tiktok:LeadSubmitted");
    expect(chaveAnalitica("ga4", "Purchase")).not.toBe("Purchase");
    expect(lerChaveAnalitica("tiktok:Purchase")).toEqual({ plataforma: "tiktok", evento: "Purchase" });
    expect(lerChaveAnalitica("Purchase")).toBeNull();
    expect(lerChaveAnalitica("MetaEtapa:abc")).toBeNull();
  });

  it("a tela nomeia a linha de análise pelo acontecimento", () => {
    expect(rotuloDoEvento("ga4:Purchase", [])).toBe("Compra");
    expect(rotuloDoEvento("tiktok:LeadSubmitted", [])).toBe("Lead novo");
  });
});

describe("GA4 recebe toda venda", () => {
  it("contato da Meta: a venda vai ao GA4 com o client_id do _ga capturado", async () => {
    cenario({
      lead: leadGanho,
      contato: {
        email: null,
        phone_number: "5511988887777",
        source_metadata: { ad_platform: "meta_ads", ad_source_id: "CLIQUE", _ga: "GA1.1.111.222" },
      },
      conexoes: { ga4: conexaoGa4 },
    });
    const chamadas = dublarFetch();

    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));

    expect(r).toMatchObject({ consumer_key: "conversoes.analitica", status: "ok" });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.url).toContain("/mp/collect");
    expect(chamadas[0]!.corpo.client_id).toBe("111.222");
    expect((chamadas[0]!.corpo.events as Array<{ name: string; params: Record<string, unknown> }>)[0])
      .toMatchObject({ name: "purchase", params: { value: 350, currency: "BRL", transaction_id: `${LEAD}:Purchase` } });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      organization_id: ORG,
      lead_id: LEAD,
      platform: "ga4",
      event_name: "ga4:Purchase",
      status: "sent",
      event_id: `${LEAD}:Purchase`,
    });
  });

  it("contato orgânico sem _ga: vai mesmo assim, com o id estável do contato", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: null, phone_number: null, source_metadata: {} },
      conexoes: { ga4: conexaoGa4 },
    });
    const chamadas = dublarFetch();
    await conversaoAnaliticaHandler.handle(evento("lead.stage_changed"));
    const primeiro = chamadas[0]!.corpo.client_id;
    expect(primeiro).toMatch(/^\d+\.\d+$/);

    // Mesmo contato → mesmo client_id (outra venda, mesmo usuário no GA4).
    const segundas = dublarFetch();
    await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(segundas[0]!.corpo.client_id).toBe(primeiro);
  });

  it("lead novo vai como generate_lead, na chave ga4:LeadSubmitted, sem valor", async () => {
    cenario({
      lead: { ...leadGanho, status: "open" },
      contato: { email: null, phone_number: null, source_metadata: {} },
      conexoes: { ga4: conexaoGa4 },
    });
    const chamadas = dublarFetch();
    const r = await conversaoAnaliticaHandler.handle(evento("lead.created"));
    expect(r.status).toBe("ok");
    const ev = (chamadas[0]!.corpo.events as Array<{ name: string; params: Record<string, unknown> }>)[0]!;
    expect(ev.name).toBe("generate_lead");
    expect(ev.params.value).toBeUndefined();
    expect(upserts[0]).toMatchObject({ event_name: "ga4:LeadSubmitted", platform: "ga4", status: "sent" });
  });

  it("mudança de etapa que não é ganho não envia nem grava", async () => {
    cenario({ lead: { ...leadGanho, status: "open" }, conexoes: { ga4: conexaoGa4 } });
    const chamadas = dublarFetch();
    const r = await conversaoAnaliticaHandler.handle(evento("lead.stage_changed"));
    expect(r).toMatchObject({ status: "skipped", detail: "nao_e_ganho" });
    expect(chamadas).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("sem conexão nenhuma: sai sem chamada e sem linha no livro-razão", async () => {
    cenario({ lead: leadGanho, contato: { email: null, phone_number: null, source_metadata: { ttclid: "T" } } });
    const chamadas = dublarFetch();
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.status).toBe("skipped");
    expect(chamadas).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("conexão pausada vira pendência visível, sem chamada", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: null, phone_number: null, source_metadata: {} },
      conexoes: { ga4: { ...conexaoGa4, enabled: false } },
    });
    const chamadas = dublarFetch();
    await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(chamadas).toHaveLength(0);
    expect(upserts[0]).toMatchObject({ event_name: "ga4:Purchase", status: "skipped", reason: "conexao_desabilitada" });
  });

  it("\"Não enviar\" no mapeamento pula sem chamada e sem linha", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: null, phone_number: null, source_metadata: {} },
      conexoes: { ga4: { ...conexaoGa4, event_mapping: { Purchase: null } } },
    });
    const chamadas = dublarFetch();
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.detail).toContain("evento_desligado");
    expect(chamadas).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("já enviada: repetir o evento não envia de novo", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: null, phone_number: null, source_metadata: {} },
      conexoes: { ga4: conexaoGa4 },
      livro: { "ga4:Purchase": { status: "sent", platform: "ga4" } },
    });
    const chamadas = dublarFetch();
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.detail).toContain("ja_enviada");
    expect(chamadas).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("a linha da Meta como `Purchase` enviada NÃO conta como enviada para o GA4", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: null, phone_number: null, source_metadata: {} },
      conexoes: { ga4: conexaoGa4 },
      livro: { Purchase: { status: "sent", platform: "meta_ads" } },
    });
    const chamadas = dublarFetch();
    await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(chamadas).toHaveLength(1);
  });
});

describe("TikTok recebe quem tem ttclid", () => {
  it("contato com ttclid e atribuição principal da Meta: o TikTok recebe a venda com o clique", async () => {
    cenario({
      lead: leadGanho,
      contato: {
        email: "Ana@Exemplo.com",
        phone_number: "5511988887777",
        source_metadata: { ad_platform: "meta_ads", ad_source_id: "CLIQUE", ttclid: "TT_CLIQUE" },
      },
      conexoes: { tiktok: conexaoTiktok },
    });
    const chamadas = dublarFetch(respostaTiktokOk);
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.status).toBe("ok");
    expect(chamadas).toHaveLength(1);
    const dado = (chamadas[0]!.corpo.data as Array<Record<string, unknown>>)[0]!;
    expect(dado.event).toBe("CompletePayment");
    expect((dado.user as Record<string, unknown>).ttclid).toBe("TT_CLIQUE");
    expect(upserts[0]).toMatchObject({ platform: "tiktok", event_name: "tiktok:Purchase", status: "sent" });
  });

  it("sem ttclid: o TikTok não recebe nada (nem linha), mesmo ligado", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: "a@b.com", phone_number: "5511988887777", source_metadata: {} },
      conexoes: { tiktok: conexaoTiktok },
    });
    const chamadas = dublarFetch(respostaTiktokOk);
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.detail).toContain("tiktok: sem_ttclid");
    expect(chamadas).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("o ttclid que veio no card (contato que já existia) também vale", async () => {
    cenario({
      lead: { ...leadGanho, source_metadata: { ttclid: "TT_DO_CARD", webhook_source_id: "x" } },
      contato: { email: null, phone_number: "5511988887777", source_metadata: {} },
      conexoes: { tiktok: conexaoTiktok },
    });
    const chamadas = dublarFetch(respostaTiktokOk);
    await conversaoAnaliticaHandler.handle(evento("lead.created"));
    const dado = (chamadas[0]!.corpo.data as Array<Record<string, unknown>>)[0]!;
    expect(dado.event).toBe("SubmitForm");
    expect((dado.user as Record<string, unknown>).ttclid).toBe("TT_DO_CARD");
    expect(upserts[0]).toMatchObject({ event_name: "tiktok:LeadSubmitted" });
  });

  it("atribuição principal JÁ do TikTok: o envio principal cobre, a análise não duplica", async () => {
    cenario({
      lead: leadGanho,
      contato: { email: null, phone_number: null, source_metadata: { ad_platform: "tiktok", ad_source_id: "TT" } },
      conexoes: { tiktok: conexaoTiktok },
    });
    const chamadas = dublarFetch(respostaTiktokOk);
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.detail).toContain("coberto_pelo_envio_principal");
    expect(chamadas).toHaveLength(0);
  });
});

describe("a física da falha, por plataforma", () => {
  const contatoDasDuas = {
    email: null,
    phone_number: "5511988887777",
    source_metadata: { ttclid: "TT_CLIQUE" },
  };

  it("GA4 fora do ar (5xx) reagenda; o TikTok, independente, é entregue", async () => {
    cenario({ lead: leadGanho, contato: contatoDasDuas, conexoes: { ga4: conexaoGa4, tiktok: conexaoTiktok } });
    dublarFetch((u) => (ehGa4(u) ? new Response("down", { status: 503 }) : respostaTiktokOk()));
    const antes = Date.now();
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.status).toBe("retry");
    expect(new Date(r.retry_at!).getTime()).toBeGreaterThan(antes);
    const ga4 = upserts.find((u) => u.platform === "ga4");
    const tiktok = upserts.find((u) => u.platform === "tiktok");
    expect(ga4).toMatchObject({ status: "skipped", reason: "nova_tentativa_agendada" });
    expect(tiktok).toMatchObject({ status: "sent" });
  });

  it("na retentativa, só a que falhou sai de novo", async () => {
    cenario({
      lead: leadGanho,
      contato: contatoDasDuas,
      conexoes: { ga4: conexaoGa4, tiktok: conexaoTiktok },
      livro: { "tiktok:Purchase": { status: "sent", platform: "tiktok" } },
    });
    const chamadas = dublarFetch((u) => (ehGa4(u) ? new Response(null, { status: 204 }) : respostaTiktokOk()));
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.status).toBe("ok");
    expect(chamadas.map((c) => ehGa4(c.url))).toEqual([true]);
  });

  it("recusa permanente do TikTok vira erro visível, sem retentativa", async () => {
    cenario({ lead: leadGanho, contato: contatoDasDuas, conexoes: { tiktok: conexaoTiktok } });
    dublarFetch(() => new Response('{"code":40105,"message":"token inválido"}', { status: 200 }));
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.status).toBe("skipped");
    expect(upserts[0]).toMatchObject({
      platform: "tiktok",
      status: "error",
      reason: "recusado_pela_plataforma",
    });
  });

  it("limite do TikTok (40100) é transitório e reagenda", async () => {
    cenario({ lead: leadGanho, contato: contatoDasDuas, conexoes: { tiktok: conexaoTiktok } });
    dublarFetch(() => new Response('{"code":40100,"message":"rate"}', { status: 200 }));
    const r = await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(r.status).toBe("retry");
    expect(upserts[0]).toMatchObject({ reason: "nova_tentativa_agendada" });
  });

  it("TikTok em modo de teste: aceito, mas registrado como teste — não como enviado", async () => {
    cenario({
      lead: leadGanho,
      contato: contatoDasDuas,
      conexoes: { tiktok: { ...conexaoTiktok, test_event_code: "TEST123" } },
    });
    dublarFetch(respostaTiktokOk);
    await conversaoAnaliticaHandler.handle(evento("lead.won"));
    expect(upserts[0]).toMatchObject({ status: "skipped", reason: "evento_de_teste" });
  });
});

describe("o consumidor", () => {
  it("escuta as duas portas do fechamento e o lead novo, e pula na organização parada", () => {
    expect(conversaoAnaliticaHandler.key).toBe("conversoes.analitica");
    expect(conversaoAnaliticaHandler.events).toEqual(
      expect.arrayContaining(["lead.won", "lead.stage_changed", "lead.created"]),
    );
    expect(conversaoAnaliticaHandler.naOrgParada).toBe("pula");
  });

  it("identidade: o contato vence; o card completa o que falta", () => {
    const id = identidadeParaAnalise(
      { id: LEAD, contact_id: CONTATO, source_metadata: { ttclid: "DO_CARD", ga_client_id: "9.9" } },
      { email: "x@y.com", phone_number: null, source_metadata: { ttclid: "DO_CONTATO" } },
    );
    expect(id).toEqual({ contatoId: CONTATO, email: "x@y.com", gaClientId: "9.9", ttclid: "DO_CONTATO" });
  });
});
