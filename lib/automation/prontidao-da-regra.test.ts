import { describe, expect, it } from "vitest";

import { prontidaoDaRegra } from "./prontidao-da-regra";

const CANAL = "11111111-1111-4111-8111-111111111111";
const enviar = { type: "send_whatsapp_message", config: { channel_session_id: CANAL, template: "Oi" } };

function situacoes(r: ReturnType<typeof prontidaoDaRegra>) {
  return Object.fromEntries(r.itens.map((i) => [i.chave, i.situacao]));
}

describe("prontidaoDaRegra", () => {
  it("regra completa, com canal conectado, está pronta", () => {
    const r = prontidaoDaRegra({
      evento: "message.received",
      triggerConfig: {},
      acoes: [enviar],
      canais: [{ id: CANAL, status: "WORKING" }],
    });
    expect(situacoes(r)).toEqual({ gatilho: "ok", acao: "ok", acoes_validas: "ok", canal_ativo: "ok" });
    expect(r.pronta).toBe(true);
  });

  it("palavra-chave sem palavras não conta como gatilho configurado", () => {
    const r = prontidaoDaRegra({
      evento: "message.keyword",
      triggerConfig: { palavras: [], modo: "contem" },
      acoes: [{ type: "pause_ai", config: {} }],
      canais: [],
    });
    expect(situacoes(r).gatilho).toBe("falta");
    expect(situacoes(r).canal_ativo).toBe("nao_se_aplica");
    expect(r.pronta).toBe(false);
  });

  it("sem ação, falta ação; ação incompleta é apontada pela posição", () => {
    expect(situacoes(prontidaoDaRegra({ evento: "lead.created", triggerConfig: {}, acoes: [], canais: [] })).acao).toBe(
      "falta",
    );
    const r = prontidaoDaRegra({
      evento: "lead.created",
      triggerConfig: {},
      acoes: [{ type: "pause_ai", config: {} }, { type: "send_whatsapp_message", config: { channel_session_id: "", template: "" } }],
      canais: [],
    });
    expect(r.itens.find((i) => i.chave === "acoes_validas")).toEqual({ chave: "acoes_validas", situacao: "falta", acoes: [1] });
  });

  it("canal desconectado ou pausado reprova o envio", () => {
    const desconectado = prontidaoDaRegra({
      evento: "lead.created",
      triggerConfig: {},
      acoes: [enviar],
      canais: [{ id: CANAL, status: "SCAN_QR_CODE" }],
    });
    expect(situacoes(desconectado).canal_ativo).toBe("falta");
    const pausado = prontidaoDaRegra({
      evento: "lead.created",
      triggerConfig: {},
      acoes: [enviar],
      canais: [{ id: CANAL, status: "WORKING", metadata: { disabled: true } }],
    });
    expect(situacoes(pausado).canal_ativo).toBe("falta");
  });
});
