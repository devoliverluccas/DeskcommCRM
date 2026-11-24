/**
 * PONTUAÇÃO POR REGRA (fase 4, 4.5, migration 9492) — o que só o banco garante.
 *
 *   - isolamento: a sessão de uma organização não vê regra nem extrato da outra,
 *     e a soma (`fn_pontuacao_do_contato`, security invoker) dá zero para contato
 *     alheio;
 *   - a sessão só LÊ: nem INSERT nas tabelas, nem a porta `fn_pontuacao_registrar`;
 *   - a porta confere a organização da regra e do contato, ignora o fato repetido
 *     (chave única) e respeita o teto por contato cortando a última parcela;
 *   - o gatilho de `crm_lead_activities` vira `proposal.sent`/`proposal.accepted`
 *     no `event_log` (e só esses dois tipos);
 *   - o CHECK de `evento` fala o MESMO vocabulário de `EVENTOS_DE_PONTUACAO`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EVENTOS_DE_PONTUACAO } from "@/lib/leads/pontuacao-por-regra";

import { lastLine, sql } from "./gov-helpers";

const ORG1 = "eeeeeeee-9492-4000-8000-000000000001";
const ORG2 = "eeeeeeee-9492-4000-8000-000000000002";
const U1 = "eeeeeeee-9492-4000-8000-0000000000a1";
const U2 = "eeeeeeee-9492-4000-8000-0000000000a2";
const C1 = "eeeeeeee-9492-4000-8000-0000000000c1";
const C2 = "eeeeeeee-9492-4000-8000-0000000000c2";
const REGRA = "eeeeeeee-9492-4000-8000-0000000000f1";
const FUNIL = "eeeeeeee-9492-4000-8000-0000000000b1";
const ETAPA = "eeeeeeee-9492-4000-8000-0000000000b2";
const NEGOCIO = "eeeeeeee-9492-4000-8000-0000000000d1";
const PROPOSTA = "eeeeeeee-9492-4000-8000-0000000000e1";

function registrar(org: string, contato: string, chave: string): number {
  return Number(
    lastLine(
      sql(`set role service_role;
           select public.fn_pontuacao_registrar('${org}', '${REGRA}', '${contato}', null, '${chave}');`),
    ),
  );
}

function erroDe(script: string): string {
  try {
    sql(script);
    return "";
  } catch (err) {
    return ((err as { stderr?: string }).stderr ?? "").replace(/\s+/g, " ");
  }
}

function comoUsuario(user: string, consulta: string): string {
  return lastLine(
    sql(`set role authenticated;
         select set_config('request.jwt.claims', '{"sub":"${user}"}', false);
         ${consulta}`),
  );
}

describe("pontuação por regra (migration 9492)", () => {
  beforeAll(() => {
    sql(`
      insert into auth.users (id, email) values ('${U1}','pt1@invariant.test'),('${U2}','pt2@invariant.test') on conflict (id) do nothing;
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG1}','pontos-1','P1','P1'),('${ORG2}','pontos-2','P2','P2') on conflict (id) do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ('${U1}','${ORG1}','manager',now()),('${U2}','${ORG2}','manager',now())
        on conflict (user_id, organization_id) do nothing;
      insert into public.contacts (id, organization_id, display_name) values
        ('${C1}','${ORG1}','c1'),('${C2}','${ORG2}','c2') on conflict (id) do nothing;
      insert into public.regras_de_pontuacao (id, organization_id, nome, evento, pontos, teto_por_contato)
        values ('${REGRA}','${ORG1}','Mensagem','mensagem_recebida',4,10) on conflict (id) do nothing;
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}','${ORG1}','F','funil-pontos') on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${ETAPA}','${ORG1}','${FUNIL}','E','etapa-pontos',1) on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, position_in_stage)
        values ('${NEGOCIO}','${ORG1}','${FUNIL}','${ETAPA}','${C1}','N',1) on conflict (id) do nothing;
    `);
  });

  afterAll(() => {
    sql(`delete from public.event_log where organization_id in ('${ORG1}','${ORG2}');
         delete from public.crm_lead_activities where organization_id in ('${ORG1}','${ORG2}');
         delete from public.pontuacao_extrato where organization_id in ('${ORG1}','${ORG2}');
         delete from public.regras_de_pontuacao where organization_id in ('${ORG1}','${ORG2}');
         delete from public.crm_leads where organization_id in ('${ORG1}','${ORG2}');
         delete from public.crm_stages where organization_id in ('${ORG1}','${ORG2}');
         delete from public.crm_pipelines where organization_id in ('${ORG1}','${ORG2}');
         delete from public.contacts where organization_id in ('${ORG1}','${ORG2}');
         delete from public.user_organizations where organization_id in ('${ORG1}','${ORG2}');
         delete from public.organizations where id in ('${ORG1}','${ORG2}');
         delete from auth.users where id in ('${U1}','${U2}');`);
  });

  it("a porta: fato repetido não pontua, o teto corta a última parcela e depois zera", () => {
    expect(registrar(ORG1, C1, "m:1")).toBe(4);
    expect(registrar(ORG1, C1, "m:1")).toBe(0);
    expect(registrar(ORG1, C1, "m:2")).toBe(4);
    expect(registrar(ORG1, C1, "m:3")).toBe(2);
    expect(registrar(ORG1, C1, "m:4")).toBe(0);
    expect(lastLine(sql(`select public.fn_pontuacao_do_contato('${ORG1}', '${C1}');`))).toBe("10");
  });

  it("2 tenants: regra de ORG1 não pontua contato de ORG2 nem com p_org=ORG2", () => {
    expect(registrar(ORG2, C2, "x:1")).toBe(0);
    expect(registrar(ORG1, C2, "x:2")).toBe(0);
    expect(lastLine(sql(`select count(*) from public.pontuacao_extrato where organization_id='${ORG2}';`))).toBe("0");
  });

  it("2 tenants: a sessão de ORG2 não vê regra, extrato nem soma de ORG1", () => {
    expect(comoUsuario(U2, "select count(*) from public.regras_de_pontuacao;")).toBe("0");
    expect(comoUsuario(U2, "select count(*) from public.pontuacao_extrato;")).toBe("0");
    expect(comoUsuario(U2, `select public.fn_pontuacao_do_contato('${ORG1}', '${C1}');`)).toBe("0");
    expect(comoUsuario(U1, `select public.fn_pontuacao_do_contato('${ORG1}', '${C1}');`)).toBe("10");
  });

  it("a sessão só lê: nem INSERT, nem a porta do extrato", () => {
    const sessao = `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${U1}"}', false);`;
    expect(
      erroDe(`${sessao} insert into public.regras_de_pontuacao (organization_id, nome, evento, pontos)
               values ('${ORG1}','x','mensagem_recebida',1);`),
    ).toContain("permission denied");
    expect(
      erroDe(`${sessao} insert into public.pontuacao_extrato (organization_id, contact_id, regra_id, evento, pontos, motivo, chave)
               values ('${ORG1}','${C1}','${REGRA}','mensagem_recebida',1,'x','forjado');`),
    ).toContain("permission denied");
    expect(
      erroDe(`${sessao} select public.fn_pontuacao_registrar('${ORG1}','${REGRA}','${C1}',null,'forjado');`),
    ).toContain("permission denied for function fn_pontuacao_registrar");
  });

  it("o orçamento enviado/aceito vira fato no event_log; outra atividade não", () => {
    sql(`insert into public.crm_lead_activities (organization_id, lead_id, contact_id, type, source_module, source_id, actor_kind, reason)
         values ('${ORG1}','${NEGOCIO}','${C1}','proposal_sent','proposals','${PROPOSTA}','system','x'),
                ('${ORG1}','${NEGOCIO}','${C1}','proposal_accepted','proposals','${PROPOSTA}','system','x'),
                ('${ORG1}','${NEGOCIO}','${C1}','note_added','proposals','${PROPOSTA}','system','x');`);
    const tipos = sql(
      `select event_type || '|' || entity_id || '|' || (payload->>'contact_id') from public.event_log
        where organization_id='${ORG1}' and entity_kind='crm_proposal' order by event_type;`,
    );
    expect(tipos.split("\n")).toEqual([`proposal.accepted|${PROPOSTA}|${C1}`, `proposal.sent|${PROPOSTA}|${C1}`]);
  });

  it("o CHECK de evento é o vocabulário do TypeScript", () => {
    const def = lastLine(
      sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'regras_de_pontuacao_evento_check';`),
    );
    const doBanco = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(doBanco).toEqual([...EVENTOS_DE_PONTUACAO].sort());
  });
});
