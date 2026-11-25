import { describe, expect, it } from "vitest";

import {
  CONFIG_PADRAO,
  configDoChatSchema,
  lerConfigDoChat,
  normalizarDominio,
  origemPermitida,
  snippetDoChat,
} from "./config";

describe("normalizarDominio", () => {
  it("transforma o que a pessoa colou no host do Origin", () => {
    expect(normalizarDominio("https://www.Loja.com.br/contato?x=1")).toBe("www.loja.com.br");
    expect(normalizarDominio("loja.com.br")).toBe("loja.com.br");
    expect(normalizarDominio("*.loja.com.br")).toBe("loja.com.br");
    expect(normalizarDominio("localhost:3000")).toBe("localhost:3000");
  });

  it("recusa o que não é host", () => {
    for (const ruim of ["", "   ", "loja com br", "-loja.com", "javascript:alert(1)", "lo_ja.com"]) {
      expect(normalizarDominio(ruim), ruim).toBeNull();
    }
  });
});

describe("origemPermitida", () => {
  const lista = ["loja.com.br", "localhost:3000"];

  it("aceita o domínio e os subdomínios dele", () => {
    expect(origemPermitida("https://loja.com.br", lista)).toBe(true);
    expect(origemPermitida("https://www.loja.com.br", lista)).toBe(true);
    expect(origemPermitida("http://localhost:3000", lista)).toBe(true);
  });

  it("recusa o parecido, a porta errada, o vazio e a lista vazia", () => {
    expect(origemPermitida("https://loja.com.br.golpe.com", lista)).toBe(false);
    expect(origemPermitida("https://outraloja.com.br", lista)).toBe(false);
    expect(origemPermitida("http://localhost:4000", lista)).toBe(false);
    expect(origemPermitida(null, lista)).toBe(false);
    expect(origemPermitida("null", lista)).toBe(false);
    expect(origemPermitida("https://loja.com.br", [])).toBe(false);
  });
});

describe("configDoChatSchema / lerConfigDoChat", () => {
  it("cor só em hex de seis dígitos", () => {
    expect(configDoChatSchema.safeParse({ ...CONFIG_PADRAO, cor: "red" }).success).toBe(false);
    expect(configDoChatSchema.safeParse({ ...CONFIG_PADRAO, cor: "#12ab9F" }).success).toBe(true);
  });

  it("domínios saem normalizados e sem repetição", () => {
    const r = configDoChatSchema.parse({ ...CONFIG_PADRAO, dominios: ["https://loja.com.br/", "LOJA.com.br"] });
    expect(r.dominios).toEqual(["loja.com.br"]);
  });

  it("coluna ilegível vira o padrão DESLIGADO; campo ruim volta ao padrão sozinho", () => {
    expect(lerConfigDoChat(null)).toEqual(CONFIG_PADRAO);
    expect(lerConfigDoChat("x").ativo).toBe(false);
    const lido = lerConfigDoChat({ nome: "Loja", cor: "<script>", ativo: true, dominios: ["loja.com.br"] });
    expect(lido.nome).toBe("Loja");
    expect(lido.cor).toBe(CONFIG_PADRAO.cor);
    expect(lido.ativo).toBe(true);
  });
});

it("o snippet aponta para o script da instalação, com a chave", () => {
  expect(snippetDoChat("https://crm.exemplo.com/", "k".repeat(32))).toBe(
    `<script src="https://crm.exemplo.com/webchat.js" data-chave="${"k".repeat(32)}" async></script>`,
  );
});
