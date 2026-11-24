/**
 * A BUSCA DO CATÁLOGO NÃO CORTA CEGO (issue #480) — E NÃO TEM MAIS TETO
 * (migration 9481).
 *
 * ─── A história em duas medidas ─────────────────────────────────────────────
 *
 * #480: `crm_search_products` trazia `.limit(2000)` sem `ORDER BY`, e o
 * `max_rows = 1000` do PostgREST cortava em metade disso. Numa loja acima do
 * teto, o produto pedido podia não estar no lote, e o agente dizia "não temos"
 * para um produto que a loja TEM. O conserto paginou até 10 páginas e passou a
 * DECLARAR a varredura parcial em vez de afirmar ausência.
 *
 * 9481: o teto declarado (10 mil) continuava sendo teto. Num catálogo de 77 mil
 * itens, o produto existente "não era encontrado" — o melhor que a busca dizia
 * era "não sei". Agora os candidatos vêm de `fn_buscar_produtos`, que procura
 * no catálogo INTEIRO, e a pontuação em memória roda só sobre eles.
 *
 * O que este arquivo prende:
 *   - a busca vai à função do banco com a org do CONTEXTO, nunca do input, e
 *     não pagina o catálogo para a memória;
 *   - acha o produto que está depois da posição 10 000 (o defeito da 9481);
 *   - sem teto, o vazio é ausência e é dito como ausência;
 *   - erro do banco NÃO vira "não achei";
 *   - quando os mais parecidos estão esgotados, pede de novo só os vendáveis.
 *
 * O dublê imita a função: corta por organização, aplica `p_somente_disponiveis`,
 * escolhe os que têm alguma palavra da consulta e devolve no máximo
 * `p_limite`. A prova de que a função DE VERDADE faz isso no Postgres está em
 * `tests/invariants/catalogo-busca-no-banco.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { normalizar } from "@/lib/catalogo/busca";
import { CANDIDATOS_DA_BUSCA } from "@/lib/catalogo/busca-no-banco";
import { crmSearchProducts } from "@/lib/mcp/tools/comercio";

const ORG = "org-do-contexto";

interface Linha {
  id: string;
  organization_id: string;
  codigo: string;
  nome: string;
  descricao: null;
  marca: null;
  categoria: null;
  capacidade: null;
  preco_cents: number;
  preco_promocional_cents?: number | null;
  moeda: string;
  controla_estoque: boolean;
  quantidade: number;
  fotos: null;
}

function catalogo(total: number, alvo: (i: number) => string | null = () => null): Linha[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `p${i}`,
    organization_id: ORG,
    codigo: `COD${String(i).padStart(6, "0")}`,
    nome: alvo(i) ?? `Item Generico ${i}`,
    descricao: null,
    marca: null,
    categoria: null,
    capacidade: null,
    preco_cents: 1000 + i,
    moeda: "BRL",
    controla_estoque: false,
    quantidade: 0,
    fotos: null,
  }));
}

interface ChamadaRpc {
  fn: string;
  args: Record<string, unknown>;
}

function bancoComFuncao(linhas: Linha[], opcoes: { erro?: string } = {}) {
  const rpcs: ChamadaRpc[] = [];
  const tabelas: string[] = [];
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return {
        select: async () => {
          if (opcoes.erro) return { data: null, error: { message: opcoes.erro } };
          const palavras = normalizar(String(args.p_termo)).split(" ").filter((p) => p.length >= 2);
          const dados = linhas
            .filter((l) => l.organization_id === args.p_org)
            .filter((l) => !args.p_somente_disponiveis || !l.controla_estoque || l.quantidade > 0)
            .filter((l) => palavras.some((p) => normalizar(`${l.nome} ${l.codigo}`).includes(p)))
            .slice(Number(args.p_offset ?? 0), Number(args.p_offset ?? 0) + Number(args.p_limite));
          return { data: dados, error: null };
        },
      };
    },
    // Só `capacidadesDaOrganizacao` lê tabela: a busca não pode ler o catálogo daqui.
    from: (tabela: string) => {
      tabelas.push(tabela);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "range", "limit", "is", "in"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      return q;
    },
  };
  return { rpcs, tabelas, ctx: { supabase, organizationId: ORG } as never };
}

type Resposta = {
  produtos: Array<{ codigo: string; preco: string; preco_cents: number; preco_original?: string; em_promocao?: boolean }>;
  motivo?: string;
  mensagem?: string;
};

const buscar = (db: ReturnType<typeof bancoComFuncao>, termo: string, extra: Record<string, unknown> = {}) =>
  crmSearchProducts.handler(
    { termo, limite: 5, somente_disponiveis: true, ...extra } as never,
    db.ctx,
  ) as Promise<Resposta>;

describe("os candidatos vêm do banco, do catálogo inteiro", () => {
  it("⭐ pede à função do banco com a org do CONTEXTO — e não pagina o catálogo para a memória", async () => {
    const db = bancoComFuncao(catalogo(50, (i) => (i === 7 ? "Perfume Raro" : null)));
    await buscar(db, "perfume", { organization_id: "org-do-input" });

    expect(db.rpcs.map((c) => c.fn)).toEqual(["fn_buscar_produtos"]);
    expect(db.rpcs[0]!.args.p_org, "a org saiu de outro lugar que não o contexto").toBe(ORG);
    expect(db.rpcs[0]!.args.p_limite).toBe(CANDIDATOS_DA_BUSCA);
    expect(db.tabelas, "a busca voltou a ler catalog_products direto").not.toContain("catalog_products");
  });

  it("⭐ acha o produto que está DEPOIS da posição 10 000 — o catálogo de 77 mil", async () => {
    // Na versão anterior, 10 páginas de 1000 eram o teto: o item 76 999 nunca
    // era alcançado, e a resposta era "varredura parcial".
    const db = bancoComFuncao(catalogo(77_000, (i) => (i === 76_999 ? "Perfume Importado Raro" : null)));
    const r = await buscar(db, "perfume importado raro");

    expect(r.produtos.map((p) => p.codigo)).toEqual(["COD076999"]);
  });

  it("⭐ sem teto, o vazio é AUSÊNCIA — e a busca diz isso, em qualquer tamanho de catálogo", async () => {
    const db = bancoComFuncao(catalogo(200_000));
    const r = await buscar(db, "coisa que nao existe em lugar nenhum");

    expect(r.produtos).toEqual([]);
    expect(r.motivo).toBe("nao_encontrado");
    expect(String(r.mensagem)).toMatch(/não há nada com esse nome no catálogo/i);
    expect(String(r.mensagem), "voltou a falar de varredura parcial").not.toMatch(/consegui consultar|parcial/i);
  });

  it("⭐ erro do banco NÃO vira 'não achei' — vira erro", async () => {
    // "Não consegui procurar" dito como "a loja não tem" é o desfecho que esta
    // busca existe para evitar.
    const db = bancoComFuncao(catalogo(10), { erro: "statement timeout" });
    await expect(buscar(db, "perfume")).rejects.toThrow(/buscar_produtos_falhou/);
  });

  it("quando os mais parecidos estão esgotados, pede de novo só os vendáveis", async () => {
    // 200 perfumes esgotados na frente, um vendável depois: só o primeiro lote
    // diria "sem estoque" para um perfume que dá para vender.
    const linhas = catalogo(CANDIDATOS_DA_BUSCA + 1, () => "Perfume").map((l, i) =>
      i < CANDIDATOS_DA_BUSCA ? { ...l, controla_estoque: true, quantidade: 0 } : l,
    );
    const db = bancoComFuncao(linhas);
    const r = await buscar(db, "perfume");

    expect(db.rpcs.map((c) => c.args.p_somente_disponiveis)).toEqual([false, true]);
    expect(r.produtos.map((p) => p.codigo)).toEqual([`COD${String(CANDIDATOS_DA_BUSCA).padStart(6, "0")}`]);
  });

  it("controle: lote que não veio cheio não gasta a segunda ida", async () => {
    const db = bancoComFuncao(catalogo(3, () => "Perfume").map((l) => ({ ...l, controla_estoque: true })));
    const r = await buscar(db, "perfume");

    expect(db.rpcs).toHaveLength(1);
    expect(r.motivo).toBe("sem_estoque");
  });
});

describe("o preço que o agente responde é o vigente", () => {
  it("⭐ com promoção, `preco` é o promocional e o de antes vai em `preco_original`", async () => {
    const db = bancoComFuncao(
      catalogo(1, () => "Perfume").map((l) => ({ ...l, preco_cents: 20000, preco_promocional_cents: 15000 })),
    );
    const r = await buscar(db, "perfume");
    const p = r.produtos[0]!;

    expect(p.preco_cents).toBe(15000);
    expect(p.preco.replace(/[  ]/g, " ")).toBe("R$ 150,00");
    expect(p.preco_original?.replace(/[  ]/g, " ")).toBe("R$ 200,00");
    expect(p.em_promocao).toBe(true);
  });

  it("controle: sem promoção, nada de `preco_original`", async () => {
    const db = bancoComFuncao(catalogo(1, () => "Perfume"));
    const p = (await buscar(db, "perfume")).produtos[0]!;

    expect(p.preco_cents).toBe(1000);
    expect(p).not.toHaveProperty("preco_original");
    expect(p).not.toHaveProperty("em_promocao");
  });
});

/**
 * A DESCRIÇÃO DA FERRAMENTA TAMBÉM É LIDA PELO AGENTE (nota 1 da issue #539).
 *
 * A descrição é prompt: o agente obedece ao TEXTO, não ao código. Quando o
 * desfecho muda, a frase tem de mudar junto — antes era "a varredura pode ser
 * parcial"; agora a busca olha o catálogo inteiro e o vazio é ausência.
 */
describe("a descrição acompanha o desfecho", () => {
  it("⭐ diz que a busca olha o catálogo inteiro, e não fala mais de varredura parcial", () => {
    const desc = crmSearchProducts.description;

    expect(desc).toMatch(/catálogo INTEIRO/);
    expect(desc, "a descrição ainda manda o agente desconfiar de uma varredura que não existe").not.toMatch(
      /parcial/i,
    );
    // E não autoriza inventar preço no vazio.
    expect(desc).toMatch(/não\s+invente preço/i);
  });

  it("explica a promoção: `preco` é o que vale agora", () => {
    expect(crmSearchProducts.description).toMatch(/preco_original/);
  });
});
