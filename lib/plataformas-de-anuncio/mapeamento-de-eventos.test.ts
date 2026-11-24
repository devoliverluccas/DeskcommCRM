import { describe, expect, it } from "vitest";

import {
  OPCOES_DE_EVENTO,
  lerMapeamento,
  mapeamentoPadrao,
  nomeNoFio,
  schemaDoMapeamento,
} from "./mapeamento-de-eventos";
import { PLATAFORMAS, transporteDe } from "./registry";

describe("regras de conversão do GA4 e do TikTok", () => {
  it("o padrão liga todo evento no nome recomendado", () => {
    expect(mapeamentoPadrao("ga4")).toEqual({
      Purchase: "purchase",
      LeadSubmitted: "generate_lead",
      QualifiedLead: "qualify_lead",
    });
    expect(mapeamentoPadrao("tiktok").Purchase).toBe("CompletePayment");
  });

  it("a leitura é tolerante: ausente vira padrão, desconhecido vira não enviar", () => {
    expect(lerMapeamento("ga4", null)).toEqual(mapeamentoPadrao("ga4"));
    expect(lerMapeamento("ga4", [])).toEqual(mapeamentoPadrao("ga4"));
    expect(lerMapeamento("ga4", { Purchase: "close_convert_lead", LeadSubmitted: null })).toEqual({
      Purchase: "close_convert_lead",
      LeadSubmitted: null,
      QualifiedLead: "qualify_lead",
    });
    expect(lerMapeamento("tiktok", { Purchase: "Purchse" }).Purchase).toBeNull();
  });

  it("a escrita recusa evento fora da lista da plataforma", () => {
    const s = schemaDoMapeamento("tiktok");
    expect(s.safeParse({ Purchase: "CompletePayment", LeadSubmitted: null, QualifiedLead: "Contact" }).success).toBe(true);
    expect(s.safeParse({ Purchase: "purchase", LeadSubmitted: null, QualifiedLead: null }).success).toBe(false);
    expect(s.safeParse({ Purchase: null, LeadSubmitted: null }).success).toBe(false);
  });

  it("nome no fio: o escolhido pelo chamador vale se for conhecido; etapa sem nome não sai", () => {
    const m = mapeamentoPadrao("tiktok");
    expect(nomeNoFio("tiktok", m, "Purchase")).toBe("CompletePayment");
    expect(nomeNoFio("tiktok", m, "MetaEtapa:x", "Contact")).toBe("Contact");
    expect(nomeNoFio("tiktok", m, "MetaEtapa:x", "InventadoAqui")).toBeNull();
    expect(nomeNoFio("ga4", { ...mapeamentoPadrao("ga4"), Purchase: null }, "Purchase")).toBeNull();
  });

  it("toda opção da tela é um nome que o transporte aceita", () => {
    for (const plataforma of ["ga4", "tiktok"] as const) {
      for (const lista of Object.values(OPCOES_DE_EVENTO[plataforma])) {
        for (const nome of lista) expect(nomeNoFio(plataforma, undefined, "X", nome)).toBe(nome);
      }
    }
  });
});

describe("registro de transportes", () => {
  it("GA4 e TikTok estão no registro, com Testar conexão", () => {
    expect(PLATAFORMAS).toEqual(expect.arrayContaining(["ga4", "tiktok"]));
    expect(transporteDe("ga4")?.plataforma).toBe("ga4");
    expect(transporteDe("tiktok")?.plataforma).toBe("tiktok");
    expect(typeof transporteDe("ga4")?.testarConexao).toBe("function");
    expect(typeof transporteDe("tiktok")?.testarConexao).toBe("function");
  });
});
