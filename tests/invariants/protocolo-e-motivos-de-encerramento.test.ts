import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

/**
 * PROTOCOLO POR ATENDIMENTO E MOTIVOS DE ENCERRAMENTO (migration 9482).
 *
 * Mede no Postgres o que o TypeScript não alcança:
 *
 *   1. o protocolo nasce no BANCO para toda demanda, ignorando o que a sessão
 *      mandar, no formato `AAAAMMDD-NNNNNN`, com sequência por organização e
 *      ano, e é IMUTÁVEL depois de gravado;
 *   2. o contador do protocolo é só do servidor (permission denied, não zero
 *      linhas) — a sessão não adianta nem recua a numeração;
 *   3. `motivos_de_encerramento` isola por organização (JWT de A não lê, não
 *      altera nem apaga o de B) e a sessão NÃO escreve (escrita é da rota, com
 *      o papel conferido);
 *   4. a demanda não aponta motivo de outra organização;
 *   5. `fn_demanda_aplicar_motivo` grava o motivo e encerra a demanda aberta com
 *      o desfecho da categoria; motivo inativo é recusado; a sessão não executa.
 *
 * Em `rls-completude-varredura.test.ts`, `motivos_de_encerramento` e
 * `demanda_protocolo_contadores` entram em PROVA_PROPRIA citando este arquivo.
 */

const ORG_A = "9482aaaa-0000-4000-8000-000000000001";
const ORG_B = "9482bbbb-0000-4000-8000-000000000002";
const USER_A = "9482aaaa-1111-4000-8000-000000000001";
const USER_B = "9482bbbb-1111-4000-8000-000000000002";
const CT_A = "9482aaaa-3333-4000-8000-000000000001";
const CT_B = "9482bbbb-3333-4000-8000-000000000002";
const MOT_A = "9482aaaa-6666-4000-8000-000000000001";
const MOT_A_INATIVO = "9482aaaa-6666-4000-8000-000000000002";
const MOT_B = "9482bbbb-6666-4000-8000-000000000002";

function semear(org: string, user: string, ct: string, tag: string): string {
  return `
    insert into auth.users (id, email) values ('${user}', 'p9482-${tag}@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'p9482-inv-${tag}', 'Protocolo ${tag}', 'P ${tag}') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${user}', '${org}', 'agent', now()) on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name)
      values ('${ct}', '${org}', 'Contato protocolo ${tag}') on conflict (id) do nothing;
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

function novaDemanda(org: string, ct: string, abertaEm: string, protocolo = "null"): string {
  return sql(`
    insert into public.demandas (organization_id, contact_id, origem, aberta_em, protocolo)
      values ('${org}', '${ct}', 'manual', '${abertaEm}', ${protocolo})
    returning id || '|' || protocolo;
  `).split("\n")[0]!;
}

beforeAll(() => {
  sql(semear(ORG_A, USER_A, CT_A, "a") + semear(ORG_B, USER_B, CT_B, "b"));
  sql(`
    insert into public.motivos_de_encerramento (id, organization_id, nome, categoria, ativo) values
      ('${MOT_A}', '${ORG_A}', 'Spam', 'nao_procede', true),
      ('${MOT_A_INATIVO}', '${ORG_A}', 'Antigo', 'resolvida', false),
      ('${MOT_B}', '${ORG_B}', 'Venda realizada', 'convertida', true)
    on conflict (id) do nothing;
  `);
});

afterAll(() => {
  sql(`delete from public.organizations where id in ('${ORG_A}', '${ORG_B}');`);
});

describe("protocolo — gerado no banco, por organização e ano", () => {
  it("formato AAAAMMDD-NNNNNN, dia da abertura em UTC, e o protocolo mandado de fora é ignorado", () => {
    const [, p] = novaDemanda(ORG_A, CT_A, "2031-03-02T23:30:00-03:00", "'FORJADO'").split("|");
    // 23:30 em -03 é 02:30 do dia 3 em UTC.
    expect(p).toMatch(/^20310303-\d{6}$/);
  });

  it("sequência cresce por organização; a de B não anda com a de A", () => {
    const a1 = novaDemanda(ORG_A, CT_A, "2032-05-01T10:00:00Z").split("|")[1]!;
    const a2 = novaDemanda(ORG_A, CT_A, "2032-05-02T10:00:00Z").split("|")[1]!;
    const b1 = novaDemanda(ORG_B, CT_B, "2032-05-01T10:00:00Z").split("|")[1]!;
    const n = (p: string) => Number(p.split("-")[1]);
    expect(n(a2)).toBe(n(a1) + 1);
    expect(n(b1)).toBe(1);
  });

  it("ano novo recomeça a sequência", () => {
    const p = novaDemanda(ORG_B, CT_B, "2033-01-01T00:00:01Z").split("|")[1]!;
    expect(p).toBe("20330101-000001");
  });

  it("é imutável: UPDATE não troca nem apaga", () => {
    const [id, p] = novaDemanda(ORG_A, CT_A, "2034-07-07T12:00:00Z").split("|");
    sql(`update public.demandas set protocolo = 'TROCADO' where id = '${id}';`);
    sql(`update public.demandas set protocolo = null where id = '${id}';`);
    expect(sql(`select protocolo from public.demandas where id = '${id}';`)).toBe(p);
  });

  it("apagar a demanda não libera o número", () => {
    const [id, p] = novaDemanda(ORG_B, CT_B, "2035-02-02T12:00:00Z").split("|");
    sql(`delete from public.demandas where id = '${id}';`);
    const [, seguinte] = novaDemanda(ORG_B, CT_B, "2035-02-03T12:00:00Z").split("|");
    expect(Number(seguinte!.split("-")[1])).toBe(Number(p!.split("-")[1]) + 1);
  });

  it("único por organização (índice) e NOT NULL", () => {
    expect(
      sql(`select count(*) from pg_indexes where schemaname = 'public' and indexname = 'demandas_org_protocolo_uniq';`),
    ).toBe("1");
    expect(
      sql(`select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'demandas' and column_name = 'protocolo';`),
    ).toBe("NO");
  });
});

describe("o contador do protocolo é só do servidor", () => {
  it.each(["authenticated", "anon"])("%s é barrado (permission denied, não zero linhas)", (papel) => {
    const erro = erroDe(`set role ${papel};\nselect * from public.demanda_protocolo_contadores limit 1;`);
    expect(erro).toContain("permission denied");
    const escrita = erroDe(
      `set role ${papel};\nupdate public.demanda_protocolo_contadores set ultimo = 0;`,
    );
    expect(escrita).toContain("permission denied");
  });

  it("RLS ligada", () => {
    expect(
      sql(`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = 'demanda_protocolo_contadores';`),
    ).toBe("t");
  });
});

describe("motivos_de_encerramento — isolamento por organização", () => {
  it("controle positivo: cada usuário lê os da própria organização", () => {
    expect(countAs(USER_A, `select count(*) from public.motivos_de_encerramento where organization_id = '${ORG_A}';`)).toBe(2);
    expect(countAs(USER_B, `select count(*) from public.motivos_de_encerramento where organization_id = '${ORG_B}';`)).toBe(1);
  });

  it("A não lê nada de B, e B nada de A", () => {
    expect(countAs(USER_A, `select count(*) from public.motivos_de_encerramento where organization_id = '${ORG_B}';`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.motivos_de_encerramento where organization_id = '${ORG_A}';`)).toBe(0);
  });

  it("a sessão não escreve — nem na própria organização (a rota é quem confere o papel)", () => {
    const comoA = (dml: string) =>
      erroDe(
        `set role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);\n${dml};`,
      );
    expect(comoA(`update public.motivos_de_encerramento set nome = nome where organization_id = '${ORG_A}'`)).toContain("permission denied");
    expect(comoA(`delete from public.motivos_de_encerramento where organization_id = '${ORG_A}'`)).toContain("permission denied");
    expect(
      comoA(`insert into public.motivos_de_encerramento (organization_id, nome, categoria) values ('${ORG_A}', 'Novo', 'resolvida')`),
    ).toContain("permission denied");
    expect(countAs(USER_A, `select count(*) from public.motivos_de_encerramento where organization_id = '${ORG_A}';`)).toBe(2);
  });

  it("nome único por organização sem diferenciar maiúsculas; categoria fora do vocabulário é recusada", () => {
    expect(
      erroDe(`insert into public.motivos_de_encerramento (organization_id, nome, categoria) values ('${ORG_A}', 'SPAM', 'nao_procede');`),
    ).toContain("motivos_de_encerramento_org_nome_uniq");
    expect(
      erroDe(`insert into public.motivos_de_encerramento (organization_id, nome, categoria) values ('${ORG_A}', 'Outro', 'ganhou');`),
    ).toContain("motivos_de_encerramento_categoria_check");
    // O mesmo nome em OUTRA organização é legítimo.
    expect(
      erroDe(`insert into public.motivos_de_encerramento (organization_id, nome, categoria) values ('${ORG_B}', 'Spam', 'nao_procede');`),
    ).toBeNull();
  });
});

describe("a demanda e o motivo", () => {
  it("demanda da A não aponta motivo da B", () => {
    const [id] = novaDemanda(ORG_A, CT_A, "2036-01-10T10:00:00Z").split("|");
    expect(
      erroDe(`update public.demandas set motivo_de_encerramento_id = '${MOT_B}' where id = '${id}';`),
    ).toContain("motivo_de_outra_organizacao");
  });

  it("fn_demanda_aplicar_motivo grava o motivo e encerra a demanda aberta com o desfecho da categoria", () => {
    const [id] = novaDemanda(ORG_A, CT_A, "2036-02-10T10:00:00Z").split("|");
    sql(`select public.fn_demanda_aplicar_motivo('${ORG_A}', '${id}', '${MOT_A}', null);`);
    expect(
      sql(`select motivo_de_encerramento_id || '|' || desfecho || '|' || estado || '|' || (fechada_em is not null) from public.demandas where id = '${id}';`),
    ).toBe(`${MOT_A}|nao_procede|encerrada|true`);
  });

  it("demanda já encerrada: grava o motivo e NÃO troca o desfecho", () => {
    const [id] = novaDemanda(ORG_A, CT_A, "2036-03-10T10:00:00Z").split("|");
    sql(`select public.fn_demanda_encerrar('${ORG_A}', '${id}', (select revision from public.demandas where id = '${id}'), 'resolvida', null);`);
    sql(`select public.fn_demanda_aplicar_motivo('${ORG_A}', '${id}', '${MOT_A}', null);`);
    expect(sql(`select motivo_de_encerramento_id || '|' || desfecho from public.demandas where id = '${id}';`)).toBe(
      `${MOT_A}|resolvida`,
    );
  });

  it("motivo inativo ou de outra organização: recusado, e a demanda fica como estava", () => {
    const [id] = novaDemanda(ORG_A, CT_A, "2036-04-10T10:00:00Z").split("|");
    expect(erroDe(`select public.fn_demanda_aplicar_motivo('${ORG_A}', '${id}', '${MOT_A_INATIVO}', null);`)).toContain("motivo_invalido");
    expect(erroDe(`select public.fn_demanda_aplicar_motivo('${ORG_A}', '${id}', '${MOT_B}', null);`)).toContain("motivo_invalido");
    expect(sql(`select coalesce(motivo_de_encerramento_id::text, 'nulo') || '|' || (fechada_em is null) from public.demandas where id = '${id}';`)).toBe(
      "nulo|true",
    );
  });

  it("a sessão não executa a função (só service_role)", () => {
    expect(
      erroDe(`set role authenticated;\nselect public.fn_demanda_aplicar_motivo('${ORG_A}', gen_random_uuid(), '${MOT_A}', null);`),
    ).toContain("permission denied");
  });
});
