import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { logger } from "@/lib/logger";

import type { ConversaoOffline, CredencialDeConversao } from "../types";
import { clientIdDerivado, clientIdDoCookie, semSegredo, transporteGa4 } from "./conversions";

const SEGREDO = "s3gr3d0-da-api+/=";

const credencial: CredencialDeConversao = {
  datasetId: "G-ABC1234",
  accessToken: SEGREDO,
  testEventCode: null,
  mapeamento: { Purchase: "purchase", LeadSubmitted: "generate_lead", QualifiedLead: null },
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
    valorCentavos: 12_345,
    moeda: "brl",
    ...extra,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("transporte do GA4 (Measurement Protocol)", () => {
  it("manda a compra para /mp/collect com o formato do protocolo", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const r = await transporteGa4.enviar(credencial, conversao());
    expect(r).toEqual({ tipo: "ok" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.google-analytics.com/mp/collect");
    expect(u.searchParams.get("measurement_id")).toBe("G-ABC1234");
    expect(u.searchParams.get("api_secret")).toBe(SEGREDO);
    expect(init.redirect).toBe("error");

    const corpo = JSON.parse(String(init.body)) as {
      client_id: string;
      timestamp_micros: number;
      events: Array<{ name: string; params: Record<string, unknown> }>;
    };
    expect(corpo.client_id).toMatch(/^\d+\.\d+$/);
    // Microssegundos: ~1,7e15 hoje. Em ms seria três ordens abaixo.
    expect(corpo.timestamp_micros).toBeGreaterThan(1e15);
    expect(corpo.timestamp_micros % 1000).toBe(0);
    expect(corpo.events).toEqual([
      {
        name: "purchase",
        params: { transaction_id: "lead-1:Purchase", value: 123.45, currency: "BRL" },
      },
    ]);
    // Nada pessoal no fio do GA4.
    expect(String(init.body)).not.toContain("5511999999999");
  });

  it("usa o _ga capturado como client_id; sem ele, um id estável por contato", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await transporteGa4.enviar(
      credencial,
      conversao({
        identidadeDoContato: { contatoId: "c1", email: null, gaClientId: "GA1.1.111.222", ttclid: null },
      }),
    );
    await transporteGa4.enviar(
      credencial,
      conversao({
        identidadeDoContato: { contatoId: "c1", email: null, gaClientId: null, ttclid: null },
      }),
    );
    await transporteGa4.enviar(
      credencial,
      conversao({
        eventoId: "outro",
        identidadeDoContato: { contatoId: "c1", email: null, gaClientId: null, ttclid: null },
      }),
    );
    const ids = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(String((init as RequestInit).body)) as { client_id: string }).client_id,
    );
    expect(ids[0]).toBe("111.222");
    expect(ids[1]).toBe(clientIdDerivado("org-1:c1"));
    expect(ids[2]).toBe(ids[1]);
  });

  it("evento desligado nas regras não sai; mais velho que 72h vira pendência visível", async () => {
    const desligado = await transporteGa4.enviar(credencial, conversao({ evento: "QualifiedLead" }));
    expect(desligado.tipo).toBe("permanente");
    const velho = await transporteGa4.enviar(
      credencial,
      conversao({ ocorridoEm: new Date(Date.now() - 73 * 60 * 60 * 1000) }),
    );
    expect(velho).toMatchObject({ tipo: "permanente" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("compra sem valor sai SEM value — nunca com zero", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await transporteGa4.enviar(credencial, conversao({ valorCentavos: null }));
    const corpo = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as {
      events: Array<{ params: Record<string, unknown> }>;
    };
    expect(corpo.events[0]?.params).toEqual({ transaction_id: "lead-1:Purchase" });
  });

  it("5xx e 429 são transitórios; 4xx é permanente", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 503 }));
    expect((await transporteGa4.enviar(credencial, conversao())).tipo).toBe("transitorio");
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 429 }));
    expect((await transporteGa4.enviar(credencial, conversao())).tipo).toBe("transitorio");
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 400 }));
    expect((await transporteGa4.enviar(credencial, conversao())).tipo).toBe("permanente");
  });

  it("o segredo da query string nunca volta em detalhe nem em log (exceção documentada)", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error(`connect ECONNREFUSED /mp/collect?measurement_id=G-ABC1234&api_secret=${encodeURIComponent(SEGREDO)}`),
    );
    const rede = await transporteGa4.enviar(credencial, conversao());
    expect(rede.tipo).toBe("transitorio");
    expect(JSON.stringify(rede)).not.toContain(encodeURIComponent(SEGREDO));
    expect(JSON.stringify(rede)).not.toContain(SEGREDO);

    fetchMock.mockResolvedValueOnce(new Response(`bad request api_secret=${SEGREDO}`, { status: 400 }));
    const recusa = await transporteGa4.enviar(credencial, conversao());
    expect(JSON.stringify(recusa)).not.toContain(SEGREDO);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(SEGREDO);
  });

  it("Testar conexão usa o endpoint de validação e lê validationMessages", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ validationMessages: [] }));
    const ok = await transporteGa4.testarConexao!(credencial);
    expect(ok).toEqual({ tipo: "ok", detalhe: "validacao_de_formato" });
    expect(new URL(fetchMock.mock.calls[0]?.[0] as string).pathname).toBe("/debug/mp/collect");

    fetchMock.mockResolvedValueOnce(
      Response.json({
        validationMessages: [{ fieldPath: "measurement_id", description: "Measurement ID inválido" }],
      }),
    );
    const falha = await transporteGa4.testarConexao!(credencial);
    expect(falha).toMatchObject({ tipo: "permanente" });
    expect(JSON.stringify(falha)).toContain("Measurement ID inválido");
  });
});

describe("auxiliares do GA4", () => {
  it("lê o client_id do cookie _ga e recusa o que não tem o formato", () => {
    expect(clientIdDoCookie("GA1.1.123.456")).toBe("123.456");
    expect(clientIdDoCookie("123.456")).toBe("123.456");
    expect(clientIdDoCookie("lixo")).toBeNull();
    expect(clientIdDoCookie(null)).toBeNull();
  });

  it("semSegredo troca o valor cru e o codificado", () => {
    expect(semSegredo(`a api_secret=xyz&b`, "xyz")).toBe("a api_secret=***&b");
    expect(semSegredo(`token ${SEGREDO} e ${encodeURIComponent(SEGREDO)}`, SEGREDO)).toBe(
      "token *** e ***",
    );
  });
});
