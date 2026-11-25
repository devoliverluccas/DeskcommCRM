/**
 * LOJAS E FILIAIS EM POSTGRES DE VERDADE (item 5.4, migration 9495).
 *
 * O que dublê nenhum alcança: dois tenants pela sessão (JWT), a sessão que só
 * LÊ, as chaves compostas que recusam loja/produto/número de outra organização,
 * o gatilho da proposta, uma padrão por organização (e só ativa), a troca
 * atômica da padrão, a loja com orçamento que não se apaga, e o relatório
 * recortado às conversas dos números da loja.
 *
 * Rodado por `pnpm test:db`: cada arquivo num banco próprio, sem módulo
 * instalado — o `beforeAll` instala chamando a provisionadora, como
 * `fn_modulo_instalar` faz.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ?? `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 6,
});
afterAll(() => pool.end());

const q = async (texto: string, valores: unknown[] = []) => (await pool.query(texto, valores)).rows;

interface Org {
  org: string;
  dono: string;
  numero: string;
  produto: string;
  contato: string;
  proposta: string;
}

async function organizacao(): Promise<Org> {
  const org = randomUUID();
  const dono = randomUUID();
  const numero = randomUUID();
  const produto = randomUUID();
  const contato = randomUUID();
  const funil = randomUUID();
  const etapa = randomUUID();
  const negocio = randomUUID();
  const proposta = randomUUID();
  await q("insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Demonstração fictícia','Demonstração fictícia')", [org]);
  await q("insert into auth.users(id,email) values($1,$2)", [dono, `${dono}@example.test`]);
  await q("insert into user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'admin',now())", [org, dono]);
  await q("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'x')", [numero, org, `s-${numero}`]);
  await q("insert into catalog_products(id,organization_id,codigo,nome,preco_cents) values($1,$2,$3,'Item fictício',100)", [produto, org, `p-${produto}`]);
  await q("insert into contacts(id,organization_id,display_name) values($1,$2,'Contato fictício')", [contato, org]);
  await q("insert into crm_pipelines(id,organization_id,name,slug) values($1,$2,'P',$3)", [funil, org, `f-${funil}`]);
  await q("insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'S',$4,1000)", [etapa, org, funil, `e-${etapa}`]);
  await q("insert into crm_leads(id,organization_id,pipeline_id,stage_id,title,contact_id) values($1,$2,$3,$4,'Negócio fictício',$5)", [negocio, org, funil, etapa, contato]);
  await q("insert into crm_proposals(id,organization_id,lead_id,contact_id,titulo) values($1,$2,$3,$4,'Orçamento fictício')", [proposta, org, negocio, contato]);
  return { org, dono, numero, produto, contato, proposta };
}

async function loja(org: string, nome: string, extra: { padrao?: boolean; ativa?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await q("insert into lojas(id,organization_id,nome,padrao,ativa) values($1,$2,$3,$4,$5)", [
    id, org, nome, extra.padrao ?? false, extra.ativa ?? true,
  ]);
  return id;
}

/** Roda `corpo` com a sessão de `usuario`, como o PostgREST faz. */
async function comoSessao<T>(usuario: string, corpo: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: usuario, role: "authenticated" })]);
    await c.query("set local role authenticated");
    return await corpo(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

let a: Org;
let b: Org;
let lojaA: string;
let lojaB: string;

beforeAll(async () => {
  await q("select public.fn_lojas_provisionar()");
  a = await organizacao();
  b = await organizacao();
  lojaA = await loja(a.org, "Centro", { padrao: true });
  lojaB = await loja(b.org, "Matriz", { padrao: true });
  await q("insert into estoque_por_loja(organization_id,loja_id,product_id,quantidade) values($1,$2,$3,5)", [a.org, lojaA, a.produto]);
  await q("insert into estoque_por_loja(organization_id,loja_id,product_id,quantidade) values($1,$2,$3,7)", [b.org, lojaB, b.produto]);
  await q("insert into loja_do_numero(organization_id,channel_session_id,loja_id) values($1,$2,$3)", [a.org, a.numero, lojaA]);
  await q("insert into loja_do_numero(organization_id,channel_session_id,loja_id) values($1,$2,$3)", [b.org, b.numero, lojaB]);
  await q("insert into proposta_da_loja(organization_id,proposal_id,loja_id) values($1,$2,$3)", [a.org, a.proposta, lojaA]);
  await q("insert into proposta_da_loja(organization_id,proposal_id,loja_id) values($1,$2,$3)", [b.org, b.proposta, lojaB]);
}, 60_000);

const TABELAS = ["lojas", "estoque_por_loja", "loja_do_numero", "proposta_da_loja"] as const;

describe("isolamento por organização pela sessão (JWT)", () => {
  it("a sessão de A lê exatamente as linhas de A em cada tabela do módulo, e zero de B", async () => {
    for (const tabela of TABELAS) {
      const [daA, daB] = await comoSessao(a.dono, async (c) => [
        Number((await c.query(`select count(*) from ${tabela} where organization_id=$1`, [a.org])).rows[0].count),
        Number((await c.query(`select count(*) from ${tabela} where organization_id=$1`, [b.org])).rows[0].count),
      ]);
      // Contagem positiva ANTES da recusa: isolamento não se prova por ausência de dado.
      expect(daA, `${tabela}: a sessão de A não leu a própria linha`).toBe(1);
      expect(daB, `${tabela}: a sessão de A leu linha de B`).toBe(0);
    }
  });

  it("a sessão não escreve em nenhuma tabela do módulo (42501): a escrita é das rotas", async () => {
    for (const dml of [
      `insert into lojas(organization_id,nome) values('${"$ORG"}','Pela sessão')`,
      `update lojas set nome='x' where organization_id='${"$ORG"}'`,
      `delete from estoque_por_loja where organization_id='${"$ORG"}'`,
      `update loja_do_numero set updated_at=now() where organization_id='${"$ORG"}'`,
      `delete from proposta_da_loja where organization_id='${"$ORG"}'`,
    ]) {
      await expect(comoSessao(a.dono, (c) => c.query(dml.replaceAll("$ORG", a.org)))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("anon não lê nada", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role anon");
      for (const tabela of TABELAS) {
        await expect(c.query("savepoint s").then(() => c.query(`select 1 from ${tabela} limit 1`))).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback to savepoint s");
      }
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("vínculos dentro da organização, mesmo pelo servidor", () => {
  it("estoque não aponta para produto nem loja de outra organização", async () => {
    await expect(
      q("insert into estoque_por_loja(organization_id,loja_id,product_id,quantidade) values($1,$2,$3,1)", [a.org, lojaA, b.produto]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      q("insert into estoque_por_loja(organization_id,loja_id,product_id,quantidade) values($1,$2,$3,1)", [a.org, lojaB, a.produto]),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      q("update estoque_por_loja set quantidade=-1 where loja_id=$1", [lojaA]),
    ).rejects.toThrow("estoque_por_loja_quantidade_check");
  });

  it("número não aponta para sessão nem loja de outra organização", async () => {
    const outroNumeroDeB = randomUUID();
    await q("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'x')", [outroNumeroDeB, b.org, `s-${outroNumeroDeB}`]);
    await expect(
      q("insert into loja_do_numero(organization_id,channel_session_id,loja_id) values($1,$2,$3)", [a.org, outroNumeroDeB, lojaA]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("o orçamento não aponta para proposta de outra organização, e o vínculo não troca de proposta", async () => {
    await expect(
      q("update proposta_da_loja set proposal_id=$1 where proposal_id=$2", [b.proposta, a.proposta]),
    ).rejects.toThrow(/lojas_vinculo_imutavel/);
    const lojaExtra = await loja(a.org, "Para recusa");
    await q("delete from proposta_da_loja where proposal_id=$1", [b.proposta]);
    await expect(
      q("insert into proposta_da_loja(organization_id,proposal_id,loja_id) values($1,$2,$3)", [a.org, b.proposta, lojaExtra]),
    ).rejects.toThrow(/lojas_vinculo_invalido/);
    await q("insert into proposta_da_loja(organization_id,proposal_id,loja_id) values($1,$2,$3)", [b.org, b.proposta, lojaB]);
  });
});

describe("a loja padrão", () => {
  it("no máximo uma por organização, e só ativa", async () => {
    const outra = await loja(a.org, "Segunda");
    await expect(q("update lojas set padrao=true where id=$1", [outra])).rejects.toMatchObject({ code: "23505" });
    await expect(loja(a.org, "Inativa padrão", { padrao: false, ativa: false }).then((id) => q("update lojas set padrao=true where id=$1", [id]))).rejects.toThrow(
      "lojas_padrao_ativa_check",
    );
  });

  it("fn_lojas_definir_padrao troca numa transação, recusa loja inativa ou de outra organização", async () => {
    const nova = await loja(a.org, "Nova padrão");
    expect((await q("select fn_lojas_definir_padrao($1,$2) as r", [a.org, nova]))[0].r).toBe(true);
    const padroes = await q("select id from lojas where organization_id=$1 and padrao", [a.org]);
    expect(padroes.map((p) => p.id)).toEqual([nova]);
    expect((await q("select fn_lojas_definir_padrao($1,$2) as r", [a.org, lojaB]))[0].r).toBe(false);
    const inativa = await loja(a.org, "Fechada", { ativa: false });
    expect((await q("select fn_lojas_definir_padrao($1,$2) as r", [a.org, inativa]))[0].r).toBe(false);
    // A padrão de B não mudou.
    expect((await q("select padrao from lojas where id=$1", [lojaB]))[0].padrao).toBe(true);
    // Volta ao estado do começo para os outros casos.
    await q("select fn_lojas_definir_padrao($1,$2)", [a.org, lojaA]);
  });

  it("a sessão não executa as funções de escrita do módulo", async () => {
    await expect(comoSessao(a.dono, (c) => c.query("select fn_lojas_definir_padrao($1,$2)", [a.org, lojaA]))).rejects.toMatchObject({ code: "42501" });
    await expect(comoSessao(a.dono, (c) => c.query("select fn_lojas_configurar($1,true)", [a.org]))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("apagar", () => {
  it("loja com orçamento não se apaga (RESTRICT); sem orçamento, leva o estoque e o número junto", async () => {
    await expect(q("delete from lojas where id=$1", [lojaA])).rejects.toMatchObject({ code: "23503" });
    const solta = await loja(a.org, "Sem orçamento");
    const outroNumero = randomUUID();
    await q("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'x')", [outroNumero, a.org, `s-${outroNumero}`]);
    await q("insert into estoque_por_loja(organization_id,loja_id,product_id,quantidade) values($1,$2,$3,3)", [a.org, solta, a.produto]);
    await q("insert into loja_do_numero(organization_id,channel_session_id,loja_id) values($1,$2,$3)", [a.org, outroNumero, solta]);
    await q("delete from lojas where id=$1", [solta]);
    expect(await q("select 1 from estoque_por_loja where loja_id=$1", [solta])).toEqual([]);
    expect(await q("select 1 from loja_do_numero where loja_id=$1", [solta])).toEqual([]);
    // O produto do núcleo continua.
    expect(await q("select 1 from catalog_products where id=$1", [a.produto])).toHaveLength(1);
  });
});

describe("o relatório de atendimentos de uma loja", () => {
  it("conta só as conversas dos números da loja, pela sessão", async () => {
    const outroNumero = randomUUID();
    await q("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'x')", [outroNumero, a.org, `s-${outroNumero}`]);
    // Duas conversas no número da loja Centro, uma num número sem loja.
    for (const sessao of [a.numero, a.numero, outroNumero]) {
      const contato = randomUUID();
      await q("insert into contacts(id,organization_id,display_name) values($1,$2,'Contato fictício')", [contato, a.org]);
      await q("insert into conversations(organization_id,contact_id,channel_session_id,channel) values($1,$2,$3,'whatsapp')", [a.org, contato, sessao]);
    }
    const r = await comoSessao(a.dono, async (c) =>
      (
        await c.query("select fn_lojas_relatorio_atendimentos($1, now() - interval '1 day', now() + interval '1 day', 'UTC', $2) as r", [a.org, lojaA])
      ).rows[0].r as { abertos: number; motivos: unknown[] },
    );
    expect(r.abertos).toBe(2);
    expect(Array.isArray(r.motivos)).toBe(true);
    // A sessão de B pedindo a loja de A não vê nada de A.
    const deB = await comoSessao(b.dono, async (c) =>
      (
        await c.query("select fn_lojas_relatorio_atendimentos($1, now() - interval '1 day', now() + interval '1 day', 'UTC', $2) as r", [a.org, lojaA])
      ).rows[0].r as { abertos: number },
    );
    expect(deB.abertos).toBe(0);
  });
});
