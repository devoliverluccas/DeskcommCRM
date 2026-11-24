import { describe, expect, it } from "vitest";

import { SEM_FILTROS } from "./busca-da-tela";
import {
  CANDIDATOS_DA_BUSCA,
  candidatosDaBusca,
  categoriasDoCatalogo,
  PARECIDOS_NA_TELA,
  parecidosDaBusca,
} from "./busca-no-banco";

type Chamada = { fn: string; args: Record<string, unknown>; colunas?: string };

function banco(resposta: { data: unknown; error: { message: string } | null }) {
  const chamadas: Chamada[] = [];
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      const chamada: Chamada = { fn, args };
      chamadas.push(chamada);
      const promessa = Promise.resolve(resposta);
      return Object.assign(promessa, {
        select: async (colunas: string) => {
          chamada.colunas = colunas;
          return resposta;
        },
      });
    },
  };
  return { chamadas, supabase: supabase as never };
}

describe("candidatosDaBusca", () => {
  it("chama fn_buscar_produtos com a org, o termo e os padrões", async () => {
    const db = banco({ data: [{ id: "a" }], error: null });
    const r = await candidatosDaBusca(db.supabase, "org-1", "ifone", { colunas: "id, nome" });

    expect(r).toEqual([{ id: "a" }]);
    expect(db.chamadas[0]).toEqual({
      fn: "fn_buscar_produtos",
      args: {
        p_org: "org-1",
        p_termo: "ifone",
        p_limite: CANDIDATOS_DA_BUSCA,
        p_somente_disponiveis: false,
        p_categoria: null,
        p_offset: 0,
      },
      colunas: "id, nome",
    });
  });

  it("⭐ erro do banco LANÇA — 'não consegui procurar' não vira 'não achei'", async () => {
    const db = banco({ data: null, error: { message: "boom" } });
    await expect(candidatosDaBusca(db.supabase, "org-1", "x", { colunas: "id" })).rejects.toThrow(
      /buscar_produtos_falhou: boom/,
    );
  });
});

describe("parecidosDaBusca — a tela usa a régua do agente", () => {
  it("⭐ 'ifone' põe o iPhone na frente do fone — a mesma nota de lib/catalogo/busca.ts", async () => {
    const db = banco({
      data: [
        { id: "f", codigo: "F1", nome: "Fone Bluetooth" },
        { id: "i", codigo: "I1", nome: "iPhone 15" },
      ],
      error: null,
    });
    const r = await parecidosDaBusca<{ id: string; codigo: string; nome: string }>(
      db.supabase,
      "org-1",
      "ifone",
      { categoria: "Celulares", soComEstoque: true },
      "id",
    );

    expect(r.map((p) => p.id)).toEqual(["i", "f"]);
    expect(db.chamadas[0]!.args).toMatchObject({ p_categoria: "Celulares", p_somente_disponiveis: true });
  });

  it("devolve no máximo PARECIDOS_NA_TELA", async () => {
    const linhas = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, codigo: `C${i}`, nome: `Perfume ${i}` }));
    const db = banco({ data: linhas, error: null });
    const r = await parecidosDaBusca(db.supabase, "org-1", "perfume", SEM_FILTROS, "id");
    expect(r).toHaveLength(PARECIDOS_NA_TELA);
  });
});

describe("categoriasDoCatalogo", () => {
  it("lista as categorias da função, sem vazias", async () => {
    const db = banco({
      data: [
        { categoria: "Perfumaria", quantidade: 3 },
        { categoria: " ", quantidade: 1 },
        { categoria: "Tênis", quantidade: 2 },
      ],
      error: null,
    });
    expect(await categoriasDoCatalogo(db.supabase, "org-1")).toEqual(["Perfumaria", "Tênis"]);
    expect(db.chamadas[0]).toMatchObject({ fn: "fn_categorias_do_catalogo", args: { p_org: "org-1" } });
  });

  it("⭐ NUNCA lança: erro vira lista vazia (o filtro é conforto, a tela não cai)", async () => {
    const db = banco({ data: null, error: { message: "function does not exist" } });
    expect(await categoriasDoCatalogo(db.supabase, "org-1")).toEqual([]);
  });
});
