import { describe, expect, it, vi } from "vitest";

import { destinoValido, linksNoTexto, temMarcacaoDeLink, trocarLinks } from "./link";
import { marcacoesNoTexto, resolverVariaveis } from "./resolvedor";

describe("a marcação {{link:…}}", () => {
  it("lê URL e rótulo, na ordem do texto", () => {
    expect(
      linksNoTexto("Veja {{link:https://loja.exemplo/oferta}} e {{ link:https://a.exemplo/x?y=1 | black friday }}"),
    ).toEqual([
      { marca: "{{link:https://loja.exemplo/oferta}}", destino: "https://loja.exemplo/oferta", rotulo: null },
      {
        marca: "{{ link:https://a.exemplo/x?y=1 | black friday }}",
        destino: "https://a.exemplo/x?y=1",
        rotulo: "black friday",
      },
    ]);
  });

  it("só http/https com host: javascript:, data:, credencial e lixo ficam de fora", () => {
    expect(destinoValido("javascript:alert(1)")).toBeNull();
    expect(destinoValido("data:text/html,oi")).toBeNull();
    expect(destinoValido("ftp://arquivos.exemplo/a")).toBeNull();
    expect(destinoValido("https://user:senha@loja.exemplo/")).toBeNull();
    expect(destinoValido("nem-url")).toBeNull();
    expect(destinoValido(`https://loja.exemplo/${"a".repeat(2100)}`)).toBeNull();
    expect(destinoValido("http://loja.exemplo")).toBe("http://loja.exemplo/");
  });

  it("o resolvedor único NÃO enxerga a marcação — ela atravessa as quatro telas intacta", () => {
    const texto = "Oi {{nome}}, {{link:https://loja.exemplo/a|bf}}";
    expect(marcacoesNoTexto(texto)).toEqual(["nome"]);
    for (const fonte of ["inbox", "campanha", "automacao", "fluxo"] as const) {
      const r = resolverVariaveis(texto, { nome: "Ana" }, { fonte, quandoVazio: "vazio" });
      expect(r.texto).toBe("Oi Ana, {{link:https://loja.exemplo/a|bf}}");
      expect(r.desconhecidas).toEqual([]);
    }
  });

  it("troca só as válidas; a inválida fica como foi escrita; destino repetido pede uma vez", async () => {
    const trocar = vi.fn(async ({ destino, rotulo }: { destino: string; rotulo: string | null }) =>
      `<${destino}|${rotulo ?? "-"}>`,
    );
    const saida = await trocarLinks(
      "a {{link:https://x.exemplo/1}} b {{link:javascript:alert(1)}} c {{link:https://x.exemplo/1}} d {{link:https://x.exemplo/1|r}}",
      trocar,
    );
    expect(saida).toBe(
      "a <https://x.exemplo/1|-> b {{link:javascript:alert(1)}} c <https://x.exemplo/1|-> d <https://x.exemplo/1|r>",
    );
    expect(trocar).toHaveBeenCalledTimes(2);
  });

  it("texto sem marcação não chama ninguém", async () => {
    const trocar = vi.fn();
    expect(temMarcacaoDeLink("https://loja.exemplo sem marcação")).toBe(false);
    expect(await trocarLinks("https://loja.exemplo", trocar)).toBe("https://loja.exemplo");
    expect(trocar).not.toHaveBeenCalled();
  });
});
