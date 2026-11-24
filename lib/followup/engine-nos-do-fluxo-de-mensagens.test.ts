/**
 * 4.3 — o motor com os nós novos, por um adaptador falso: o que vai no job dos
 * Botões, a resposta do cliente vinda pela entrada, o webhook chamado UMA vez
 * por passo, e os efeitos de Transferir / Passar para a IA depois do evento.
 */
import { describe, expect, it, vi } from "vitest";

import {
  aplicarRespostaInbound,
  avancarEnrollmentAtivo,
  type AdminClient,
  type FollowupJobRequest,
  type TickDeps,
} from "./engine";
import type { EnrollmentEventRef, EnrollmentRow } from "./node-handlers";
import type { FlowGraph } from "./graph-schema";

const NOW = new Date("2026-11-24T12:00:00.000Z");
const pos = { x: 0, y: 0 };

function enrollment(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr-1",
    organization_id: "org-1",
    pointer_id: "ptr-1",
    version_id: "ver-1",
    contact_id: "ct-1",
    conversation_id: "conv-1",
    current_node_id: "q",
    status: "active",
    next_eval_at: NOW.toISOString(),
    claimed_until: null,
    attempts: 0,
    max_attempts: 5,
    last_error: null,
    steps_taken: 2,
    outcome: null,
    cancel_reason: null,
    started_at: NOW.toISOString(),
    completed_at: null,
    updated_at: NOW.toISOString(),
    ...over,
  };
}

const GRAFO = {
  nodes: [
    { id: "t", type: "trigger", label: "Início", position: pos, config: {} },
    {
      id: "q",
      type: "buttons",
      label: "Horário",
      position: pos,
      config: {
        body: "Oi {{contact.name}}, qual horário?",
        options: [
          { id: "op_1", label: "Manhã" },
          { id: "op_2", label: "Tarde" },
        ],
        grace_timeout_ms: 3_600_000,
      },
    },
    { id: "w", type: "webhook", label: "Avisar", position: pos, config: { url: "https://r.test" } },
    {
      id: "tr",
      type: "transfer",
      label: "Vendas",
      position: pos,
      config: { destino: { tipo: "setor", sector_id: "00000000-0000-4000-8000-000000000001" } },
    },
    { id: "ia", type: "handoff_ai", label: "IA", position: pos, config: {} },
    { id: "f", type: "end", label: "Fim", position: pos, config: { outcome: "converted" } },
  ],
  edges: [
    { id: "1", source: "q", target: "w", priority: 0, condition: { type: "branch", branch_id: "op_2" } },
    { id: "2", source: "q", target: "f", priority: 0, condition: { type: "always" } },
    { id: "3", source: "w", target: "tr", priority: 0, condition: { type: "branch", branch_id: "webhook_ok" } },
    { id: "4", source: "w", target: "ia", priority: 0, condition: { type: "branch", branch_id: "webhook_erro" } },
    { id: "5", source: "tr", target: "ia", priority: 0, condition: { type: "always" } },
  ],
} as unknown as FlowGraph;

function adaptador(eventos: EnrollmentEventRef[] = [], extra: Partial<AdminClient> = {}) {
  const chaves = new Set(eventos.map((e) => e.idempotency_key).filter((k): k is string => !!k));
  const inseridos: Array<{ event_type: string; idempotency_key: string; payload: Record<string, unknown> }> = [];
  const patches: Array<Record<string, unknown>> = [];
  const db = {
    loadFlowGraph: vi.fn(async () => GRAFO),
    loadLeadFacts: vi.fn(async () => ({ lead_stage: null, tags: [] })),
    loadEnrollmentEvents: vi.fn(async () => eventos),
    loadLastInboundBody: vi.fn(async () => null),
    loadRenderContext: vi.fn(async () => ({ contact: { name: "Lia" } })),
    loadFlowPointerName: vi.fn(async () => null),
    insertEnrollmentEvent: vi.fn(async (ev: { event_type: string; idempotency_key: string; payload: Record<string, unknown> }) => {
      if (chaves.has(ev.idempotency_key)) return { inserted: false };
      chaves.add(ev.idempotency_key);
      inseridos.push(ev);
      return { inserted: true };
    }),
    updateEnrollment: vi.fn(async (_id: string, _org: string, patch: Record<string, unknown>) => {
      patches.push(patch);
    }),
    ...extra,
  } as unknown as AdminClient;
  return { db, inseridos, patches };
}

describe("Botões no motor", () => {
  it("1ª entrada: o job leva o texto NUMERADO (com variáveis) e o desenho dos botões", async () => {
    const { db, patches } = adaptador();
    const jobs: FollowupJobRequest[] = [];
    const deps: TickDeps = { db, clock: () => NOW, enqueueJob: async (j) => void jobs.push(j) };
    await avancarEnrollmentAtivo(deps, enrollment());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload.fixed_body).toBe("Oi Lia, qual horário?\n\n1. Manhã\n2. Tarde\n\nResponda 1 ou 2.");
    expect(jobs[0]!.payload.fixed_interativo).toEqual({
      tipo: "botoes",
      corpo: "Oi Lia, qual horário?",
      opcoes: [
        { id: "op_1", rotulo: "Manhã" },
        { id: "op_2", rotulo: "Tarde" },
      ],
    });
    expect(patches.at(-1)).toMatchObject({ status: "waiting_reply" });
  });

  it("a resposta '2' que chega pela entrada segue pela saída da opção", async () => {
    const eventos: EnrollmentEventRef[] = [
      { node_id: "q", idempotency_key: "q:2", event_type: "turn_enqueued", payload: {} },
    ];
    const { db, patches } = adaptador(eventos);
    const deps: TickDeps = { db, clock: () => NOW, enqueueJob: async () => {} };
    await aplicarRespostaInbound(deps, enrollment({ steps_taken: 3, status: "waiting_reply" }), "2");
    expect(patches.some((p) => p.current_node_id === "w")).toBe(true);
  });
});

describe("Webhook no motor", () => {
  it("chama UMA vez por passo: o replay lê o desfecho gravado em vez de chamar de novo", async () => {
    const executar = vi.fn(async () => ({ resultado: "ok" as const, detalhe: "http_200" }));
    const { db, inseridos, patches } = adaptador([], { executarWebhookDoFluxo: executar });
    const deps: TickDeps = { db, clock: () => NOW, enqueueJob: async () => {} };
    await avancarEnrollmentAtivo(deps, enrollment({ current_node_id: "w" }));
    expect(executar).toHaveBeenCalledTimes(1);
    expect(inseridos.find((e) => e.event_type === "webhook_called")?.payload).toEqual({
      resultado: "ok",
      detalhe: "http_200",
    });
    expect(patches.at(-1)).toMatchObject({ current_node_id: "tr" });

    const replay = adaptador(
      [{ node_id: "w", idempotency_key: "w:2:webhook", event_type: "webhook_called", payload: { resultado: "erro" } }],
      { executarWebhookDoFluxo: executar },
    );
    await avancarEnrollmentAtivo({ ...deps, db: replay.db }, enrollment({ current_node_id: "w" }));
    expect(executar).toHaveBeenCalledTimes(1);
    expect(replay.patches.at(-1)).toMatchObject({ current_node_id: "ia" });
  });

  it("sem executor (ou falha), segue por Erro — o fluxo nunca fica parado", async () => {
    const { db, patches } = adaptador();
    await avancarEnrollmentAtivo({ db, clock: () => NOW, enqueueJob: async () => {} }, enrollment({ current_node_id: "w" }));
    expect(patches.at(-1)).toMatchObject({ current_node_id: "ia" });
  });
});

describe("Transferir e Passar para a IA no motor", () => {
  it("Transferir chama a troca depois do evento do passo; a recusa vira linha na trilha e o fluxo segue", async () => {
    const transferir = vi.fn(async () => ({ ok: false as const, motivo: "setor_inexistente" }));
    const { db, inseridos, patches } = adaptador([], { transferirConversaDoFluxo: transferir });
    await avancarEnrollmentAtivo({ db, clock: () => NOW, enqueueJob: async () => {} }, enrollment({ current_node_id: "tr" }));
    expect(transferir).toHaveBeenCalledTimes(1);
    expect(inseridos.map((e) => e.event_type)).toEqual(["node_advanced", "transfer_failed"]);
    expect(patches.at(-1)).toMatchObject({ current_node_id: "ia" });
  });

  it("Passar para a IA conclui a inscrição e devolve a conversa ao agente", async () => {
    const devolver = vi.fn(async () => ({ ok: true as const }));
    const { db, patches } = adaptador([], { devolverConversaAIA: devolver });
    await avancarEnrollmentAtivo({ db, clock: () => NOW, enqueueJob: async () => {} }, enrollment({ current_node_id: "ia" }));
    expect(devolver).toHaveBeenCalledTimes(1);
    expect(patches.at(-1)).toMatchObject({ status: "completed", cancel_reason: "Passou para a IA" });
  });
});
