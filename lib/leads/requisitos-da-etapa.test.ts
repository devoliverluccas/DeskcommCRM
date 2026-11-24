/**
 * AS TRAVAS DE ETAPA (fase 2, item 2.3) — leitura tolerante e consulta.
 *
 *   1. a leitura de `requisitos_por_etapa` aproveita o que der e ignora o torto;
 *   2. a consulta faz UMA ida ao banco por tipo pedido, NENHUMA sem pedido, e
 *      filtra `organization_id` em todas;
 *   3. cada tipo conta o que a regra diz (proposta enviada/aceita, tarefa feita,
 *      compromisso não cancelado — o `pending` só se ainda vai acontecer);
 *   4. leitura que falha conta como NÃO cumprido (falha fechada).
 */
import { describe, expect, it } from "vitest";

import {
  marcaDoRequisito,
  permiteMoverMesmoAssim,
  requisitosAtendidos,
  requisitosDaEtapa,
  requisitosDoFunil,
  requisitosPorEtapa,
} from "./requisitos-da-etapa";

const ORG = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const CONTATO = "77777777-7777-4777-8777-777777777777";
const ETAPA = "55555555-5555-4555-8555-555555555555";
const OUTRA = "66666666-6666-4666-8666-666666666666";

describe("leitura de requisitos_por_etapa", () => {
  it("funil sem a chave não pede nada", () => {
    expect(requisitosDaEtapa({}, ETAPA)).toEqual([]);
    expect(requisitosDaEtapa(null, ETAPA)).toEqual([]);
    expect(requisitosDoFunil({ fields: [] })).toEqual([]);
    expect(permiteMoverMesmoAssim({})).toBe(false);
  });

  it("aproveita o item certo e ignora o torto, sem repetir e na ordem do vocabulário", () => {
    const settings = {
      requisitos_por_etapa: {
        [ETAPA]: [
          { tipo: "tarefa_concluida" },
          "lixo",
          { tipo: "inventado" },
          { tipo: "orcamento_vinculado" },
          { tipo: "tarefa_concluida" },
        ],
        [OUTRA]: "não é lista",
      },
    };
    expect(requisitosDaEtapa(settings, ETAPA)).toEqual(["orcamento_vinculado", "tarefa_concluida"]);
    expect(requisitosDaEtapa(settings, OUTRA)).toEqual([]);
    expect(requisitosPorEtapa(settings)).toEqual({
      [ETAPA]: ["orcamento_vinculado", "tarefa_concluida"],
    });
  });

  it("requisitosDoFunil junta os tipos de todas as etapas", () => {
    const settings = {
      requisitos_por_etapa: {
        [ETAPA]: [{ tipo: "tarefa_concluida" }],
        [OUTRA]: [{ tipo: "agendamento_marcado" }],
      },
    };
    expect(requisitosDoFunil(settings)).toEqual(["agendamento_marcado", "tarefa_concluida"]);
  });

  it("só o true explícito liga o 'mover mesmo assim'", () => {
    expect(permiteMoverMesmoAssim({ permitir_mover_mesmo_assim: true })).toBe(true);
    expect(permiteMoverMesmoAssim({ permitir_mover_mesmo_assim: "true" })).toBe(false);
  });

  it("a marca não colide com chave de campo (que não aceita ':')", () => {
    expect(marcaDoRequisito("orcamento_vinculado")).toBe("requisito:orcamento_vinculado");
  });
});

type Linhas = Record<string, unknown[] | { erro: string }>;

/** Banco falso que registra cada consulta (tabela + filtros). */
function bancoFalso(linhas: Linhas) {
  const consultas: { tabela: string; filtros: [string, unknown][] }[] = [];
  const from = (tabela: string) => {
    const filtros: [string, unknown][] = [];
    consultas.push({ tabela, filtros });
    const resultado = () => {
      const valor = linhas[tabela] ?? [];
      return Array.isArray(valor)
        ? { data: valor, error: null }
        : { data: null, error: { message: valor.erro } };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: unknown) => (filtros.push([col, v]), chain),
      in: (col: string, v: unknown) => (filtros.push([`${col}:in`, v]), chain),
      order: () => chain,
      limit: async () => resultado(),
      maybeSingle: async () => {
        const r = resultado();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
      },
    };
    return chain;
  };
  return { cliente: { from } as never, consultas };
}

describe("requisitosAtendidos — a consulta", () => {
  it("sem tipo pedido, nenhuma consulta", async () => {
    const { cliente, consultas } = bancoFalso({});
    const r = await requisitosAtendidos(cliente, { organizationId: ORG, leadId: LEAD, tipos: [] });
    expect([...r]).toEqual([]);
    expect(consultas).toEqual([]);
  });

  it("uma consulta por tipo, com organization_id em todas", async () => {
    const { cliente, consultas } = bancoFalso({
      crm_proposals: [{ id: "p" }],
      crm_tasks: [{ id: "t" }],
      calendar_appointments: [{ status: "completed", starts_at: "2020-01-01T00:00:00Z" }],
    });
    const r = await requisitosAtendidos(cliente, {
      organizationId: ORG,
      leadId: LEAD,
      contactId: CONTATO,
      tipos: ["orcamento_vinculado", "agendamento_marcado", "tarefa_concluida"],
    });
    expect([...r].sort()).toEqual(["agendamento_marcado", "orcamento_vinculado", "tarefa_concluida"]);
    expect(consultas.map((c) => c.tabela).sort()).toEqual([
      "calendar_appointments",
      "crm_proposals",
      "crm_tasks",
    ]);
    for (const c of consultas) expect(c.filtros).toContainEqual(["organization_id", ORG]);
    const propostas = consultas.find((c) => c.tabela === "crm_proposals")!;
    expect(propostas.filtros).toContainEqual(["status:in", ["enviada", "aceita"]]);
    expect(propostas.filtros).toContainEqual(["lead_id", LEAD]);
    const tarefas = consultas.find((c) => c.tabela === "crm_tasks")!;
    expect(tarefas.filtros).toContainEqual(["status", "done"]);
    const agenda = consultas.find((c) => c.tabela === "calendar_appointments")!;
    expect(agenda.filtros).toContainEqual(["contact_id", CONTATO]);
  });

  it("nada encontrado = nada cumprido", async () => {
    const { cliente } = bancoFalso({});
    const r = await requisitosAtendidos(cliente, {
      organizationId: ORG,
      leadId: LEAD,
      contactId: CONTATO,
      tipos: ["orcamento_vinculado", "agendamento_marcado", "tarefa_concluida"],
    });
    expect([...r]).toEqual([]);
  });

  it("compromisso só solicitado (pending) conta se ainda vai acontecer", async () => {
    const agora = new Date("2026-11-24T12:00:00Z");
    const passado = bancoFalso({
      calendar_appointments: [{ status: "pending", starts_at: "2026-11-20T12:00:00Z" }],
    });
    const futuro = bancoFalso({
      calendar_appointments: [{ status: "pending", starts_at: "2026-11-30T12:00:00Z" }],
    });
    const entrada = {
      organizationId: ORG,
      leadId: LEAD,
      contactId: CONTATO,
      tipos: ["agendamento_marcado"] as const,
      agora,
    };
    expect([...(await requisitosAtendidos(passado.cliente, entrada))]).toEqual([]);
    expect([...(await requisitosAtendidos(futuro.cliente, entrada))]).toEqual(["agendamento_marcado"]);
  });

  it("sem contato no negócio, o agendamento não se cumpre (e o contato é lido do lead só quando pedido)", async () => {
    const { cliente, consultas } = bancoFalso({ crm_leads: [{ contact_id: null }] });
    const r = await requisitosAtendidos(cliente, {
      organizationId: ORG,
      leadId: LEAD,
      tipos: ["agendamento_marcado"],
    });
    expect([...r]).toEqual([]);
    expect(consultas.map((c) => c.tabela)).toEqual(["crm_leads"]);
    expect(consultas[0]!.filtros).toContainEqual(["organization_id", ORG]);
  });

  it("leitura que falha conta como NÃO cumprido", async () => {
    const { cliente } = bancoFalso({ crm_proposals: { erro: "fora do ar" } });
    const r = await requisitosAtendidos(cliente, {
      organizationId: ORG,
      leadId: LEAD,
      tipos: ["orcamento_vinculado"],
    });
    expect([...r]).toEqual([]);
  });
});
