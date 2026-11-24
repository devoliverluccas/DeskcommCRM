/**
 * 4.3 — os nós Botões, Lista, Webhook, Transferir e Passar para a IA: o schema
 * do grafo, as saídas que o desenho mostra, a decisão pura do motor e o que o
 * publish exige.
 */
import { describe, expect, it } from "vitest";

import {
  NO_REPLY_BRANCH_ID,
  WEBHOOK_ERROR_BRANCH_ID,
  WEBHOOK_OK_BRANCH_ID,
  flowGraphSchema,
  flowNodeSchema,
  nodeBranches,
  type FlowEdge,
  type FlowNode,
} from "./graph-schema";
import { MOTIVO_PASSOU_PARA_A_IA, processNode, type EnrollmentRow } from "./node-handlers";
import { validateFlowForPublish } from "./validate-publish";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const clock = () => NOW;
const pos = { x: 0, y: 0 };

function enrollment(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr-1",
    organization_id: "org-1",
    pointer_id: "ptr-1",
    version_id: "ver-1",
    contact_id: "ct-1",
    conversation_id: null,
    current_node_id: "q",
    status: "active",
    next_eval_at: NOW.toISOString(),
    claimed_until: null,
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    steps_taken: 3,
    outcome: null,
    cancel_reason: null,
    started_at: NOW.toISOString(),
    completed_at: null,
    updated_at: NOW.toISOString(),
    ...over,
  };
}
const lead = { lead_stage: null, tags: [], steps_taken: 0, last_outcome: null };

const botoes: FlowNode = {
  id: "q",
  type: "buttons",
  label: "Horário",
  position: pos,
  config: {
    body: "Qual horário?",
    options: [
      { id: "op_1", label: "Manhã" },
      { id: "op_2", label: "Tarde" },
    ],
    grace_timeout_ms: 3_600_000,
  },
};
const e = (source: string, target: string, condition: FlowEdge["condition"]): FlowEdge => ({
  id: `${source}-${target}`,
  source,
  target,
  priority: 0,
  condition,
});
const arestasDosBotoes: FlowEdge[] = [
  e("q", "m", { type: "branch", branch_id: "op_1" }),
  e("q", "t", { type: "branch", branch_id: "op_2" }),
  e("q", "sem", { type: "branch", branch_id: NO_REPLY_BRANCH_ID }),
  e("q", "outros", { type: "always" }),
];

describe("schema do grafo", () => {
  it("Botões aceita até 3 opções; a 4ª é recusada", () => {
    const quatro = {
      ...botoes,
      config: {
        ...(botoes as Extract<FlowNode, { type: "buttons" }>).config,
        options: ["a", "b", "c", "d"].map((id) => ({ id, label: id })),
      },
    };
    expect(flowNodeSchema.safeParse(botoes).success).toBe(true);
    expect(flowNodeSchema.safeParse(quatro).success).toBe(false);
  });

  it("Lista aceita até 10 itens e recusa ids repetidos", () => {
    const lista = {
      id: "l",
      type: "list",
      label: "Serviço",
      position: pos,
      config: {
        body: "Escolha",
        button_label: "Ver",
        options: Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, label: `Item ${i}` })),
        grace_timeout_ms: 900_000,
      },
    };
    expect(flowNodeSchema.safeParse(lista).success).toBe(true);
    const onze = { ...lista, config: { ...lista.config, options: [...lista.config.options, { id: "o10", label: "x" }] } };
    expect(flowNodeSchema.safeParse(onze).success).toBe(false);
    const repetido = { ...lista, config: { ...lista.config, options: [{ id: "a", label: "1" }, { id: "a", label: "2" }] } };
    expect(flowNodeSchema.safeParse(repetido).success).toBe(false);
  });

  it("opção não pode usar id reservado (é o ramo da aresta)", () => {
    const reservado = {
      ...botoes,
      config: { ...(botoes as Extract<FlowNode, { type: "buttons" }>).config, options: [{ id: "else", label: "x" }] },
    };
    expect(flowNodeSchema.safeParse(reservado).success).toBe(false);
  });

  it("Passar para a IA não aceita configuração nenhuma", () => {
    expect(flowNodeSchema.safeParse({ id: "h", type: "handoff_ai", label: "IA", position: pos, config: {} }).success).toBe(true);
    expect(
      flowNodeSchema.safeParse({ id: "h", type: "handoff_ai", label: "IA", position: pos, config: { x: 1 } }).success,
    ).toBe(false);
  });

  it("modo híbrido mora nas configurações do roteiro", () => {
    const g = {
      nodes: [
        { id: "t", type: "trigger", label: "Início", position: pos, config: {} },
        { id: "f", type: "end", label: "Fim", position: pos, config: { outcome: "converted" } },
      ],
      edges: [e("t", "f", { type: "always" })],
      settings: { resposta_pronta: true },
    };
    expect(flowGraphSchema.parse(g).settings?.resposta_pronta).toBe(true);
  });
});

describe("saídas visíveis no desenho (nodeBranches)", () => {
  it("Botões: uma saída por opção + Sem resposta + Outros casos", () => {
    expect(nodeBranches(botoes).map((b) => b.id)).toEqual(["op_1", "op_2", NO_REPLY_BRANCH_ID, "else"]);
    expect(nodeBranches(botoes)[0]!.label).toBe("Manhã");
  });

  it("Webhook: Sucesso e Erro", () => {
    const w: FlowNode = { id: "w", type: "webhook", label: "Avisar", position: pos, config: { url: "" } };
    expect(nodeBranches(w).map((b) => b.id)).toEqual([WEBHOOK_OK_BRANCH_ID, WEBHOOK_ERROR_BRANCH_ID, "else"]);
  });

  it("Passar para a IA é terminal: nenhuma saída", () => {
    expect(nodeBranches({ type: "handoff_ai", config: {} })).toEqual([]);
  });
});

describe("motor (decisão pura)", () => {
  const base = { edges: arestasDosBotoes, enrollment: enrollment(), lead, clock };

  it("1ª entrada: manda a pergunta e estaciona esperando a escolha", () => {
    expect(processNode({ ...base, node: botoes })).toEqual({
      kind: "enqueue_turn",
      purpose: "send_message",
      wake_status: "waiting_reply",
    });
  });

  it("resposta pelo NÚMERO segue pela saída da opção, com o rótulo como desfecho", () => {
    const r = processNode({ ...base, node: botoes, waitElapsed: true, wokeEarly: true, lastInboundBody: "2" });
    expect(r).toMatchObject({ kind: "advance", next_node_id: "t", class: "Tarde" });
  });

  it("resposta pelo id do botão (canal interativo) e pelo rótulo também casam", () => {
    expect(
      processNode({ ...base, node: botoes, waitElapsed: true, wokeEarly: true, lastInboundBody: "op_1" }),
    ).toMatchObject({ next_node_id: "m" });
    expect(
      processNode({ ...base, node: botoes, waitElapsed: true, wokeEarly: true, lastInboundBody: "tarde" }),
    ).toMatchObject({ next_node_id: "t" });
  });

  it("resposta que não casa vai para Outros casos", () => {
    const r = processNode({ ...base, node: botoes, waitElapsed: true, wokeEarly: true, lastInboundBody: "talvez" });
    expect(r).toMatchObject({ kind: "advance", next_node_id: "outros" });
  });

  it("carência vencida sem resposta vai para Sem resposta", () => {
    const r = processNode({ ...base, node: botoes, waitElapsed: true });
    expect(r).toMatchObject({ kind: "advance", next_node_id: "sem", class: NO_REPLY_BRANCH_ID });
  });

  it("Webhook: 2xx sai por Sucesso; falha (ou chamada ausente) sai por Erro — nunca segura", () => {
    const w: FlowNode = { id: "w", type: "webhook", label: "Avisar", position: pos, config: { url: "https://x.test" } };
    const edges = [
      e("w", "ok", { type: "branch", branch_id: WEBHOOK_OK_BRANCH_ID }),
      e("w", "erro", { type: "branch", branch_id: WEBHOOK_ERROR_BRANCH_ID }),
    ];
    const b = { edges, enrollment: enrollment(), lead, clock, node: w };
    expect(processNode({ ...b, webhookResultado: "ok" })).toMatchObject({ next_node_id: "ok" });
    expect(processNode({ ...b, webhookResultado: "erro" })).toMatchObject({ next_node_id: "erro" });
    expect(processNode(b)).toMatchObject({ next_node_id: "erro" });
  });

  it("Transferir é passagem (o efeito é do motor); Passar para a IA conclui o fluxo", () => {
    const tr: FlowNode = {
      id: "tr",
      type: "transfer",
      label: "Vendas",
      position: pos,
      config: { destino: { tipo: "setor", sector_id: "00000000-0000-4000-8000-000000000001" } },
    };
    expect(
      processNode({ edges: [e("tr", "fim", { type: "always" })], enrollment: enrollment(), lead, clock, node: tr }),
    ).toMatchObject({ kind: "advance", next_node_id: "fim" });
    const ia: FlowNode = { id: "ia", type: "handoff_ai", label: "IA", position: pos, config: {} };
    expect(processNode({ edges: [], enrollment: enrollment(), lead, clock, node: ia })).toEqual({
      kind: "complete",
      outcome: null,
      cancel_reason: MOTIVO_PASSOU_PARA_A_IA,
    });
  });
});

describe("publish", () => {
  const trigger: FlowNode = { id: "t", type: "trigger", label: "Início", position: pos, config: {} };
  const fim: FlowNode = { id: "f", type: "end", label: "Fim", position: pos, config: { outcome: "converted" } };
  const codigos = (g: { nodes: FlowNode[]; edges: FlowEdge[] }) => {
    const r = validateFlowForPublish(g);
    return r.ok ? [] : r.errors.map((x) => x.code);
  };

  it("Botões completo, com toda saída ligada, publica", () => {
    const g = {
      nodes: [trigger, botoes, fim],
      edges: [
        e("t", "q", { type: "always" }),
        e("q", "f", { type: "branch", branch_id: "op_1" }),
        { ...e("q", "f", { type: "branch", branch_id: "op_2" }), id: "q-f2" },
        { ...e("q", "f", { type: "branch", branch_id: NO_REPLY_BRANCH_ID }), id: "q-f3" },
        { ...e("q", "f", { type: "always" }), id: "q-f4" },
      ],
    };
    expect(codigos(g)).toEqual([]);
  });

  it("opção sem nome e rótulos repetidos não publicam", () => {
    const vazio = {
      ...botoes,
      config: {
        ...(botoes as Extract<FlowNode, { type: "buttons" }>).config,
        options: [
          { id: "op_1", label: "" },
          { id: "op_2", label: "x" },
        ],
      },
    } as FlowNode;
    expect(codigos({ nodes: [trigger, vazio, fim], edges: [e("t", "q", { type: "always" }), e("q", "f", { type: "always" })] })).toContain(
      "opcoes_incompletas",
    );
  });

  it("Webhook sem URL e Transferir sem destino não publicam; Passar para a IA conta como fim", () => {
    const w: FlowNode = { id: "w", type: "webhook", label: "Avisar", position: pos, config: { url: "" } };
    const tr: FlowNode = {
      id: "tr",
      type: "transfer",
      label: "Vendas",
      position: pos,
      config: { destino: { tipo: "atendente", user_id: "" } },
    };
    const ia: FlowNode = { id: "ia", type: "handoff_ai", label: "IA", position: pos, config: {} };
    const g = {
      nodes: [trigger, w, tr, ia],
      edges: [e("t", "w", { type: "always" }), e("w", "tr", { type: "always" }), e("tr", "ia", { type: "always" })],
    };
    const r = codigos(g);
    expect(r).toContain("webhook_url_invalida");
    expect(r).toContain("destino_da_transferencia_ausente");
    expect(r).not.toContain("no_end_path");
  });

  it("os nós novos não rodam no roteiro de atendimento", () => {
    const r = validateFlowForPublish(
      { nodes: [trigger, botoes, fim], edges: [e("t", "q", { type: "always" }), e("q", "f", { type: "always" })] },
      { surface: "atendimento" },
    );
    expect(r.ok ? [] : r.errors.map((x) => x.code)).toContain("no_fora_da_superficie");
  });
});
