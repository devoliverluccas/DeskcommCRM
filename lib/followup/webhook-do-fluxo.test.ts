import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  CABECALHOS_DO_WEBHOOK_DO_FLUXO,
  assinarWebhookDoFluxo,
  chamarWebhookDoFluxo,
  idDaEntregaDoFluxo,
  segredoDoWebhookDoFluxo,
  type ContextoDoWebhookDoFluxo,
} from "./webhook-do-fluxo";

const contexto: ContextoDoWebhookDoFluxo = {
  organization_id: "org-1",
  flow: { pointer_id: "ptr", version_id: "ver", node_id: "w", enrollment_id: "enr" },
  contact: { id: "ct", name: "Lia", phone: "+5511999990000", email: null, tags: [] },
  conversation: { id: "conv" },
  lead: null,
};
const agora = () => new Date("2026-11-24T12:00:00.000Z");

describe("segredo do fluxo", () => {
  it("é derivado e estável por organização + fluxo, e muda entre fluxos", () => {
    const a = segredoDoWebhookDoFluxo("org", "f1", "raiz");
    expect(segredoDoWebhookDoFluxo("org", "f1", "raiz")).toBe(a);
    expect(segredoDoWebhookDoFluxo("org", "f2", "raiz")).not.toBe(a);
    expect(segredoDoWebhookDoFluxo("org2", "f1", "raiz")).not.toBe(a);
  });

  it("sem a chave da instalação, não há segredo (e o webhook não sai)", () => {
    expect(() => segredoDoWebhookDoFluxo("org", "f1", "")).toThrow(/segredo_do_fluxo_indisponivel/);
  });

  it("o id da entrega é estável por passo — o replay repete o id", () => {
    expect(idDaEntregaDoFluxo("enr", "w", 3)).toBe(idDaEntregaDoFluxo("enr", "w", 3));
    expect(idDaEntregaDoFluxo("enr", "w", 4)).not.toBe(idDaEntregaDoFluxo("enr", "w", 3));
  });
});

describe("chamarWebhookDoFluxo", () => {
  it("2xx: ok, com corpo assinado em HMAC SHA-256 que o receptor confere", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, _init: unknown) => ({ status: 204 }) as Response);
    const r = await chamarWebhookDoFluxo({
      url: "https://receptor.test/hook",
      segredo: "s3gredo",
      entrega: "d-1",
      contexto,
      agora,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pularCercaDeRede: true,
    });
    expect(r).toEqual({ resultado: "ok", status: 204 });
    const init = fetchImpl.mock.calls[0]![1] as { headers: Record<string, string>; body: string; redirect: string };
    expect(init.redirect).toBe("manual");
    const ts = init.headers[CABECALHOS_DO_WEBHOOK_DO_FLUXO.carimbo]!;
    const esperado = createHmac("sha256", "s3gredo").update(`${ts}.d-1.${init.body}`).digest("hex");
    expect(init.headers[CABECALHOS_DO_WEBHOOK_DO_FLUXO.assinatura]).toBe(`t=${ts},v1=${esperado}`);
    expect(assinarWebhookDoFluxo("s3gredo", Number(ts), "d-1", init.body)).toBe(`t=${ts},v1=${esperado}`);
    expect(JSON.parse(init.body).data.contact.name).toBe("Lia");
  });

  it("status não-2xx, rede caída e prazo estourado viram erro — nunca lança", async () => {
    const base = { url: "https://r.test", segredo: "s", entrega: "d", contexto, agora, pularCercaDeRede: true };
    expect(
      await chamarWebhookDoFluxo({ ...base, fetchImpl: (async () => ({ status: 500 })) as unknown as typeof fetch }),
    ).toEqual({ resultado: "erro", motivo: "http_500" });
    expect(
      await chamarWebhookDoFluxo({
        ...base,
        fetchImpl: (async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
      }),
    ).toEqual({ resultado: "erro", motivo: "falha_de_rede" });
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(
      await chamarWebhookDoFluxo({
        ...base,
        fetchImpl: (async () => {
          throw timeout;
        }) as unknown as typeof fetch,
      }),
    ).toEqual({ resultado: "erro", motivo: "timeout" });
  });

  it("URL de rede interna é recusada ANTES de qualquer requisição", async () => {
    const fetchImpl = vi.fn();
    for (const url of ["http://127.0.0.1/x", "http://169.254.169.254/latest", "http://10.0.0.5", "ftp://x.test"]) {
      const r = await chamarWebhookDoFluxo({
        url,
        segredo: "s",
        entrega: "d",
        contexto,
        agora,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.resultado).toBe("erro");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
