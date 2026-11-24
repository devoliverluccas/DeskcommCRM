import { afterEach, describe, expect, it, vi } from "vitest";

import {
  casarOpcaoInterativa,
  corpoInterativoDaCloudApi,
  interativoParaOCanal,
  textoNumerado,
  type MensagemInterativa,
} from "./interativo";
import type { OutboundEnvelope } from "./types";

const metaCreds = vi.fn(async () => ({ phoneNumberId: "555", token: "tok" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) as never }));
vi.mock("@/lib/channels/meta/credentials", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveMetaCreds: (...a: unknown[]) => metaCreds(...(a as [])),
}));

const BOTOES: MensagemInterativa = {
  tipo: "botoes",
  corpo: "Qual horário fica melhor?",
  opcoes: [
    { id: "manha", rotulo: "Manhã" },
    { id: "tarde", rotulo: "Tarde" },
    { id: "noite", rotulo: "Noite" },
  ],
};

describe("textoNumerado — o que sai no canal sem botão", () => {
  it("numera as opções e convida a responder pelo número", () => {
    expect(textoNumerado(BOTOES)).toBe(
      "Qual horário fica melhor?\n\n1. Manhã\n2. Tarde\n3. Noite\n\nResponda 1, 2 ou 3.",
    );
  });

  it("lista leva a descrição de cada item", () => {
    const lista: MensagemInterativa = {
      tipo: "lista",
      corpo: "Escolha o serviço:",
      botao: "Ver serviços",
      opcoes: [
        { id: "a", rotulo: "Corte", descricao: "30 min" },
        { id: "b", rotulo: "Barba" },
      ],
    };
    expect(textoNumerado(lista)).toBe("Escolha o serviço:\n\n1. Corte — 30 min\n2. Barba\n\nResponda 1 ou 2.");
  });
});

describe("casarOpcaoInterativa — id, número ou rótulo", () => {
  const opcoes = BOTOES.opcoes;

  it("o id do botão tocado (canal interativo) casa direto", () => {
    expect(casarOpcaoInterativa(opcoes, "tarde")).toBe("tarde");
  });

  it("o número casa, com ou sem enfeite", () => {
    expect(casarOpcaoInterativa(opcoes, "2")).toBe("tarde");
    expect(casarOpcaoInterativa(opcoes, " 3. ")).toBe("noite");
    expect(casarOpcaoInterativa(opcoes, "opção 1")).toBe("manha");
  });

  it("o rótulo casa sem acento e sem caixa", () => {
    expect(casarOpcaoInterativa(opcoes, "MANHA")).toBe("manha");
  });

  it("número fora da lista e frase longa NÃO casam — escolher errado é pior que Outros casos", () => {
    expect(casarOpcaoInterativa(opcoes, "4")).toBeNull();
    expect(casarOpcaoInterativa(opcoes, "de manhã não posso, só à tarde")).toBeNull();
    expect(casarOpcaoInterativa(opcoes, "")).toBeNull();
  });
});

describe("interativoParaOCanal — decide pela capability, nunca pelo nome", () => {
  it("canal que desenha botões recebe o desenho", () => {
    expect(interativoParaOCanal("meta_cloud", BOTOES)).toEqual(BOTOES);
  });

  it("canal sem a capability recebe só o texto (undefined)", () => {
    expect(interativoParaOCanal("waha", BOTOES)).toBeUndefined();
    expect(interativoParaOCanal("telegram", BOTOES)).toBeUndefined();
  });

  it("provider desconhecido e payload torto caem no texto", () => {
    expect(interativoParaOCanal("desconhecido", BOTOES)).toBeUndefined();
    expect(interativoParaOCanal("meta_cloud", { tipo: "botoes", corpo: "x", opcoes: [] })).toBeUndefined();
    expect(interativoParaOCanal("meta_cloud", null)).toBeUndefined();
  });
});

describe("corpoInterativoDaCloudApi", () => {
  it("botões viram `interactive.button` com o id como reply.id", () => {
    expect(corpoInterativoDaCloudApi(BOTOES)).toEqual({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Qual horário fica melhor?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "manha", title: "Manhã" } },
            { type: "reply", reply: { id: "tarde", title: "Tarde" } },
            { type: "reply", reply: { id: "noite", title: "Noite" } },
          ],
        },
      },
    });
  });
});

describe("adapter do canal oficial manda o desenho quando o envelope traz", () => {
  const fetchOriginal = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  async function enviar(envelope: Partial<OutboundEnvelope>) {
    const chamadas: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      chamadas.push(JSON.parse(init?.body ?? "{}"));
      return { ok: true, status: 200, statusText: "", json: async () => ({ messages: [{ id: "wamid.1" }] }) };
    }) as unknown as typeof fetch;
    const { metaCloudAdapter } = await import("./adapters/meta-cloud");
    await metaCloudAdapter.send({
      organizationId: "org",
      sessionRef: "555",
      to: "5511999990000",
      kind: "text",
      body: textoNumerado(BOTOES),
      ...envelope,
    });
    return chamadas[0]!;
  }

  it("com `interativo`: sai `type: interactive`", async () => {
    const corpo = await enviar({ interativo: BOTOES });
    expect(corpo.type).toBe("interactive");
    expect((corpo.interactive as { type: string }).type).toBe("button");
  });

  it("sem `interativo`: sai o texto numerado, como sempre", async () => {
    const corpo = await enviar({});
    expect(corpo).toMatchObject({ type: "text", text: { body: textoNumerado(BOTOES) } });
  });
});
