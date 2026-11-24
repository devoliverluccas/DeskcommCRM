import { describe, expect, it, vi } from "vitest";

import { aplicarPontuacao, pontuacaoPorRegraHandler, type PontuacaoDb } from "./pontuacao-por-regra.handler";
import {
  EVENTOS_DE_PONTUACAO,
  ROTULO_DO_EVENTO,
  TIPOS_DO_EVENT_LOG,
  chaveDoFato,
  criarRegraSchema,
  editarRegraSchema,
  pedidosDoEvento,
  pontosDentroDoTeto,
  regraCasa,
  type FatoPontuavel,
  type RegraDePontuacao,
} from "./pontuacao-por-regra";

/**
 * PONTUAÇÃO POR REGRA (fase 4, 4.5) — o casamento, o teto, a chave e o
 * consumidor, sem banco. A parte que precisa do banco (trava do teto, chave
 * única, RLS) é provada em `tests/invariants/pontuacao-por-regra-isolamento.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const NEGOCIO = "44444444-4444-4444-8444-444444444444";
const ETAPA = "77777777-7777-4777-8777-777777777777";

function regra(extra: Partial<RegraDePontuacao>): RegraDePontuacao {
  return {
    id: "r-1",
    nome: "Regra",
    evento: "mensagem_recebida",
    condicao: {},
    pontos: 5,
    ativo: true,
    teto_por_contato: null,
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

function fato(extra: Partial<FatoPontuavel>): FatoPontuavel {
  return {
    evento: "mensagem_recebida",
    contactId: CONTATO,
    leadId: null,
    chave: "mensagem_recebida:m1",
    ocorridoEm: "2026-11-24T12:00:00.000Z",
    atributos: {},
    ...extra,
  };
}

describe("vocabulário", () => {
  it("todo evento tem rótulo e ao menos um tipo do event_log", () => {
    for (const e of EVENTOS_DE_PONTUACAO) {
      expect(ROTULO_DO_EVENTO[e]).toBeTruthy();
      expect(TIPOS_DO_EVENT_LOG[e].length).toBeGreaterThan(0);
    }
  });

  it("o handler assina exatamente os tipos do vocabulário, e roda na organização parada", () => {
    expect(new Set(pontuacaoPorRegraHandler.events)).toEqual(
      new Set(Object.values(TIPOS_DO_EVENT_LOG).flat()),
    );
    expect(pontuacaoPorRegraHandler.naOrgParada).toBe("roda");
  });
});

describe("schemas", () => {
  it("criar: condição de etapa exige uuid; de tag exige texto; zero pontos é recusado", () => {
    expect(criarRegraSchema.safeParse({ nome: "a", evento: "etapa_alcancada", pontos: 3 }).success).toBe(false);
    expect(
      criarRegraSchema.safeParse({ nome: "a", evento: "etapa_alcancada", pontos: 3, condicao: { stage_id: ETAPA } })
        .success,
    ).toBe(true);
    expect(criarRegraSchema.safeParse({ nome: "a", evento: "tag_aplicada", pontos: 3, condicao: { tag: " " } }).success).toBe(
      false,
    );
    expect(criarRegraSchema.safeParse({ nome: "a", evento: "mensagem_recebida", pontos: 0 }).success).toBe(false);
    expect(criarRegraSchema.safeParse({ nome: "a", evento: "mensagem_recebida", pontos: -1001 }).success).toBe(false);
    // Evento sem condição não aceita chave sobrando: a regra mentiria sobre o filtro.
    expect(
      criarRegraSchema.safeParse({ nome: "a", evento: "mensagem_recebida", pontos: 1, condicao: { tag: "x" } }).success,
    ).toBe(false);
  });

  it("editar não aceita trocar o evento nem patch vazio", () => {
    expect(editarRegraSchema.safeParse({ evento: "tag_aplicada" }).success).toBe(false);
    expect(editarRegraSchema.safeParse({}).success).toBe(false);
    expect(editarRegraSchema.safeParse({ pontos: -3 }).success).toBe(true);
  });
});

describe("regraCasa / chaveDoFato", () => {
  it("regra inativa nunca casa", () => {
    expect(regraCasa(regra({ ativo: false }), fato({}))).toBe(false);
  });

  it("etapa: só a etapa da condição", () => {
    const r = regra({ evento: "etapa_alcancada", condicao: { stage_id: ETAPA } });
    expect(regraCasa(r, fato({ evento: "etapa_alcancada", atributos: { stageId: ETAPA } }))).toBe(true);
    expect(regraCasa(r, fato({ evento: "etapa_alcancada", atributos: { stageId: "outra" } }))).toBe(false);
  });

  it("tag: sem diferenciar caixa nem espaço, e a chave leva a tag da regra", () => {
    const r = regra({ evento: "tag_aplicada", condicao: { tag: "VIP " } });
    const f = fato({ evento: "tag_aplicada", chave: `tag_aplicada:${CONTATO}`, atributos: { tags: ["novo", "vip"] } });
    expect(regraCasa(r, f)).toBe(true);
    expect(chaveDoFato(f, r)).toBe(`tag_aplicada:${CONTATO}:vip`);
    expect(regraCasa(r, fato({ evento: "tag_aplicada", atributos: { tags: ["novo"] } }))).toBe(false);
  });
});

describe("pontosDentroDoTeto", () => {
  it("sem teto, vale o que a regra diz", () => {
    expect(pontosDentroDoTeto(5, null, 1000)).toBe(5);
  });
  it("corta a última parcela para caber e zera quando cheio", () => {
    expect(pontosDentroDoTeto(5, 20, 18)).toBe(2);
    expect(pontosDentroDoTeto(5, 20, 20)).toBe(0);
  });
  it("o teto vale sobre o módulo, também para regra negativa", () => {
    expect(pontosDentroDoTeto(-5, 12, 10)).toBe(-2);
  });
});

describe("pedidosDoEvento", () => {
  const todos = new Set(EVENTOS_DE_PONTUACAO);

  it("message.received gera mensagem e follow-up, só para os eventos escutados", () => {
    const row = {
      id: "ev",
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "m1",
      payload: { contact_id: CONTATO, message_id: "m1" },
    };
    expect(pedidosDoEvento(row, todos).map((p) => p.evento)).toEqual(["mensagem_recebida", "respondeu_followup"]);
    expect(pedidosDoEvento(row, new Set(["respondeu_followup"] as const)).map((p) => p.evento)).toEqual([
      "respondeu_followup",
    ]);
  });

  it("lead.stage_changed do gatilho do banco (lead_id no payload) e da rota (entity_id)", () => {
    const doBanco = { id: "e", event_type: "lead.stage_changed", entity_kind: "lead", entity_id: null, payload: { lead_id: NEGOCIO, to_stage_id: ETAPA } };
    const daRota = { id: "e", event_type: "lead.stage_changed", entity_kind: "crm_lead", entity_id: NEGOCIO, payload: { to_stage_id: ETAPA } };
    expect(pedidosDoEvento(doBanco, todos)).toEqual([{ evento: "etapa_alcancada", leadId: NEGOCIO, stageId: ETAPA }]);
    expect(pedidosDoEvento(daRota, todos)).toEqual([{ evento: "etapa_alcancada", leadId: NEGOCIO, stageId: ETAPA }]);
  });

  it("tipo sem vocabulário não gera nada", () => {
    expect(pedidosDoEvento({ id: "e", event_type: "lead.won", entity_kind: "lead", entity_id: NEGOCIO, payload: {} }, todos)).toEqual([]);
  });
});

/** Um banco em memória que guarda o extrato pela MESMA chave do índice único. */
function bancoFalso(regras: RegraDePontuacao[], extra: Partial<PontuacaoDb> = {}) {
  const extrato = new Map<string, number>();
  const db: PontuacaoDb = {
    regrasAtivas: vi.fn(async (_org, eventos) => regras.filter((r) => r.ativo && eventos.includes(r.evento))),
    contatoDoNegocio: vi.fn(async () => CONTATO),
    contatoDoAgendamento: vi.fn(async () => CONTATO),
    inscricaoRespondida: vi.fn(async () => "insc-1"),
    registrar: vi.fn(async (e) => {
      const k = `${e.regraId}|${e.chave}`;
      if (extrato.has(k)) return 0;
      const r = regras.find((x) => x.id === e.regraId)!;
      extrato.set(k, r.pontos);
      return r.pontos;
    }),
    ...extra,
  };
  return { db, extrato };
}

const linhaDoEvento = (event_type: string, payload: Record<string, unknown>, entity_id: string | null = null) => ({
  id: "ev-1",
  organization_id: ORG,
  event_type,
  entity_kind: "x",
  entity_id,
  payload,
  created_at: "2026-11-24T12:00:00+00:00",
});

describe("aplicarPontuacao — o consumidor", () => {
  it("sem regra ativa, não consulta mais nada", async () => {
    const { db } = bancoFalso([]);
    const r = await aplicarPontuacao(db, linhaDoEvento("message.received", { contact_id: CONTATO, message_id: "m1" }));
    expect(r).toEqual({ casados: 0, gravados: 0, pontos: 0 });
    expect(db.inscricaoRespondida).not.toHaveBeenCalled();
    expect(db.registrar).not.toHaveBeenCalled();
  });

  it("o mesmo fato chegando duas vezes pontua uma vez (etapa emitida pelo gatilho e pela rota)", async () => {
    const { db, extrato } = bancoFalso([
      regra({ id: "r-etapa", evento: "etapa_alcancada", condicao: { stage_id: ETAPA }, pontos: 20 }),
    ]);
    await aplicarPontuacao(db, linhaDoEvento("lead.stage_changed", { lead_id: NEGOCIO, to_stage_id: ETAPA }));
    const segunda = await aplicarPontuacao(db, linhaDoEvento("lead.stage_changed", { to_stage_id: ETAPA }, NEGOCIO));
    expect(segunda.gravados).toBe(0);
    expect([...extrato.values()]).toEqual([20]);
    expect(db.registrar).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: ORG, contactId: CONTATO, leadId: NEGOCIO, chave: `etapa_alcancada:${NEGOCIO}:${ETAPA}` }),
    );
  });

  it("respondeu o follow-up: pontua uma vez por inscrição, e nada sem inscrição respondida", async () => {
    const regras = [regra({ id: "r-fu", evento: "respondeu_followup", pontos: 10 })];
    const { db, extrato } = bancoFalso(regras);
    await aplicarPontuacao(db, linhaDoEvento("message.received", { contact_id: CONTATO, message_id: "m1" }));
    await aplicarPontuacao(db, linhaDoEvento("message.received", { contact_id: CONTATO, message_id: "m2" }));
    expect([...extrato.keys()]).toEqual(["r-fu|respondeu_followup:insc-1"]);
    expect(db.inscricaoRespondida).toHaveBeenCalledWith(ORG, CONTATO, "2026-11-24T12:00:00.000Z");

    const semInscricao = bancoFalso(regras, { inscricaoRespondida: vi.fn(async () => null) });
    const r = await aplicarPontuacao(semInscricao.db, linhaDoEvento("message.received", { contact_id: CONTATO }));
    expect(r.casados).toBe(0);
  });

  it("negócio de outra organização (sem contato resolvido) não pontua", async () => {
    const { db } = bancoFalso(
      [regra({ id: "r-tag", evento: "tag_aplicada", condicao: { tag: "vip" } })],
      { contatoDoNegocio: vi.fn(async () => null) },
    );
    const r = await aplicarPontuacao(db, linhaDoEvento("lead.tag_added", { added_tags: ["vip"] }, NEGOCIO));
    expect(r.casados).toBe(0);
    expect(db.registrar).not.toHaveBeenCalled();
  });

  it("orçamento aceito usa o contato do payload e a proposta como chave", async () => {
    const { db } = bancoFalso([regra({ id: "r-ok", evento: "orcamento_aceito", pontos: 50 })]);
    const r = await aplicarPontuacao(
      db,
      linhaDoEvento("proposal.accepted", { lead_id: NEGOCIO, contact_id: CONTATO }, "prop-1"),
    );
    expect(r).toEqual({ casados: 1, gravados: 1, pontos: 50 });
    expect(db.registrar).toHaveBeenCalledWith(expect.objectContaining({ chave: "orcamento_aceito:prop-1" }));
    expect(db.contatoDoNegocio).not.toHaveBeenCalled();
  });

  it("tipo fora do vocabulário sai `skipped` sem abrir conexão com o banco", async () => {
    const r = await pontuacaoPorRegraHandler.handle({
      ...linhaDoEvento("lead.won", {}),
      metadata: {},
      consumed_by: [],
      attempts: 0,
    });
    expect(r).toMatchObject({ status: "skipped", detail: "tipo_sem_regra" });
  });

  it("falha do banco propaga (o handler a devolve como `error`, e o dreno conta a tentativa)", async () => {
    const { db } = bancoFalso([], { regrasAtivas: vi.fn(async () => Promise.reject(new Error("caiu"))) });
    await expect(
      aplicarPontuacao(db, linhaDoEvento("message.received", { contact_id: CONTATO })),
    ).rejects.toThrow("caiu");
  });
});
