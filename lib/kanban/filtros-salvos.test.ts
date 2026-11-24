import { describe, expect, it } from "vitest";

import {
  CHAVE_DOS_FILTROS_SALVOS,
  MAXIMO_DE_FILTROS_SALVOS,
  apagarFiltroSalvo,
  filtrosDoSalvo,
  lerFiltrosSalvos,
  salvarFiltro,
} from "./filtros-salvos";

function armazenamento(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    cru: () => dados.get(CHAVE_DOS_FILTROS_SALVOS),
  };
}

const FUNIL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUNIL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("filtros salvos do funil", () => {
  it("salva e devolve o filtro pela mesma porta do deep-link", () => {
    const s = armazenamento();
    salvarFiltro(s, FUNIL_A, "  Meus atrasados ", {
      owner: "u1",
      status: "open",
      tag: ["vip", "quente"],
      tagMode: "ou",
      overdueOnly: true,
    });
    const [salvo] = lerFiltrosSalvos(s, FUNIL_A);
    expect(salvo?.nome).toBe("Meus atrasados");
    const filtros = filtrosDoSalvo(salvo!);
    expect(filtros).toMatchObject({
      owner: "u1",
      status: "open",
      tag: ["vip", "quente"],
      tagMode: "ou",
      overdueOnly: true,
    });
  });

  it("é por funil: salvar no A não aparece no B nem apaga o do B", () => {
    const s = armazenamento();
    salvarFiltro(s, FUNIL_B, "Perdidos", { status: "lost" });
    salvarFiltro(s, FUNIL_A, "Abertos", { status: "open" });
    expect(lerFiltrosSalvos(s, FUNIL_A).map((f) => f.nome)).toEqual(["Abertos"]);
    expect(lerFiltrosSalvos(s, FUNIL_B).map((f) => f.nome)).toEqual(["Perdidos"]);
  });

  it("mesmo nome (sem diferenciar maiúscula) substitui no lugar", () => {
    const s = armazenamento();
    salvarFiltro(s, FUNIL_A, "Um", { status: "open" });
    salvarFiltro(s, FUNIL_A, "Dois", { status: "won" });
    salvarFiltro(s, FUNIL_A, "um", { status: "lost" });
    const lista = lerFiltrosSalvos(s, FUNIL_A);
    expect(lista.map((f) => f.nome)).toEqual(["um", "Dois"]);
    expect(filtrosDoSalvo(lista[0]!).status).toBe("lost");
  });

  it("nome vazio não salva", () => {
    const s = armazenamento();
    salvarFiltro(s, FUNIL_A, "   ", { status: "open" });
    expect(lerFiltrosSalvos(s, FUNIL_A)).toEqual([]);
    expect(s.cru()).toBeUndefined();
  });

  it("apaga só o escolhido", () => {
    const s = armazenamento();
    salvarFiltro(s, FUNIL_A, "Um", { status: "open" });
    salvarFiltro(s, FUNIL_A, "Dois", { status: "won" });
    expect(apagarFiltroSalvo(s, FUNIL_A, "UM").map((f) => f.nome)).toEqual(["Dois"]);
    expect(lerFiltrosSalvos(s, FUNIL_A).map((f) => f.nome)).toEqual(["Dois"]);
    apagarFiltroSalvo(s, FUNIL_A, "Dois");
    expect(JSON.parse(s.cru() ?? "{}")).toEqual({});
  });

  it("tem teto por funil: o mais antigo sai", () => {
    const s = armazenamento();
    for (let i = 0; i <= MAXIMO_DE_FILTROS_SALVOS; i++) {
      salvarFiltro(s, FUNIL_A, `F${i}`, { status: "open" });
    }
    const nomes = lerFiltrosSalvos(s, FUNIL_A).map((f) => f.nome);
    expect(nomes).toHaveLength(MAXIMO_DE_FILTROS_SALVOS);
    expect(nomes[0]).toBe("F1");
  });

  it("JSON torto, formato errado e item sem nome viram vazio, não erro", () => {
    expect(
      lerFiltrosSalvos(armazenamento({ [CHAVE_DOS_FILTROS_SALVOS]: "{nao json" }), FUNIL_A),
    ).toEqual([]);
    expect(
      lerFiltrosSalvos(armazenamento({ [CHAVE_DOS_FILTROS_SALVOS]: "[1,2]" }), FUNIL_A),
    ).toEqual([]);
    const misto = armazenamento({
      [CHAVE_DOS_FILTROS_SALVOS]: JSON.stringify({
        [FUNIL_A]: [
          null,
          3,
          { nome: "" },
          { nome: "Ok", consulta: "status=open" },
          { nome: "Sem consulta" },
        ],
      }),
    });
    expect(lerFiltrosSalvos(misto, FUNIL_A)).toEqual([{ nome: "Ok", consulta: "status=open" }]);
  });

  it("consulta torta cai nos padrões que a URL já tolera", () => {
    expect(filtrosDoSalvo({ nome: "x", consulta: "status=banana&modo=talvez" })).toMatchObject({
      status: "all",
    });
  });

  it("sem armazenamento (SSR, bloqueado) não lança", () => {
    expect(lerFiltrosSalvos(null, FUNIL_A)).toEqual([]);
    expect(salvarFiltro(null, FUNIL_A, "x", {})).toEqual([]);
    expect(apagarFiltroSalvo(null, FUNIL_A, "x")).toEqual([]);
  });

  it("setItem que lança (quota) não derruba a tela", () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => salvarFiltro(s, FUNIL_A, "x", { status: "open" })).not.toThrow();
  });
});
