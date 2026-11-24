import { describe, expect, it } from "vitest";

import {
  configDaPalavraChave,
  palavraQueCasa,
  palavrasDaTela,
  type ConfigDaPalavraChave,
} from "./gatilho-palavra-chave";

const cfg = (palavras: string[], modo: ConfigDaPalavraChave["modo"], ignorar_acentos = true): ConfigDaPalavraChave => ({
  palavras,
  modo,
  ignorar_acentos,
});

describe("configDaPalavraChave", () => {
  it("aceita a forma canônica e liga o ignorar acentos por padrão", () => {
    expect(configDaPalavraChave({ palavras: [" preço "], modo: "contem" })).toEqual({
      palavras: ["preço"],
      modo: "contem",
      ignorar_acentos: true,
    });
  });

  it("recusa lista vazia, palavra sem letra, modo desconhecido e acento torto", () => {
    expect(configDaPalavraChave({ palavras: [], modo: "contem" })).toBeNull();
    expect(configDaPalavraChave({ palavras: ["!!!"], modo: "contem" })).toBeNull();
    expect(configDaPalavraChave({ palavras: ["oi"], modo: "regex" })).toBeNull();
    expect(configDaPalavraChave({ palavras: ["oi"], modo: "contem", ignorar_acentos: "sim" })).toBeNull();
    expect(configDaPalavraChave({ palavras: Array.from({ length: 21 }, (_, i) => `p${i}`), modo: "contem" })).toBeNull();
    expect(configDaPalavraChave(null)).toBeNull();
  });
});

describe("palavraQueCasa", () => {
  it("contém casa palavra inteira, não pedaço de outra", () => {
    expect(palavraQueCasa("Qual o preço?", cfg(["preço"], "contem"))).toBe("preço");
    expect(palavraQueCasa("Um boi no pasto", cfg(["oi"], "contem"))).toBeNull();
  });

  it("ignora acentos e caixa quando pedido, e respeita quando não", () => {
    expect(palavraQueCasa("qual o PRECO", cfg(["preço"], "contem"))).toBe("preço");
    expect(palavraQueCasa("qual o PRECO", cfg(["preço"], "contem", false))).toBeNull();
  });

  it("exata exige a mensagem inteira; começa com exige o início", () => {
    expect(palavraQueCasa("Quero!", cfg(["quero"], "exata"))).toBe("quero");
    expect(palavraQueCasa("Quero comprar", cfg(["quero"], "exata"))).toBeNull();
    expect(palavraQueCasa("Quero comprar", cfg(["quero"], "comeca_com"))).toBe("quero");
    expect(palavraQueCasa("Eu quero", cfg(["quero"], "comeca_com"))).toBeNull();
  });

  it("expressão de várias palavras casa em ordem", () => {
    expect(palavraQueCasa("oi, quero falar com atendente agora", cfg(["falar com atendente"], "contem"))).toBe(
      "falar com atendente",
    );
    expect(palavraQueCasa("atendente, quero falar com", cfg(["falar com atendente"], "contem"))).toBeNull();
  });

  it("texto vazio não casa nada", () => {
    expect(palavraQueCasa("", cfg(["oi"], "contem"))).toBeNull();
    expect(palavraQueCasa(null, cfg(["oi"], "contem"))).toBeNull();
  });
});

describe("palavrasDaTela", () => {
  it("separa por linha e vírgula, sem vazias e sem repetidas", () => {
    expect(palavrasDaTela("preço, valor\n\nPreço; orçamento")).toEqual(["preço", "valor", "orçamento"]);
  });
});
