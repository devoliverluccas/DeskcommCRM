import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: vi.fn(async () => "cifrado"),
  decryptWebhookSecret: vi.fn(async () => "segredo-em-claro"),
}));

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { GET, PUT } from "./route";
import { POST as TESTAR } from "./testar/route";
import { PUT as PUT_TIKTOK } from "../tiktok/route";

const ORG = "11111111-1111-4111-8111-111111111111";

let linha: Record<string, unknown> | null;
let upserts: Array<{ valores: Record<string, unknown>; opcoes: unknown }>;
let filtros: Array<[string, unknown]>;

function fakeAdmin() {
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => {
      filtros.push([k, v]);
      return q;
    },
    maybeSingle: async () => ({ data: linha, error: null }),
    upsert: async (valores: Record<string, unknown>, opcoes: unknown) => {
      upserts.push({ valores, opcoes });
      return { error: null };
    },
  };
  return { from: () => q };
}

const put = (corpo: unknown, fn = PUT) =>
  fn(
    new NextRequest("http://localhost/api/v1/plataformas-de-anuncio/ga4", {
      method: "PUT",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
  );

const EVENTOS = { Purchase: "purchase", LeadSubmitted: "generate_lead", QualifiedLead: null };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  linha = null;
  upserts = [];
  filtros = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" },
    org: { orgId: ORG, role: "admin" },
  } as Awaited<ReturnType<typeof requireRole>>);
  vi.mocked(createAdminClient).mockReturnValue(
    fakeAdmin() as unknown as ReturnType<typeof createAdminClient>,
  );
});

describe("GET /api/v1/plataformas-de-anuncio/ga4", () => {
  it("pede admin e devolve o estado SEM o segredo", async () => {
    linha = {
      dataset_id: "G-ABC1234",
      access_token_encrypted: "cifrado",
      enabled: true,
      test_event_code: null,
      event_mapping: {},
    };
    const r = await GET();
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("admin");
    const corpo = (await r.json()) as { data: Record<string, unknown> };
    expect(corpo.data).toMatchObject({ conectada: true, identificador: "G-ABC1234", temSegredo: true });
    expect(JSON.stringify(corpo)).not.toContain("cifrado");
    expect(filtros).toContainEqual(["organization_id", ORG]);
  });
});

describe("PUT /api/v1/plataformas-de-anuncio/ga4", () => {
  it("guarda de suporte antes de tudo", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(new Response(null, { status: 403 }));
    const r = await put({ identificador: "G-ABC1234", segredo: "12345678", enabled: true, eventos: EVENTOS });
    expect(r.status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it("cifra o segredo, grava mapeamento e organização da sessão, e audita sem o segredo", async () => {
    const r = await put({
      identificador: "g-abc1234",
      segredo: "segredo-novo-123",
      enabled: true,
      eventos: EVENTOS,
      // organization_id no corpo é rejeitado (strict), nunca usado.
    });
    expect(r.status).toBe(200);
    expect(vi.mocked(encryptWebhookSecret)).toHaveBeenCalledWith(expect.anything(), "segredo-novo-123");
    expect(upserts[0]).toEqual({
      valores: expect.objectContaining({
        organization_id: ORG,
        platform: "ga4",
        dataset_id: "G-ABC1234",
        access_token_encrypted: "cifrado",
        enabled: true,
        event_mapping: EVENTOS,
        test_event_code: null,
      }),
      opcoes: { onConflict: "organization_id,platform" },
    });
    const chamada = vi.mocked(audit).mock.calls[0]?.[0];
    expect(chamada).toMatchObject({ action: "ad_platform_connection.updated", organizationId: ORG });
    expect(JSON.stringify(chamada)).not.toContain("segredo-novo-123");
  });

  it("recusa organization_id no corpo, measurement id torto e evento fora da lista", async () => {
    const base = { identificador: "G-ABC1234", segredo: "12345678", enabled: true, eventos: EVENTOS };
    expect((await put({ ...base, organization_id: "outra" })).status).toBe(422);
    expect((await put({ ...base, identificador: "UA-123" })).status).toBe(422);
    expect((await put({ ...base, eventos: { ...EVENTOS, Purchase: "CompletePayment" } })).status).toBe(422);
    expect(upserts).toHaveLength(0);
  });

  it("primeira gravação sem segredo é recusada; depois, vazio mantém o gravado", async () => {
    const base = { identificador: "G-ABC1234", enabled: false, eventos: EVENTOS };
    expect((await put(base)).status).toBe(422);
    linha = { dataset_id: "G-ABC1234", access_token_encrypted: "cifrado", enabled: true, event_mapping: {} };
    expect((await put(base)).status).toBe(200);
    expect(upserts[0]?.valores).not.toHaveProperty("access_token_encrypted");
  });

  it("o TikTok aceita o código de teste e o pixel", async () => {
    const r = await put(
      {
        identificador: "C4ABCDEF12345678",
        segredo: "token-do-tiktok",
        test_event_code: "TEST1",
        enabled: true,
        eventos: { Purchase: "CompletePayment", LeadSubmitted: "SubmitForm", QualifiedLead: null },
      },
      PUT_TIKTOK,
    );
    expect(r.status).toBe(200);
    expect(upserts[0]?.valores).toMatchObject({ platform: "tiktok", test_event_code: "TEST1" });
  });
});

describe("POST /api/v1/plataformas-de-anuncio/ga4/testar", () => {
  it("usa o endpoint de validação com a credencial decifrada e audita o teste", async () => {
    linha = { dataset_id: "G-ABC1234", access_token_encrypted: "cifrado", test_event_code: null };
    fetchMock.mockResolvedValue(Response.json({ validationMessages: [] }));
    const r = await TESTAR();
    const corpo = (await r.json()) as { data: { passou: boolean; apenasFormato: boolean } };
    expect(corpo.data).toEqual({ passou: true, apenasFormato: true, detalhe: null });
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/debug/mp/collect");
    expect(url.searchParams.get("api_secret")).toBe("segredo-em-claro");
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({ action: "ad_platform_connection.tested" });
    // O segredo não volta para a tela.
    expect(JSON.stringify(corpo)).not.toContain("segredo-em-claro");
  });

  it("sem credencial gravada não fala com a rede", async () => {
    linha = null;
    const r = await TESTAR();
    expect(r.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
