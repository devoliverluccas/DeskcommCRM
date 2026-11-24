import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A BUSCA DO CATÁLOGO NO POSTGRES DE VERDADE (migration 9481).
 *
 * `crm_search_products` trazia até 10 páginas de 1000 produtos e pontuava em
 * memória: num catálogo maior que 10 mil, o produto que existe "não era
 * encontrado". Agora `fn_buscar_produtos` escolhe os candidatos no catálogo
 * INTEIRO. O dublê de `tests/unit/catalogo-nao-corta-cego.test.ts` prova o lado
 * TypeScript; este arquivo prova a FUNÇÃO — o que nenhum dublê alcança:
 *
 *   - o produto depois da posição 12 000 é achado (não há teto);
 *   - o número que a loja tem FILTRA ("256" não traz o 128GB);
 *   - o erro de digitação acha ("ifone" → iPhone, na frente dos fones);
 *   - isolamento: pela sessão, a RLS vale — o membro da org B não lê a org A
 *     mesmo passando o id dela; a anon não executa;
 *   - o CHECK da promoção recusa promoção que não é menor que o preço.
 *
 * Conectar como `postgres` NÃO prova RLS (rolbypassrls). O isolamento é medido
 * com `set role authenticated` + `request.jwt.claims`, o caminho da produção.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)");
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** Roda como a sessão de um usuário e devolve só a saída do `script` (depois do marcador). */
function comoUsuario(userId: string, script: string): string {
  const saida = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    select '--resultado--';
    ${script}
  `);
  return saida.slice(saida.indexOf("--resultado--") + "--resultado--".length).trim();
}

const ORG_A = "94810000-0000-4000-8000-00000000000a";
const ORG_B = "94810000-0000-4000-8000-00000000000b";
const MEMBRO_A = "94810000-1111-4000-8000-00000000000a";
const MEMBRO_B = "94810000-1111-4000-8000-00000000000b";
const TOTAL = 12_000;

function limpar(): void {
  sql(`
    delete from public.catalog_products where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.user_organizations where organization_id in ('${ORG_A}', '${ORG_B}');
    delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');
    delete from auth.users where id in ('${MEMBRO_A}', '${MEMBRO_B}');
  `);
}

beforeAll(() => {
  limpar();
  sql(`
    insert into auth.users (id, email) values
      ('${MEMBRO_A}', 'busca-9481-a@invariant.test'),
      ('${MEMBRO_B}', 'busca-9481-b@invariant.test');
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'busca-9481-a', 'Busca 9481 A', 'Busca A'),
      ('${ORG_B}', 'busca-9481-b', 'Busca 9481 B', 'Busca B');
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${MEMBRO_A}', '${ORG_A}', 'agent', now()),
      ('${MEMBRO_B}', '${ORG_B}', 'agent', now());

    -- ${TOTAL} produtos genéricos; os que importam vêm DEPOIS, com código que
    -- ordena por último — além de qualquer teto de 10 mil.
    insert into public.catalog_products (organization_id, codigo, nome, categoria, preco_cents, controla_estoque, quantidade)
    select '${ORG_A}', 'GEN-' || lpad(g::text, 6, '0'),
           (array['Camiseta','Fone Bluetooth','Garrafa','Mochila'])[1 + g % 4] || ' Modelo ' || g,
           (array['Vestuário','Acessórios'])[1 + g % 2],
           1000 + g, false, 0
      from generate_series(1, ${TOTAL}) g;

    insert into public.catalog_products (organization_id, codigo, nome, categoria, preco_cents, preco_promocional_cents) values
      ('${ORG_A}', 'ZZ-RARO',     'Perfume Importado Raro',   'Perfumaria', 50000, 45000),
      ('${ORG_A}', 'ZZ-IP15-128', 'iPhone 15 Pro 128GB',      'Celulares',  699900, null),
      ('${ORG_A}', 'ZZ-IP15-256', 'iPhone 15 Pro 256GB',      'Celulares',  799900, null),
      ('${ORG_B}', 'ZZ-RARO-B',   'Perfume Importado Raro B', 'Perfumaria', 100, null);
    analyze public.catalog_products;
  `);
});

afterAll(limpar);

const buscar = (quem: string, org: string, termo: string, limite = 5) =>
  comoUsuario(
    quem,
    `select codigo from public.fn_buscar_produtos('${org}', '${termo}', ${limite});`,
  )
    .split("\n")
    .filter(Boolean);

describe("fn_buscar_produtos — o catálogo inteiro", () => {
  it("⭐ acha o produto que está depois da posição 12 000", () => {
    expect(buscar(MEMBRO_A, ORG_A, "perfume importado raro")).toContain("ZZ-RARO");
  });

  it("⭐ o número que a loja tem filtra: '256' não traz o 128GB", () => {
    const achados = buscar(MEMBRO_A, ORG_A, "iphone 15 pro 256");
    expect(achados).toContain("ZZ-IP15-256");
    expect(achados).not.toContain("ZZ-IP15-128");
  });

  it("⭐ 'ifone' acha o iPhone na frente de 3 000 fones", () => {
    // Sem a inicial na ordem, a semelhança do "fone" (0,5) vencia a do
    // "iphone" (0,33), e os iPhones nem entravam nos candidatos.
    const achados = buscar(MEMBRO_A, ORG_A, "ifone", 3);
    expect(achados.slice(0, 2).sort()).toEqual(["ZZ-IP15-128", "ZZ-IP15-256"]);
  });

  it("o código exato vem primeiro", () => {
    expect(buscar(MEMBRO_A, ORG_A, "GEN-000777", 3)[0]).toBe("GEN-000777");
  });

  it("filtra categoria e estoque", () => {
    const soCelular = comoUsuario(
      MEMBRO_A,
      `select count(*) from public.fn_buscar_produtos('${ORG_A}', 'iphone', 50, false, 'Perfumaria');`,
    );
    expect(soCelular).toBe("0");
  });
});

describe("fn_buscar_produtos — isolamento", () => {
  it("⭐ o membro da org B passando o id da org A lê ZERO (RLS, invoker)", () => {
    expect(buscar(MEMBRO_B, ORG_A, "perfume importado raro")).toEqual([]);
  });

  it("controle: o membro da org B acha o da própria org", () => {
    expect(buscar(MEMBRO_B, ORG_B, "perfume importado raro")).toEqual(["ZZ-RARO-B"]);
  });

  it("⭐ anon não executa as funções novas", () => {
    const privilegios = sql(`
      select has_function_privilege('anon', 'public.fn_buscar_produtos(uuid, text, integer, boolean, text, integer)', 'execute')
          || '|' ||
             has_function_privilege('anon', 'public.fn_categorias_do_catalogo(uuid)', 'execute')
          || '|' ||
             (select bool_or(prosecdef) from pg_proc where proname in ('fn_buscar_produtos', 'fn_categorias_do_catalogo'));
    `);
    expect(privilegios).toBe("false|false|false");
  });
});

describe("preço promocional", () => {
  it("⭐ o CHECK recusa promoção igual ou maior que o preço", () => {
    const desfecho = sql(`
      do $$
      begin
        update public.catalog_products set preco_promocional_cents = preco_cents
         where organization_id = '${ORG_A}' and codigo = 'ZZ-RARO';
        raise exception 'aceitou';
      exception when check_violation then
        null;
      end $$;
      select preco_promocional_cents from public.catalog_products
       where organization_id = '${ORG_A}' and codigo = 'ZZ-RARO';
    `);
    expect(desfecho.split("\n").pop()).toBe("45000");
  });

  it("baixar o preço abaixo da promoção também é recusado", () => {
    expect(() =>
      sql(`update public.catalog_products set preco_cents = 100
            where organization_id = '${ORG_A}' and codigo = 'ZZ-RARO';`),
    ).toThrow(/catalog_products_promocional_valido/);
  });
});

describe("fn_categorias_do_catalogo", () => {
  it("lista as categorias da própria org, com contagem", () => {
    const linhas = comoUsuario(MEMBRO_A, `select categoria || ':' || quantidade from public.fn_categorias_do_catalogo('${ORG_A}');`);
    expect(linhas.split("\n")).toEqual(["Acessórios:6000", "Celulares:2", "Perfumaria:1", "Vestuário:6000"]);
  });

  it("⭐ e nada da org vizinha", () => {
    expect(comoUsuario(MEMBRO_B, `select count(*) from public.fn_categorias_do_catalogo('${ORG_A}');`)).toBe("0");
  });
});
