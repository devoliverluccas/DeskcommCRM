import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * Item 3.3 — SLA DO ATENDIMENTO (migration 9483).
 *
 * Lados medidos:
 *   a. pela sessão (`authenticated`, JWT simulado), nem o gestor grava
 *      `sla_ignorado_em` — quem grava é a rota, pelo service role (42501);
 *   b. controle: uma escrita comum da sessão na mesma conversa passa;
 *   c. reabrir (encerrada → aberta) zera o ignorado, inclusive pela sessão;
 *   d. `fn_sla_primeiras_respostas` devolve o atendimento com a primeira
 *      resposta depois da primeira mensagem do cliente, e só da organização pedida;
 *   e. `anon` não executa a função; `authenticated` executa.
 */

const ORG_A = "94839483-aaaa-4000-8000-000000000001";
const ORG_B = "94839483-bbbb-4000-8000-000000000001";
const GERENTE = "94839483-1111-4000-8000-000000000001";
const CANAL_A = "94839483-c2a0-4000-8000-000000000001";
const CONTATO = "94839483-c001-4000-8000-000000000001";
const CONVERSA = "94839483-c0a0-4000-8000-000000000001";
const MSG_IN_1 = "94839483-3e50-4000-8000-000000000001";
const MSG_IN_2 = "94839483-3e50-4000-8000-000000000002";
const MSG_OUT = "94839483-3e50-4000-8000-000000000003";

function comoGerente(consulta: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${GERENTE}"}', false);
    ${consulta}
  `);
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${GERENTE}', 'gerente@9483.test') on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'sla-a-9483', 'SLA A', 'SLA A'),
      ('${ORG_B}', 'sla-b-9483', 'SLA B', 'SLA B')
    on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${GERENTE}', '${ORG_A}', 'manager', now())
    on conflict do nothing;

    do $canal$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${CANAL_A}', '${ORG_A}', 'sla-a-9483', '\\x00'::bytea);
    exception when unique_violation then null; end $canal$;

    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO}', '${ORG_A}', 'Contato do SLA')
    on conflict (id) do nothing;

    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
    values ('${CONVERSA}', '${ORG_A}', '${CONTATO}', '${CANAL_A}', 'open')
    on conflict (id) do nothing;

    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, status, sent_at, service_revision)
    values
      ('${MSG_IN_1}', '${ORG_A}', '${CONVERSA}', '${CANAL_A}', '${CONTATO}', 'text', 'inbound', 'oi', 'delivered', '2026-11-20T10:00:00Z',
        (select service_revision from public.conversations where id = '${CONVERSA}')),
      ('${MSG_IN_2}', '${ORG_A}', '${CONVERSA}', '${CANAL_A}', '${CONTATO}', 'text', 'inbound', 'alguém?', 'delivered', '2026-11-20T10:05:00Z',
        (select service_revision from public.conversations where id = '${CONVERSA}')),
      ('${MSG_OUT}', '${ORG_A}', '${CONVERSA}', '${CANAL_A}', '${CONTATO}', 'text', 'outbound', 'olá!', 'sent', '2026-11-20T10:12:00Z',
        (select service_revision from public.conversations where id = '${CONVERSA}'))
    on conflict (id) do nothing;
  `);
});

afterAll(() => {
  sql(`
    delete from public.messages where id in ('${MSG_IN_1}', '${MSG_IN_2}', '${MSG_OUT}');
    delete from public.conversations where id = '${CONVERSA}';
  `);
});

describe("3.3 — SLA do atendimento (migration 9483)", () => {
  it("(a) pela sessão, nem o gestor grava o ignorado (42501)", () => {
    expect(() =>
      comoGerente(`update public.conversations set sla_ignorado_em = now() where id = '${CONVERSA}';`),
    ).toThrow(/sla_ignorado_e_do_servidor/);
  });

  it("(b) controle: escrita comum da sessão na mesma conversa passa", () => {
    comoGerente(`update public.conversations set tags = tags where id = '${CONVERSA}';`);
    expect(lastLine(sql(`select (sla_ignorado_em is null)::text from public.conversations where id = '${CONVERSA}';`))).toBe(
      "true",
    );
  });

  it("(c) reabrir zera o ignorado gravado pelo servidor", () => {
    sql(`update public.conversations set status = 'closed' where id = '${CONVERSA}';`);
    sql(`update public.conversations set sla_ignorado_em = now(), sla_ignorado_por = '${GERENTE}' where id = '${CONVERSA}';`);
    expect(lastLine(sql(`select (sla_ignorado_em is not null)::text from public.conversations where id = '${CONVERSA}';`))).toBe(
      "true",
    );
    comoGerente(`update public.conversations set status = 'open' where id = '${CONVERSA}';`);
    expect(
      lastLine(
        sql(`select (sla_ignorado_em is null and sla_ignorado_por is null)::text from public.conversations where id = '${CONVERSA}';`),
      ),
    ).toBe("true");
  });

  it("(d) a leitura do relatório: primeira mensagem do cliente e primeira resposta, só da organização pedida", () => {
    const linha = lastLine(
      sql(`
        select to_char(inicio at time zone 'UTC', 'HH24:MI') || '|' || to_char(respondida_em at time zone 'UTC', 'HH24:MI')
          from public.fn_sla_primeiras_respostas('${ORG_A}', '2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')
         where conversation_id = '${CONVERSA}';
      `),
    );
    expect(linha).toBe("10:00|10:12");
    const daOutra = lastLine(
      sql(`
        select count(*) from public.fn_sla_primeiras_respostas('${ORG_B}', '2026-11-20T00:00:00Z', '2026-11-21T00:00:00Z')
         where conversation_id = '${CONVERSA}';
      `),
    );
    expect(daOutra).toBe("0");
  });

  it("(e) anon não executa a função; authenticated executa", () => {
    const privilegios = lastLine(
      sql(`
        select has_function_privilege('anon', 'public.fn_sla_primeiras_respostas(uuid,timestamptz,timestamptz)', 'execute')::text
          || '|' ||
          has_function_privilege('authenticated', 'public.fn_sla_primeiras_respostas(uuid,timestamptz,timestamptz)', 'execute')::text;
      `),
    );
    expect(privilegios).toBe("false|true");
  });
});
