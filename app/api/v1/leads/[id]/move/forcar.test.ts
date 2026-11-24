/**
 * "MOVER MESMO ASSIM" no arrasto (fase 2, item 2.3).
 *
 *   - etapa com requisito não cumprido: 422 com o requisito no `faltando`;
 *   - funil que permite + manager: a recusa marca `pode_forcar`, e `forcar: true`
 *     move, grava na timeline o que foi pulado e audita
 *     `lead.stage_gate_overridden`;
 *   - agent, ou funil que não permite: `forcar` é ignorado (continua 422);
 *   - forçar NUNCA pula campo obrigatório.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
  stageChangeReason: () => "Movido de A para B",
}));
vi.mock("@/lib/leads/activity-write-failure", () => ({
  registraFalhaDeAtividade: vi.fn(async () => undefined),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "33333333-3333-4333-8333-333333333333";
const PIPELINE_ID = "44444444-4444-4444-8444-444444444444";
const STAGE_A = "55555555-5555-4555-8555-555555555555";
const STAGE_B = "66666666-6666-4666-8666-666666666666";
const CARREGADO = "2026-09-15T12:00:00.000Z";

function bancoFalso(settings: unknown) {
  const banco = { stageId: STAGE_A, consultas: [] as string[] };
  const lead = () => ({
    id: LEAD_ID,
    organization_id: ORG_ID,
    pipeline_id: PIPELINE_ID,
    stage_id: banco.stageId,
    contact_id: null,
    status: "open",
    updated_at: CARREGADO,
    custom_fields: {},
    won_reason: null,
  });
  const vazio = () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
    };
    return chain;
  };
  const from = (tabela: string) => {
    banco.consultas.push(tabela);
    if (tabela === "crm_pipelines") {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { settings }, error: null }) };
      return chain;
    }
    if (tabela === "crm_stages") {
      const chain = {
        id: "",
        select: () => chain,
        eq: (_c: string, id: string) => ((chain.id = id), chain),
        maybeSingle: async () => ({
          data: { id: chain.id, pipeline_id: PIPELINE_ID, name: "Etapa", is_won: false, is_lost: false },
          error: null,
        }),
      };
      return chain;
    }
    if (tabela === "crm_leads") {
      return {
        select: () => {
          const leitura = { eq: () => leitura, maybeSingle: async () => ({ data: lead(), error: null }) };
          return leitura;
        },
        update: (valores: { stage_id: string }) => {
          const escrita = {
            eq: () => escrita,
            select: () => escrita,
            maybeSingle: async () => {
              banco.stageId = valores.stage_id;
              return { data: { id: LEAD_ID }, error: null };
            },
          };
          return escrita;
        },
      };
    }
    // crm_proposals / crm_tasks / calendar_appointments: nada encontrado.
    return vazio();
  };
  return { from, rpc: vi.fn(() => Promise.resolve({ error: null })), banco };
}

function comoPapel(role: string) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID, idioma: "pt-BR" },
    org: { orgId: ORG_ID, role },
  } as never);
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/v1/leads/${LEAD_ID}/move`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const contexto = { params: Promise.resolve({ id: LEAD_ID }) };
const corpo = { stage_id: STAGE_B, position_in_stage: 1500, expected_updated_at: CARREGADO };

const TRAVA = { requisitos_por_etapa: { [STAGE_B]: [{ tipo: "orcamento_vinculado" }] } };
const TRAVA_FORCAVEL = { ...TRAVA, permitir_mover_mesmo_assim: true };

type Recusa = {
  error?: {
    code?: string;
    details?: { faltando?: Record<string, unknown>[]; pode_forcar?: boolean };
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  comoPapel("manager");
});

describe("POST /move — travas de etapa e mover mesmo assim", () => {
  it("etapa com requisito não cumprido: 422 com o requisito, e nada gravado", async () => {
    const falso = bancoFalso(TRAVA);
    vi.mocked(createClient).mockResolvedValue(falso as never);
    const { POST } = await import("./route");

    const r = await POST(request(corpo), contexto);
    expect(r.status).toBe(422);
    const json = (await r.json()) as Recusa;
    expect(json.error?.code).toBe("required_fields_missing");
    expect(json.error?.details?.faltando).toEqual([
      { chave: "orcamento_vinculado", rotulo: "Orçamento vinculado ao negócio", tipo: "requisito" },
    ]);
    // Funil não permite forçar: nem a marca, nem o `pode_forcar`.
    expect(json.error?.details?.pode_forcar).toBeUndefined();
    expect(falso.banco.stageId).toBe(STAGE_A);
    expect(falso.banco.consultas).toContain("crm_proposals");
  });

  it("funil sem trava não consulta orçamento, agenda nem tarefa", async () => {
    const falso = bancoFalso({});
    vi.mocked(createClient).mockResolvedValue(falso as never);
    const { POST } = await import("./route");
    const r = await POST(request(corpo), contexto);
    expect(r.status).toBe(200);
    expect(falso.banco.consultas).not.toContain("crm_proposals");
    expect(falso.banco.consultas).not.toContain("crm_tasks");
    expect(falso.banco.consultas).not.toContain("calendar_appointments");
  });

  it("funil permite + manager: a recusa oferece forçar; forcar move, anota e audita", async () => {
    const falso = bancoFalso(TRAVA_FORCAVEL);
    vi.mocked(createClient).mockResolvedValue(falso as never);
    const { POST } = await import("./route");

    const recusa = (await (await POST(request(corpo), contexto)).json()) as Recusa;
    expect(recusa.error?.details?.pode_forcar).toBe(true);
    expect(recusa.error?.details?.faltando?.[0]).toMatchObject({ pode_forcar: true });

    const r = await POST(request({ ...corpo, forcar: true }), contexto);
    expect(r.status).toBe(200);
    expect(falso.banco.stageId).toBe(STAGE_B);

    const atividade = vi.mocked(emitLeadActivity).mock.calls.at(-1)?.[1] as {
      reason: string;
      payload: Record<string, unknown>;
    };
    expect(atividade.reason).toBe(
      "Movido de A para B. Movido mesmo assim, sem: Orçamento vinculado ao negócio.",
    );
    expect(atividade.payload.requisitos_pulados).toEqual(["orcamento_vinculado"]);

    const acoes = vi.mocked(audit).mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(acoes).toContain("lead.moved");
    expect(acoes).toContain("lead.stage_gate_overridden");
  });

  it("agent não força, mesmo com o funil permitindo", async () => {
    comoPapel("agent");
    const falso = bancoFalso(TRAVA_FORCAVEL);
    vi.mocked(createClient).mockResolvedValue(falso as never);
    const { POST } = await import("./route");

    const r = await POST(request({ ...corpo, forcar: true }), contexto);
    expect(r.status).toBe(422);
    const json = (await r.json()) as Recusa;
    expect(json.error?.details?.pode_forcar).toBeUndefined();
    expect(falso.banco.stageId).toBe(STAGE_A);
  });

  it("forçar nunca pula campo obrigatório", async () => {
    const falso = bancoFalso({
      ...TRAVA_FORCAVEL,
      fields: [
        { key: "concorrente", label: "Concorrente", type: "text", obrigatorio_em: { etapas: [STAGE_B] } },
      ],
    });
    vi.mocked(createClient).mockResolvedValue(falso as never);
    const { POST } = await import("./route");

    const r = await POST(request({ ...corpo, forcar: true }), contexto);
    expect(r.status).toBe(422);
    const json = (await r.json()) as Recusa;
    expect(json.error?.details?.faltando?.map((i) => i.chave)).toEqual([
      "concorrente",
      "orcamento_vinculado",
    ]);
    expect(falso.banco.stageId).toBe(STAGE_A);
    expect(vi.mocked(audit).mock.calls.map((c) => (c[0] as { action: string }).action)).not.toContain(
      "lead.stage_gate_overridden",
    );
  });
});
