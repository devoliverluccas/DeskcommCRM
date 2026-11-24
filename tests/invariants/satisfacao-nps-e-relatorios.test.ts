import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_SESSION,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * 3.4 / 3.6 — OS INVARIANTES DE BANCO DA MIGRATION 9484.
 *
 *   1. A RÉGUA É DO PEDIDO: `escala` nasce `csat_1_5`, aceita só as duas
 *      réguas, e a nota vale na régua do PRÓPRIO pedido — 0 e 10 no NPS, 1 a 5
 *      no CSAT (o 9 de 1 a 5 continua recusado, como no #4023).
 *   2. O RESUMO SEPARA AS RÉGUAS: `por_escala` conta cada uma, e a `media` de
 *      cima é só do CSAT (média de 1–5 com 0–10 não mede nada).
 *   3. AS LEITURAS DOS RELATÓRIOS: `fn_relatorio_atendimentos` é INVOKER e
 *      responde a `authenticated` dentro da RLS dele (o agent conta menos que o
 *      manager, ou igual — nunca mais); `anon` não executa nenhuma das duas, e
 *      `fn_relatorio_atribuicao` é só de `service_role`.
 *
 * Roda com o `baseline.sql` reaplicado pelo `scripts/test-db.sh` — então só
 * passa depois que o bloco `.redesign/baseline-9484.sql` entrar no baseline.
 */

const CONTATO = "94840000-3333-4000-8000-000000000001";
const CONVERSA = "94840000-4444-4000-8000-000000000001";

function resumo(): Record<string, unknown> {
  return JSON.parse(sql(`select public.fn_satisfacao_resumo('${GOV_ORG}')::text;`)) as Record<string, unknown>;
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name)
      values ('${CONTATO}', '${GOV_ORG}', 'Contato NPS 9484') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${GOV_ORG}', '${CONTATO}', '${GOV_SESSION}', 'closed')
      on conflict (id) do nothing;
    delete from public.satisfacao_do_atendimento where conversation_id = '${CONVERSA}';
  `);
});

const inserir = (nota: number, escala?: string) => `
  insert into public.satisfacao_do_atendimento
    (organization_id, conversation_id, contact_id, status, nota, respondido_em, expira_em${escala ? ", escala" : ""})
  values ('${GOV_ORG}', '${CONVERSA}', '${CONTATO}', 'respondida', ${nota}, now(), now() + interval '1 day'${
    escala ? `, '${escala}'` : ""
  });`;

describe("9484 — a régua do pedido", () => {
  it("nasce csat_1_5 e recusa régua fora do vocabulário", () => {
    expect(
      sql(`select column_default from information_schema.columns
            where table_name = 'satisfacao_do_atendimento' and column_name = 'escala';`),
    ).toContain("csat_1_5");
    expect(() => sql(inserir(3, "estrelas"))).toThrow();
  });

  it("NPS aceita 0 e 10; CSAT recusa 0 e 9; NPS recusa 11", () => {
    sql(inserir(0, "nps_0_10"));
    sql(inserir(10, "nps_0_10"));
    sql(inserir(8, "nps_0_10"));
    expect(() => sql(inserir(0))).toThrow();
    expect(() => sql(inserir(9, "csat_1_5"))).toThrow();
    expect(() => sql(inserir(11, "nps_0_10"))).toThrow();
    sql(inserir(4));
  });

  it("o resumo separa as réguas e a média de cima é só do CSAT", () => {
    const r = resumo();
    const porEscala = r.por_escala as Record<string, { respostas: number; notas: Record<string, number> }>;
    expect(Number(porEscala.nps_0_10?.respostas)).toBeGreaterThanOrEqual(3);
    expect(Number(porEscala.nps_0_10?.notas["0"])).toBeGreaterThanOrEqual(1);
    expect(Number(porEscala.nps_0_10?.notas["10"])).toBeGreaterThanOrEqual(1);
    // As notas do NPS (0, 8, 10) não puxam a média do CSAT.
    const mediaCsat = Number(r.media);
    expect(mediaCsat).toBeGreaterThanOrEqual(1);
    expect(mediaCsat).toBeLessThanOrEqual(5);
    expect((r.notas as Record<string, number>)["10"]).toBeUndefined();
  });
});

describe("9484 — as leituras dos relatórios", () => {
  it("anon não executa nenhuma; atribuição é só service_role", () => {
    const privilegios = sql(`
      select has_function_privilege('anon', 'public.fn_relatorio_atendimentos(uuid,timestamptz,timestamptz,text)', 'execute'),
             has_function_privilege('anon', 'public.fn_relatorio_atribuicao(uuid,timestamptz,timestamptz)', 'execute'),
             has_function_privilege('authenticated', 'public.fn_relatorio_atribuicao(uuid,timestamptz,timestamptz)', 'execute'),
             has_function_privilege('authenticated', 'public.fn_relatorio_atendimentos(uuid,timestamptz,timestamptz,text)', 'execute'),
             has_function_privilege('service_role', 'public.fn_relatorio_atribuicao(uuid,timestamptz,timestamptz)', 'execute');
    `);
    expect(privilegios).toBe("f|f|f|t|t");
  });

  it("atendimentos é INVOKER: o agent nunca conta mais que o manager", () => {
    const consulta = (`select (public.fn_relatorio_atendimentos('${GOV_ORG}', now() - interval '3650 days', now() + interval '1 day', 'America/Sao_Paulo')->>'abertos')::int;`);
    const comoManager = countAs(GOV_MANAGER, consulta);
    const comoAgent = countAs(GOV_AGENT_A, consulta);
    expect(comoManager).toBeGreaterThan(0);
    expect(comoAgent).toBeLessThanOrEqual(comoManager);
    expect(
      sql(`select prosecdef from pg_proc where proname = 'fn_relatorio_atendimentos';`),
    ).toBe("f");
  });
});
