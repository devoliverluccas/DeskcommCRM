import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_ORG, GOV_VIEWER, seedGov, sql } from "./gov-helpers";

/**
 * O LINK PÚBLICO DA PROPOSTA E QUEM DECIDIU (migration 9480).
 *
 * 1. `crm_proposal_links` só é ESCRITA pelo servidor: a sessão lê os links da
 *    própria organização e não cria, não edita, não revoga.
 * 2. `decided_via = 'cliente'` só o servidor grava: pelo PostgREST, um atendente
 *    não forja "o cliente aceitou" — nem criando, nem editando o rascunho, nem
 *    decidindo.
 * 3. Anonimizar o contato revoga os links das propostas DELE (e só dele): um
 *    link vivo mostraria nome, itens e valores de quem pediu para sumir.
 * 4. Os CHECKs: desconto e frete não negativos; decisão do cliente sem usuário.
 */
const ALVO = "cccccccc-3333-4000-8000-000000009481";
const VIZINHO = "cccccccc-3333-4000-8000-000000009482";
const P_ALVO = "cccccccc-9999-4000-8000-000000009481";
const P_VIZINHO = "cccccccc-9999-4000-8000-000000009482";
const P_RASCUNHO = "cccccccc-9999-4000-8000-000000009483";
const P_CRIADA = "cccccccc-9999-4000-8000-000000009484";
const L_ALVO = "cccccccc-8888-4000-8000-000000009481";
const L_VIZINHO = "cccccccc-8888-4000-8000-000000009482";

/** Linhas afetadas, ou "negado" quando GRANT, RLS ou a guarda recusam. */
function como(userId: string, dml: string): number | "negado" {
  try {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      with w as (${dml} returning 1) select count(*) from w;
    `);
    return Number(out.split("\n").pop());
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    if (/permission denied|row-level security|proposta_transicao_negada|proposta_envio_e_do_servidor/.test(stderr)) return "negado";
    throw err;
  }
}

function leComo(userId: string, consulta: string): string {
  return sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${consulta}
  `)
    .split("\n")
    .pop()!
    .trim();
}

function falhaComCheck(script: string): boolean {
  try {
    sql(script);
    return false;
  } catch (err) {
    return /check constraint/.test((err as { stderr?: string }).stderr ?? "");
  }
}

beforeAll(() => {
  seedGov();
  sql(`
    delete from public.crm_proposals where id in ('${P_ALVO}', '${P_VIZINHO}', '${P_RASCUNHO}', '${P_CRIADA}');
    delete from public.contacts where id in ('${ALVO}', '${VIZINHO}');
    insert into public.contacts (id, organization_id, name, display_name)
      values ('${ALVO}', '${GOV_ORG}', 'Joana Link', 'Joana Link'),
             ('${VIZINHO}', '${GOV_ORG}', 'Vizinho Link', 'Vizinho Link');
    insert into public.crm_proposals (id, organization_id, contact_id, titulo, status, numero, ano, sent_at, desconto_cents, frete_cents)
    values
      ('${P_ALVO}', '${GOV_ORG}', '${ALVO}', 'alvo', 'enviada', 9481, 2026, now(), 100, 200),
      ('${P_VIZINHO}', '${GOV_ORG}', '${VIZINHO}', 'vizinho', 'enviada', 9482, 2026, now(), 0, 0),
      ('${P_RASCUNHO}', '${GOV_ORG}', '${VIZINHO}', 'rascunho', 'rascunho', null, null, null, 0, 0);
    insert into public.crm_proposal_links (id, organization_id, proposal_id, token_hash, expira_em)
    values
      ('${L_ALVO}', '${GOV_ORG}', '${P_ALVO}', repeat('a', 64), now() + interval '10 days'),
      ('${L_VIZINHO}', '${GOV_ORG}', '${P_VIZINHO}', repeat('b', 64), now() + interval '10 days');
  `);
});

describe("crm_proposal_links: a sessão lê, só o servidor escreve", () => {
  it("o atendente da organização LÊ os links (controle positivo)", () => {
    expect(Number(leComo(GOV_AGENT_A, `select count(*) from public.crm_proposal_links where id in ('${L_ALVO}', '${L_VIZINHO}');`))).toBe(2);
  });

  it("⭐ nem atendente nem leitor criam link pelo PostgREST", () => {
    expect(
      como(GOV_AGENT_A, `insert into public.crm_proposal_links (organization_id, proposal_id, token_hash, expira_em)
        values ('${GOV_ORG}', '${P_ALVO}', repeat('c', 64), now() + interval '1 day')`),
    ).toBe("negado");
    expect(
      como(GOV_VIEWER, `insert into public.crm_proposal_links (organization_id, proposal_id, token_hash, expira_em)
        values ('${GOV_ORG}', '${P_ALVO}', repeat('d', 64), now() + interval '1 day')`),
    ).toBe("negado");
  });

  it("⭐ a sessão não estica a validade nem desrevoga", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposal_links set expira_em = now() + interval '1 year' where id = '${L_ALVO}'`)).toBe("negado");
  });

  it("link de proposta de outra organização é recusado pelo gatilho", () => {
    expect(() =>
      sql(`insert into public.crm_proposal_links (organization_id, proposal_id, token_hash, expira_em)
           values ((select id from public.organizations where id <> '${GOV_ORG}' limit 1), '${P_ALVO}', repeat('e', 64), now());`),
    ).toThrow();
  });
});

describe("decided_via = 'cliente' é do servidor", () => {
  it("⭐ criar proposta já 'decidida pelo cliente' é negado", () => {
    expect(
      como(GOV_AGENT_A, `insert into public.crm_proposals (id, organization_id, contact_id, titulo, status, decided_via)
        values ('${P_CRIADA}', '${GOV_ORG}', '${VIZINHO}', 'forjada', 'rascunho', 'cliente')`),
    ).toBe("negado");
  });

  it("⭐ editar o rascunho não troca decided_via", () => {
    expect(como(GOV_AGENT_A, `update public.crm_proposals set decided_via = 'cliente' where id = '${P_RASCUNHO}'`)).toBe("negado");
  });

  it("⭐ decidir pela sessão não grava 'cliente' — e decidir sem tocar nela passa (controle)", () => {
    expect(
      como(GOV_AGENT_A, `update public.crm_proposals set status = 'aceita', decided_at = now(), decided_via = 'cliente' where id = '${P_VIZINHO}'`),
    ).toBe("negado");
    expect(
      como(GOV_AGENT_A, `update public.crm_proposals set status = 'aceita', decided_at = now() where id = '${P_VIZINHO}'`),
    ).toBe(1);
    expect(sql(`select decided_via from public.crm_proposals where id = '${P_VIZINHO}';`)).toBe("equipe");
    sql(`update public.crm_proposals set status = 'enviada', decided_at = null where id = '${P_VIZINHO}';`);
  });

  it("o servidor grava 'cliente' sem usuário; com usuário o CHECK recusa", () => {
    expect(
      falhaComCheck(`update public.crm_proposals set decided_via = 'cliente', decided_by_user_id = '${GOV_AGENT_A}' where id = '${P_VIZINHO}';`),
    ).toBe(true);
    sql(`update public.crm_proposals set decided_via = 'cliente', decided_by_user_id = null where id = '${P_VIZINHO}';`);
    expect(sql(`select decided_via from public.crm_proposals where id = '${P_VIZINHO}';`)).toBe("cliente");
    sql(`update public.crm_proposals set decided_via = 'equipe' where id = '${P_VIZINHO}';`);
  });
});

describe("desconto e frete", () => {
  it("negativos são recusados pelo banco", () => {
    expect(falhaComCheck(`update public.crm_proposals set desconto_cents = -1 where id = '${P_ALVO}';`)).toBe(true);
    expect(falhaComCheck(`update public.crm_proposals set frete_cents = -1 where id = '${P_ALVO}';`)).toBe(true);
  });
});

describe("anonimizar o contato revoga os links dele", () => {
  it("ANTES: os dois links estão vivos (controle)", () => {
    expect(sql(`select count(*) from public.crm_proposal_links where id in ('${L_ALVO}', '${L_VIZINHO}') and revogado_em is null;`)).toBe("2");
  });

  it("⭐ a cascata LGPD revoga o link do contato anonimizado", () => {
    sql(`select public.fn_lgpd_cascade_redact_contact('${GOV_ORG}', '${ALVO}', null);`);
    expect(sql(`select (revogado_em is not null)::text from public.crm_proposal_links where id = '${L_ALVO}';`)).toBe("true");
  });

  it("o link do vizinho continua vivo", () => {
    expect(sql(`select (revogado_em is null)::text from public.crm_proposal_links where id = '${L_VIZINHO}';`)).toBe("true");
  });
});
