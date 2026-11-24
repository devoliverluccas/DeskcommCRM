import { describe, expect, it } from "vitest";

import { telaDoGatilho, triggerConfigDaTela } from "./desenho-da-regra";
import { createAutomationRuleSchema } from "@/lib/schemas/webhooks";

/**
 * O designer e a porta da API falam da mesma palavra-chave (fase 4, 4.1): o que
 * está gravado abre na tela, a tela grava pelo mesmo formato, e a porta recusa
 * a regra sem palavras (que nunca dispararia).
 */
describe("palavra-chave no desenho da regra", () => {
  const gravada = {
    trigger_event: "message.keyword",
    trigger_config: { palavras: ["preço", "valor"], modo: "exata", ignorar_acentos: false, uma_vez_por_contato: true },
  };

  it("abre o que está gravado e grava de volta sem perder o que a tela não desenha", () => {
    const tela = telaDoGatilho(gravada.trigger_config);
    expect(tela.palavraChave).toEqual({ texto: "preço\nvalor", modo: "exata", ignorarAcentos: false });
    const config = triggerConfigDaTela("message.keyword", { ...tela, palavraChave: { ...tela.palavraChave!, texto: "orçamento, preço" } }, gravada);
    expect(config).toEqual({
      palavras: ["orçamento", "preço"],
      modo: "exata",
      ignorar_acentos: false,
      uma_vez_por_contato: true,
    });
  });

  it("a porta da API recusa a regra de palavra-chave sem palavras", () => {
    const base = { name: "Preço", actions: [{ type: "pause_ai", config: {} }] };
    expect(
      createAutomationRuleSchema.safeParse({ ...base, trigger_event: "message.keyword", trigger_config: { palavras: [], modo: "contem" } })
        .success,
    ).toBe(false);
    expect(
      createAutomationRuleSchema.safeParse({ ...base, trigger_event: "message.keyword", trigger_config: { palavras: ["preço"], modo: "contem" } })
        .success,
    ).toBe(true);
  });

  it("a conversão pela regra exige um evento do vocabulário", () => {
    const base = { name: "Venda", trigger_event: "lead.won" };
    expect(
      createAutomationRuleSchema.safeParse({ ...base, actions: [{ type: "send_ad_conversion", config: { evento: "Purchase" } }] }).success,
    ).toBe(true);
    expect(
      createAutomationRuleSchema.safeParse({ ...base, actions: [{ type: "send_ad_conversion", config: { evento: "Inventado" } }] }).success,
    ).toBe(false);
  });
});
