import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * Item 3.7 — CONVERSA PRIVADA (migration 9485).
 *
 * Privada = só quem é responsável pela conversa e gestor/administrador leem. A
 * regra é uma policy RESTRITIVA de SELECT em `conversations`; `messages` herda
 * pela própria policy (`exists` em `conversations`, que roda sob a RLS de quem
 * lê). O cenário põe a organização em `visibility_mode = 'all'` de propósito:
 * é o modo em que o atendente NÃO responsável enxergaria a conversa sem a regra
 * nova — o controle positivo é a conversa pública, que ele continua vendo.
 *
 * Lados medidos, todos como `authenticated` com o JWT simulado (o caminho do
 * PostgREST):
 *   a. atendente não responsável não vê a conversa nem as mensagens dela;
 *   b. o responsável vê as duas;
 *   c. gestor vê; visualizador (viewer) NÃO vê;
 *   d. outra organização não vê (nem o gestor dela);
 *   e. a sobrecarga `fn_can_view_conversation(org, responsável, privada)`
 *      concorda com a policy pessoa por pessoa;
 *   f. pela sessão, quem não é responsável nem gestor não marca nem desmarca;
 *   g. encerrar zera `pendente_em` (gatilho, sem HTTP).
 */

const ORG_A = "94859485-aaaa-4000-8000-000000000001";
const ORG_B = "94859485-bbbb-4000-8000-000000000001";

const RESPONSAVEL = "94859485-1111-4000-8000-000000000001"; // agent, dono da privada
const COLEGA = "94859485-1111-4000-8000-000000000002"; // agent, não responsável
const GERENTE = "94859485-1111-4000-8000-000000000003"; // manager
const OBSERVADOR = "94859485-1111-4000-8000-000000000004"; // viewer
const GERENTE_B = "94859485-1112-4000-8000-000000000001"; // manager da outra organização

const CANAL_A = "94859485-c2a0-4000-8000-000000000001";
const CONTATO_PRIVADA = "94859485-c001-4000-8000-000000000001";
const CONTATO_PUBLICA = "94859485-c001-4000-8000-000000000002";

const PRIVADA = "94859485-c0a0-4000-8000-000000000001";
const PUBLICA = "94859485-c0a0-4000-8000-000000000002";
const MSG_PRIVADA = "94859485-3e50-4000-8000-000000000001";
const MSG_PUBLICA = "94859485-3e50-4000-8000-000000000002";

const PESSOAS = [RESPONSAVEL, COLEGA, GERENTE, OBSERVADOR, GERENTE_B];

function comoUsuario(usuario: string, consulta: string): string {
  return lastLine(
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${usuario}"}', false);
      ${consulta}
    `),
  );
}

function ve(usuario: string, tabela: "conversations" | "messages", id: string): boolean {
  return Number(comoUsuario(usuario, `select count(*) from public.${tabela} where id = '${id}';`)) === 1;
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${RESPONSAVEL}', 'responsavel@9485.test'),
      ('${COLEGA}',      'colega@9485.test'),
      ('${GERENTE}',     'gerente@9485.test'),
      ('${OBSERVADOR}',  'observador@9485.test'),
      ('${GERENTE_B}',   'gerente-b@9485.test')
    on conflict (id) do nothing;

    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG_A}', 'privada-a-9485', 'Privada A', 'Privada A', '{"visibility_mode":"all"}'::jsonb),
      ('${ORG_B}', 'privada-b-9485', 'Privada B', 'Privada B', '{"visibility_mode":"all"}'::jsonb)
    on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${RESPONSAVEL}', '${ORG_A}', 'agent',   now()),
      ('${COLEGA}',      '${ORG_A}', 'agent',   now()),
      ('${GERENTE}',     '${ORG_A}', 'manager', now()),
      ('${OBSERVADOR}',  '${ORG_A}', 'viewer',  now()),
      ('${GERENTE_B}',   '${ORG_B}', 'manager', now())
    on conflict do nothing;

    do $canal$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${CANAL_A}', '${ORG_A}', 'privada-a-9485', '\\x00'::bytea);
    exception when unique_violation then null; end $canal$;

    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_PRIVADA}', '${ORG_A}', 'Contato da conversa privada'),
      ('${CONTATO_PUBLICA}', '${ORG_A}', 'Contato da conversa publica')
    on conflict (id) do nothing;

    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id, assigned_at, privada, privada_por, pendente_em)
    values
      ('${PRIVADA}', '${ORG_A}', '${CONTATO_PRIVADA}', '${CANAL_A}', 'claimed', '${RESPONSAVEL}', now(), true, '${RESPONSAVEL}', now()),
      ('${PUBLICA}', '${ORG_A}', '${CONTATO_PUBLICA}', '${CANAL_A}', 'claimed', '${RESPONSAVEL}', now(), false, null, null)
    on conflict (id) do nothing;

    insert into public.messages
      (id, organization_id, conversation_id, channel_session_id, contact_id, type, direction, body, status)
    values
      ('${MSG_PRIVADA}', '${ORG_A}', '${PRIVADA}', '${CANAL_A}', '${CONTATO_PRIVADA}', 'text', 'inbound', 'mensagem da conversa privada', 'delivered'),
      ('${MSG_PUBLICA}', '${ORG_A}', '${PUBLICA}', '${CANAL_A}', '${CONTATO_PUBLICA}', 'text', 'inbound', 'mensagem da conversa publica', 'delivered')
    on conflict (id) do nothing;
  `);
});

afterAll(() => {
  // Rodável também contra o banco local de desenvolvimento: não deixa rastro.
  sql(`
    delete from public.messages where id in ('${MSG_PRIVADA}', '${MSG_PUBLICA}');
    delete from public.conversations where id in ('${PRIVADA}', '${PUBLICA}');
  `);
});

describe("3.7 — conversa privada (migration 9485)", () => {
  it("controle positivo: em visibility_mode 'all' o colega vê a conversa PÚBLICA e as mensagens dela", () => {
    expect(ve(COLEGA, "conversations", PUBLICA)).toBe(true);
    expect(ve(COLEGA, "messages", MSG_PUBLICA)).toBe(true);
  });

  it("(a) o atendente não responsável não vê a conversa privada nem as mensagens", () => {
    expect(ve(COLEGA, "conversations", PRIVADA)).toBe(false);
    expect(ve(COLEGA, "messages", MSG_PRIVADA)).toBe(false);
  });

  it("(b) o responsável vê a conversa e as mensagens", () => {
    expect(ve(RESPONSAVEL, "conversations", PRIVADA)).toBe(true);
    expect(ve(RESPONSAVEL, "messages", MSG_PRIVADA)).toBe(true);
  });

  it("(c) o gestor vê; o visualizador não", () => {
    expect(ve(GERENTE, "conversations", PRIVADA)).toBe(true);
    expect(ve(GERENTE, "messages", MSG_PRIVADA)).toBe(true);
    expect(ve(OBSERVADOR, "conversations", PRIVADA)).toBe(false);
    expect(ve(OBSERVADOR, "messages", MSG_PRIVADA)).toBe(false);
    expect(ve(OBSERVADOR, "conversations", PUBLICA)).toBe(true);
  });

  it("(d) outra organização não vê, nem o gestor dela", () => {
    expect(ve(GERENTE_B, "conversations", PRIVADA)).toBe(false);
    expect(ve(GERENTE_B, "messages", MSG_PRIVADA)).toBe(false);
  });

  it("(e) a escada por linha de 3 argumentos concorda com a policy, pessoa por pessoa", () => {
    for (const pessoa of PESSOAS) {
      const pelaFuncao =
        comoUsuario(
          pessoa,
          `select public.fn_can_view_conversation('${ORG_A}', '${RESPONSAVEL}', true)::text;`,
        ) === "true";
      expect([pessoa, ve(pessoa, "conversations", PRIVADA)]).toEqual([pessoa, pelaFuncao]);
    }
    // A de 2 argumentos não mudou: para o colega em modo 'all', continua true.
    expect(
      comoUsuario(COLEGA, `select public.fn_can_view_conversation('${ORG_A}', '${RESPONSAVEL}')::text;`),
    ).toBe("true");
  });

  it("(f) pela sessão, o colega não tira a privacidade da conversa pública de outro (recusa 42501)", () => {
    // A pública ele VÊ (controle): o que se recusa é a troca de `privada`.
    expect(() =>
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${COLEGA}"}', false);
        update public.conversations set privada = true where id = '${PUBLICA}';
      `),
    ).toThrow(/privada_sem_permissao/);
    const depois = lastLine(sql(`select privada::text from public.conversations where id = '${PUBLICA}';`));
    expect(depois).toBe("false");
  });

  it("(g) encerrar a conversa zera o pendente", () => {
    const antes = lastLine(sql(`select (pendente_em is not null)::text from public.conversations where id = '${PRIVADA}';`));
    expect(antes).toBe("true");
    sql(`update public.conversations set status = 'closed' where id = '${PRIVADA}';`);
    const depois = lastLine(sql(`select (pendente_em is null)::text from public.conversations where id = '${PRIVADA}';`));
    expect(depois).toBe("true");
  });
});
