import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

/**
 * LINKS DE SAÍDA E VALORES PERSONALIZADOS (migrations 9490 e 9491, fase 4).
 *
 * Mede no Postgres o que o TypeScript não alcança:
 *
 *   1. as três tabelas isolam por organização (JWT de A não lê B) e a sessão
 *      NÃO escreve nelas — a escrita é do servidor (envio, rota pública, rota
 *      com papel `manager`); a prova cross-tenant da lista inteira está também
 *      em `rls-isolation.test.ts` (TABLES);
 *   2. o link é idempotente por (organização, contato, destino, rótulo), o
 *      código é único na instalação, o destino é http/https, e a FK composta
 *      recusa contato de outra organização;
 *   3. `fn_registrar_clique_de_saida` só aceita o link DA organização passada,
 *      grava o fato `link.clicked` só para gente — `pending` quando o link tem
 *      contato (a pontuação por regra o consome, migration 9499) e `done` sem
 *      contato (registro) —, e o resumo não conta o robô de prévia;
 *   4. LGPD: anonimizar o contato desvincula o link, corta o destino na origem,
 *      tira `ip_hash`/`navegador` dos cliques e a rota deixa de achar o link;
 *   5. `valores_personalizados`: chave no formato, única por organização, valor
 *      de 1 a 2000; as funções novas não são executáveis pela sessão.
 */

const ORG_A = "9490aaaa-0000-4000-8000-000000000001";
const ORG_B = "9490bbbb-0000-4000-8000-000000000002";
const USER_A = "9490aaaa-1111-4000-8000-000000000001";
const CT_A = "9490aaaa-3333-4000-8000-000000000001";
const CT_B = "9490bbbb-3333-4000-8000-000000000002";
const LINK_A = "9490aaaa-5555-4000-8000-000000000001";
const LINK_B = "9490bbbb-5555-4000-8000-000000000002";

function semear(org: string, ct: string, tag: string): string {
  return `
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'l9490-inv-${tag}', 'Links ${tag}', 'L ${tag}') on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name)
      values ('${ct}', '${org}', 'Contato links ${tag}') on conflict (id) do nothing;
  `;
}

function erroDe(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${USER_A}', 'l9490-a@invariant.test') on conflict (id) do nothing;
  ` + semear(ORG_A, CT_A, "a") + semear(ORG_B, CT_B, "b") + `
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_A}', '${ORG_A}', 'manager', now()) on conflict do nothing;
    insert into public.links_de_saida (id, organization_id, codigo, destino_url, rotulo, contact_id) values
      ('${LINK_A}', '${ORG_A}', 'L9490AAAAA', 'https://loja.exemplo/previa/ana?cupom=X', 'bf', '${CT_A}'),
      ('${LINK_B}', '${ORG_B}', 'L9490BBBBB', 'https://loja.exemplo/b', null, '${CT_B}')
    on conflict (id) do nothing;
    insert into public.valores_personalizados (organization_id, chave, valor) values
      ('${ORG_A}', 'pix', 'pix-a'), ('${ORG_B}', 'pix', 'pix-b')
    on conflict do nothing;
  `);
});

afterAll(() => {
  sql(`delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');`);
});

describe("isolamento e escrita só do servidor", () => {
  it("A lê o seu e não o de B, nas três tabelas", () => {
    expect(countAs(USER_A, `select count(*) from public.links_de_saida where organization_id = '${ORG_A}'`)).toBe(1);
    expect(countAs(USER_A, `select count(*) from public.links_de_saida where organization_id = '${ORG_B}'`)).toBe(0);
    expect(countAs(USER_A, `select count(*) from public.valores_personalizados where organization_id = '${ORG_B}'`)).toBe(0);
    expect(
      countAs(USER_A, `select count(*) from public.cliques_de_links_de_saida where organization_id = '${ORG_B}'`),
    ).toBe(0);
  });

  it("a sessão (mesmo manager) não escreve: permission denied, não zero linhas", () => {
    const comoA = (dml: string) => `
      begin;
      select set_config('request.jwt.claims', '{"sub":"${USER_A}","role":"authenticated"}', true);
      set local role authenticated;
      ${dml};
      rollback;`;
    expect(erroDe(comoA(`insert into public.valores_personalizados (organization_id, chave, valor) values ('${ORG_A}', 'x1', 'y')`))).toMatch(
      /permission denied/,
    );
    expect(erroDe(comoA(`update public.links_de_saida set destino_url = 'https://evil.exemplo/' where organization_id = '${ORG_A}'`))).toMatch(
      /permission denied/,
    );
    expect(erroDe(comoA(`select public.fn_links_de_saida_resumo('${ORG_A}')`))).toMatch(/permission denied/);
    expect(
      erroDe(comoA(`select public.fn_registrar_clique_de_saida('${ORG_A}', '${LINK_A}', 'celular', null, null)`)),
    ).toMatch(/permission denied/);
  });
});

describe("o link — idempotente, único e seguro", () => {
  it("mesmo (contato, destino, rótulo) não cria segundo link; código repetido também não", () => {
    expect(
      erroDe(`insert into public.links_de_saida (organization_id, codigo, destino_url, rotulo, contact_id)
              values ('${ORG_A}', 'L9490ZZZZZ', 'https://loja.exemplo/previa/ana?cupom=X', 'bf', '${CT_A}')`),
    ).toMatch(/links_de_saida_idempotencia_uniq/);
    expect(
      erroDe(`insert into public.links_de_saida (organization_id, codigo, destino_url) values ('${ORG_B}', 'L9490AAAAA', 'https://x.exemplo/')`),
    ).toMatch(/links_de_saida_codigo_uniq/);
  });

  it("destino que não é http/https e contato de outra organização são recusados", () => {
    expect(
      erroDe(`insert into public.links_de_saida (organization_id, codigo, destino_url) values ('${ORG_A}', 'L9490JJJJJ', 'javascript:alert(1)')`),
    ).toMatch(/links_de_saida_destino_http/);
    expect(
      erroDe(`insert into public.links_de_saida (organization_id, codigo, destino_url, contact_id)
              values ('${ORG_A}', 'L9490CCCCC', 'https://x.exemplo/', '${CT_B}')`),
    ).toMatch(/links_de_saida_contato_org_fk/);
  });
});

describe("o clique", () => {
  it("só o link DA organização passada; gente com contato vira `link.clicked` pending; robô não conta", () => {
    expect(sql(`select coalesce(public.fn_registrar_clique_de_saida('${ORG_B}', '${LINK_A}', 'celular', null, null)::text, 'nulo');`).trim()).toBe(
      "nulo",
    );
    sql(`select public.fn_registrar_clique_de_saida('${ORG_A}', '${LINK_A}', 'celular', 'Chrome', '0123456789abcdef');`);
    sql(`select public.fn_registrar_clique_de_saida('${ORG_A}', '${LINK_A}', 'robo', 'WhatsApp', null);`);

    expect(
      sql(`select count(*) || '|' || string_agg(distinct status, ',') from public.event_log
            where organization_id = '${ORG_A}' and event_type = 'link.clicked' and entity_id = '${LINK_A}';`).trim(),
    ).toBe("1|pending");
    // O payload leva o que o consumidor da pontuação precisa, sem ir ao link.
    expect(
      sql(`select (payload->>'contact_id') || '|' || (payload->>'rotulo') from public.event_log
            where organization_id = '${ORG_A}' and event_type = 'link.clicked' and entity_id = '${LINK_A}';`).trim(),
    ).toBe(`${CT_A}|bf`);

    // Link SEM contato: ninguém a pontuar, o fato continua registro (`done`).
    const LINK_SEM = "9490aaaa-5555-4000-8000-0000000000ff";
    sql(`insert into public.links_de_saida (id, organization_id, codigo, destino_url)
           values ('${LINK_SEM}', '${ORG_A}', 'L9490SSSSS', 'https://loja.exemplo/geral') on conflict (id) do nothing;`);
    sql(`select public.fn_registrar_clique_de_saida('${ORG_A}', '${LINK_SEM}', 'computador', null, null);`);
    expect(
      sql(`select count(*) || '|' || string_agg(distinct status, ',') from public.event_log
            where organization_id = '${ORG_A}' and event_type = 'link.clicked' and entity_id = '${LINK_SEM}';`).trim(),
    ).toBe("1|done");
    expect(sql(`select cliques from public.fn_links_de_saida_resumo('${ORG_A}') where id = '${LINK_A}';`).trim()).toBe("1");
    expect(sql(`select count(*) from public.cliques_de_links_de_saida where link_id = '${LINK_A}';`).trim()).toBe("2");
  });
});

describe("LGPD — anonimizar o contato desvincula o link e os cliques", () => {
  it("contato some do link, destino fica só na origem, clique perde hash e navegador", () => {
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${CT_A}';`);
    expect(
      sql(`select coalesce(contact_id::text, 'nulo') || '|' || destino_url || '|' || anonimizado
             from public.links_de_saida where id = '${LINK_A}';`).trim(),
    ).toBe("nulo|https://loja.exemplo/|true");
    expect(
      sql(`select count(*) from public.cliques_de_links_de_saida
            where link_id = '${LINK_A}' and (ip_hash is not null or navegador is not null);`).trim(),
    ).toBe("0");
    // A rota pública procura `anonimizado = false`, e a função do clique recusa.
    expect(sql(`select coalesce(public.fn_registrar_clique_de_saida('${ORG_A}', '${LINK_A}', 'celular', null, null)::text, 'nulo');`).trim()).toBe(
      "nulo",
    );
    // O link de B não foi tocado.
    expect(sql(`select coalesce(contact_id::text, 'nulo') from public.links_de_saida where id = '${LINK_B}';`).trim()).toBe(CT_B);
  });
});

describe("valores personalizados", () => {
  it("chave no formato, única por organização (mas livre entre organizações), valor de 1 a 2000", () => {
    expect(erroDe(`insert into public.valores_personalizados (organization_id, chave, valor) values ('${ORG_A}', 'pix', 'outro')`)).toMatch(
      /valores_personalizados_org_chave_uniq/,
    );
    expect(erroDe(`insert into public.valores_personalizados (organization_id, chave, valor) values ('${ORG_A}', 'Pix-Loja', 'x')`)).toMatch(
      /valores_personalizados_chave_formato/,
    );
    expect(erroDe(`insert into public.valores_personalizados (organization_id, chave, valor) values ('${ORG_A}', 'vazio', '')`)).toMatch(
      /valores_personalizados_valor_tamanho/,
    );
    expect(
      erroDe(`insert into public.valores_personalizados (organization_id, chave, valor) values ('${ORG_A}', 'longo', repeat('x', 2001))`),
    ).toMatch(/valores_personalizados_valor_tamanho/);
  });
});
