import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/webhooks/secrets", () => ({
  decryptWebhookSecret: vi.fn(async (_admin: unknown, c: string) => (c === "cifrado" ? "segredo" : null)),
}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { lerCredencial } from "./credenciais";
import { identidadeDaLinha } from "./identidade-do-contato";

let linha: Record<string, unknown> | null;
let selects: string[];
let filtros: Array<[string, unknown]>;

function admin(): SupabaseClient {
  const q = {
    select: (c: string) => {
      selects.push(c);
      return q;
    },
    eq: (k: string, v: unknown) => {
      filtros.push([k, v]);
      return q;
    },
    maybeSingle: async () => ({ data: linha, error: null }),
  };
  return { from: () => q } as unknown as SupabaseClient;
}

beforeEach(() => {
  selects = [];
  filtros = [];
  linha = {
    dataset_id: "G-ABC1234",
    access_token_encrypted: "cifrado",
    test_event_code: "TEST1",
    enabled: true,
    event_mapping: { Purchase: "close_convert_lead", LeadSubmitted: null },
  };
});

describe("credencial do GA4 e do TikTok", () => {
  it("decifra o segredo, lê o mapeamento e filtra pela organização", async () => {
    const r = await lerCredencial(admin(), "org-1", "ga4");
    expect(r).toEqual({
      ok: true,
      credencial: {
        datasetId: "G-ABC1234",
        accessToken: "segredo",
        testEventCode: null,
        mapeamento: { Purchase: "close_convert_lead", LeadSubmitted: null, QualifiedLead: "qualify_lead" },
      },
    });
    expect(filtros).toContainEqual(["organization_id", "org-1"]);
    expect(filtros).toContainEqual(["platform", "ga4"]);
  });

  it("o TikTok leva o código de teste; o GA4 não", async () => {
    const r = await lerCredencial(admin(), "org-1", "tiktok");
    expect(r.ok && r.credencial.testEventCode).toBe("TEST1");
  });

  it("a Meta não pede a coluna do mapeamento (clone sem a 9488 continua lendo)", async () => {
    await lerCredencial(admin(), "org-1", "meta_ads").catch(() => null);
    expect(selects.join(" ")).not.toContain("event_mapping");
  });

  it("sem segredo é incompleta; cifra que não abre é problema de instalação", async () => {
    linha = { ...linha, access_token_encrypted: null };
    expect(await lerCredencial(admin(), "org-1", "tiktok")).toEqual({
      ok: false,
      motivo: "credencial_incompleta",
    });
    linha = { ...linha, access_token_encrypted: "outro" };
    expect(await lerCredencial(admin(), "org-1", "tiktok")).toEqual({
      ok: false,
      motivo: "cifra_indisponivel",
    });
  });
});

describe("identidade do contato", () => {
  it("lê _ga, ttclid e e-mail do que a chegada gravou", () => {
    expect(
      identidadeDaLinha("c1", {
        email: " ana@ex.com ",
        source_metadata: { _ga: "GA1.1.10.20", ttclid: "tt-1" },
      }),
    ).toEqual({ contatoId: "c1", email: "ana@ex.com", gaClientId: "10.20", ttclid: "tt-1" });
  });

  it("o clique da atribuição só vira ttclid quando a atribuição é do TikTok", () => {
    expect(
      identidadeDaLinha("c1", { source_metadata: { ad_platform: "tiktok", ad_source_id: "tt-2" } }).ttclid,
    ).toBe("tt-2");
    expect(
      identidadeDaLinha("c1", { source_metadata: { ad_platform: "meta_ads", ad_source_id: "ctwa" } }).ttclid,
    ).toBeNull();
  });
});
