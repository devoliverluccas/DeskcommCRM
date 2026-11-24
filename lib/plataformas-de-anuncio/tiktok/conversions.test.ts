import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import type { ConversaoOffline, CredencialDeConversao } from "../types";
import { hashDoEmail, hashDoTelefone, transporteTiktok } from "./conversions";

const TOKEN = "tok-tiktok-0123456789";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const credencial: CredencialDeConversao = {
  datasetId: "C4ABCDEF12345678",
  accessToken: TOKEN,
  testEventCode: null,
  mapeamento: { Purchase: "CompletePayment", LeadSubmitted: "SubmitForm", QualifiedLead: null },
};

function conversao(extra: Partial<ConversaoOffline> = {}): ConversaoOffline {
  return {
    organizationId: "org-1",
    leadId: "lead-1",
    evento: "Purchase",
    eventoId: "lead-1:Purchase",
    ocorridoEm: new Date(Date.now() - 60_000),
    cliqueDeOrigem: "",
    telefone: "5511999999999",
    valorCentavos: 5_000,
    moeda: "brl",
    ...extra,
  };
}

const fetchMock = vi.fn();
const corpoEnviado = (i = 0) =>
  JSON.parse(String((fetchMock.mock.calls[i]?.[1] as RequestInit).body)) as Record<string, unknown> & {
    data: Array<Record<string, unknown> & { user: Record<string, unknown> }>;
  };

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => Response.json({ code: 0, message: "OK" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("transporte do TikTok (Events API 1.3)", () => {
  it("token no header Access-Token, nunca na URL; corpo no formato web + pixel", async () => {
    const r = await transporteTiktok.enviar(credencial, conversao());
    expect(r).toEqual({ tipo: "ok" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://business-api.tiktok.com/open_api/v1.3/event/track/");
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)["Access-Token"]).toBe(TOKEN);

    const corpo = corpoEnviado();
    expect(corpo.event_source).toBe("web");
    expect(corpo.event_source_id).toBe("C4ABCDEF12345678");
    expect(corpo).not.toHaveProperty("test_event_code");
    const evento = corpo.data[0]!;
    expect(evento.event).toBe("CompletePayment");
    expect(evento.event_id).toBe("lead-1:Purchase");
    // Segundos (~1,7e9), não milissegundos.
    expect(evento.event_time).toBeGreaterThan(1e9);
    expect(evento.event_time).toBeLessThan(1e11);
    expect(evento.properties).toEqual({ value: 50, currency: "BRL" });
    // Telefone em E.164 COM o "+" antes do hash — diferente da Meta.
    expect(evento.user.phone).toBe(sha("+5511999999999"));
    expect(evento.user.external_id).toBe(sha("lead-1"));
    expect(JSON.stringify(corpo)).not.toContain("5511999999999");
  });

  it("ttclid: o da identidade do contato quando há; senão o clique da atribuição", async () => {
    await transporteTiktok.enviar(
      credencial,
      conversao({
        cliqueDeOrigem: "clique-da-atribuicao",
        identidadeDoContato: { contatoId: "c1", email: " Ana@Ex.com ", gaClientId: null, ttclid: "tt-1" },
      }),
    );
    await transporteTiktok.enviar(credencial, conversao({ cliqueDeOrigem: "tt-da-atribuicao" }));
    // Com identidade e sem ttclid nela, o clique de OUTRA plataforma não vira ttclid.
    await transporteTiktok.enviar(
      credencial,
      conversao({
        cliqueDeOrigem: "ctwa-da-meta",
        identidadeDoContato: { contatoId: "c1", email: null, gaClientId: null, ttclid: null },
      }),
    );
    expect(corpoEnviado(0).data[0]!.user).toMatchObject({
      ttclid: "tt-1",
      email: sha("ana@ex.com"),
      external_id: sha("c1"),
    });
    expect(corpoEnviado(1).data[0]!.user.ttclid).toBe("tt-da-atribuicao");
    expect(corpoEnviado(2).data[0]!.user).not.toHaveProperty("ttclid");
  });

  it("sem ttclid, telefone nem e-mail não sai — recusa visível", async () => {
    const r = await transporteTiktok.enviar(credencial, conversao({ telefone: null }));
    expect(r.tipo).toBe("permanente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("evento desligado e evento velho (>7 dias) não saem", async () => {
    expect((await transporteTiktok.enviar(credencial, conversao({ evento: "QualifiedLead" }))).tipo).toBe(
      "permanente",
    );
    expect(
      (
        await transporteTiktok.enviar(
          credencial,
          conversao({ ocorridoEm: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }),
        )
      ).tipo,
    ).toBe("permanente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o veredito é o `code` do corpo, mesmo com HTTP 200", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 40105, message: "Access token invalid" }));
    expect(await transporteTiktok.enviar(credencial, conversao())).toEqual({
      tipo: "permanente",
      detalhe: "40105: Access token invalid",
    });
    fetchMock.mockResolvedValueOnce(Response.json({ code: 40100, message: "Too many requests" }));
    expect((await transporteTiktok.enviar(credencial, conversao())).tipo).toBe("transitorio");
    fetchMock.mockResolvedValueOnce(new Response("gateway", { status: 502 }));
    expect((await transporteTiktok.enviar(credencial, conversao())).tipo).toBe("transitorio");
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await transporteTiktok.enviar(credencial, conversao())).tipo).toBe("transitorio");
  });

  it("código de teste da organização vai no corpo", async () => {
    await transporteTiktok.enviar({ ...credencial, testEventCode: "TEST999" }, conversao());
    expect(corpoEnviado().test_event_code).toBe("TEST999");
  });

  it("Testar conexão manda um evento SEMPRE marcado como teste", async () => {
    const r = await transporteTiktok.testarConexao!(credencial);
    expect(r).toEqual({ tipo: "ok" });
    const corpo = corpoEnviado();
    expect(typeof corpo.test_event_code).toBe("string");
    expect(String(corpo.test_event_code).length).toBeGreaterThan(0);
    expect(corpo.event_source_id).toBe("C4ABCDEF12345678");
  });
});

describe("normalização antes do hash", () => {
  it("e-mail em minúsculas sem espaço; telefone com +", () => {
    expect(hashDoEmail("  A@B.COM ")).toBe(sha("a@b.com"));
    expect(hashDoTelefone("55 (11) 99999-9999")).toBe(sha("+5511999999999"));
  });
});
