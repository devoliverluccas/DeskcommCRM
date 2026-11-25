import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";

/**
 * Perfis de tela (item 5.6, migration 9497): isolamento, escrita só pelo
 * servidor, FK composta (perfil só da MESMA organização do vínculo) e o
 * `on delete set null` que devolve o membro a "tudo que o papel permite".
 */
const ORG_A = "c0649700-0000-4000-8000-000000000001";
const ORG_B = "c0649700-0000-4000-8000-000000000002";
const ADMIN_A = "c0649700-1111-4000-8000-000000000001";
const AGENT_A = "c0649700-1111-4000-8000-000000000002";
const ADMIN_B = "c0649700-1111-4000-8000-000000000003";
const PERFIL_A = "c0649700-2222-4000-8000-000000000001";
const PERFIL_B = "c0649700-2222-4000-8000-000000000002";

beforeAll(() => {
  sql(`
    insert into auth.users(id,email) values
      ('${ADMIN_A}','perfil-admin-a@invariant.test'),
      ('${AGENT_A}','perfil-agente-a@invariant.test'),
      ('${ADMIN_B}','perfil-admin-b@invariant.test');
    insert into organizations(id,slug,legal_name,display_name) values
      ('${ORG_A}','perfis-9497-a','Perfis sintética A','Perfis A'),
      ('${ORG_B}','perfis-9497-b','Perfis sintética B','Perfis B');
    insert into user_organizations(user_id,organization_id,role,accepted_at) values
      ('${ADMIN_A}','${ORG_A}','admin',now()),
      ('${AGENT_A}','${ORG_A}','agent',now()),
      ('${ADMIN_B}','${ORG_B}','admin',now());
    insert into perfis_de_tela(id,organization_id,nome,destinos) values
      ('${PERFIL_A}','${ORG_A}','Vendas',array['/app/inbox','/app/kanban']),
      ('${PERFIL_B}','${ORG_B}','Recepção',array['/app/agenda']);
  `);
});

/** Executa como `authenticated` e devolve o erro do psql (ou "ok"). */
function tentarComo(userId: string, dml: string): string {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${dml};
    `);
    return "ok";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

describe("perfis_de_tela: isolamento e escrita", () => {
  it.each([[ADMIN_A, ORG_A, ORG_B], [AGENT_A, ORG_A, ORG_B], [ADMIN_B, ORG_B, ORG_A]])(
    "membro %s lê os perfis da própria organização e nenhum da outra",
    (user, propria, outra) => {
      expect(countAs(user, `select count(*) from perfis_de_tela where organization_id='${propria}'`)).toBe(1);
      expect(countAs(user, `select count(*) from perfis_de_tela where organization_id='${outra}'`)).toBe(0);
    },
  );

  it("a sessão não escreve, nem admin: a escrita é da rota, com service role", () => {
    expect(
      tentarComo(ADMIN_A, `insert into perfis_de_tela(organization_id,nome,destinos) values ('${ORG_A}','X',array['/app/inbox'])`),
    ).toMatch(/permission denied/);
    expect(tentarComo(ADMIN_A, `update perfis_de_tela set nome='Y' where id='${PERFIL_A}'`)).toMatch(/permission denied/);
    expect(tentarComo(ADMIN_A, `delete from perfis_de_tela where id='${PERFIL_A}'`)).toMatch(/permission denied/);
  });

  it("FK composta: o vínculo não aponta para perfil de outra organização", () => {
    const out = sql(`do $t$ begin
        update user_organizations set perfil_de_tela_id='${PERFIL_B}'
         where user_id='${AGENT_A}' and organization_id='${ORG_A}';
        raise exception 'perfil de outra organização foi aceito';
      exception when foreign_key_violation then null;
      end $t$;
      select 'recusado';`);
    expect(out.split("\n").at(-1)).toBe("recusado");
  });

  it("apagar o perfil devolve o membro a 'sem perfil'", () => {
    const out = sql(`
      insert into perfis_de_tela(id,organization_id,nome,destinos)
        values ('c0649700-2222-4000-8000-000000000009','${ORG_A}','Temporário',array['/app/inbox']);
      update user_organizations set perfil_de_tela_id='c0649700-2222-4000-8000-000000000009'
       where user_id='${AGENT_A}' and organization_id='${ORG_A}';
      delete from perfis_de_tela where id='c0649700-2222-4000-8000-000000000009';
      select coalesce(perfil_de_tela_id::text,'null') from user_organizations
       where user_id='${AGENT_A}' and organization_id='${ORG_A}';`);
    expect(out.split("\n").at(-1)).toBe("null");
  });

  it("nome repetido sem caixa e lista vazia são recusados pelo banco", () => {
    const out = sql(`do $t$ begin
        begin
          insert into perfis_de_tela(organization_id,nome,destinos) values ('${ORG_A}',' vendas ',array['/app/inbox']);
          raise exception 'nome repetido aceito';
        exception when unique_violation then null; end;
        begin
          insert into perfis_de_tela(organization_id,nome,destinos) values ('${ORG_A}','Vazio','{}');
          raise exception 'lista vazia aceita';
        exception when check_violation then null; end;
      end $t$;
      select 'recusados';`);
    expect(out.split("\n").at(-1)).toBe("recusados");
  });
});
