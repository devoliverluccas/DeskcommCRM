// @vitest-environment node
/**
 * O gatilho "Mensagem com palavra-chave" no MOTOR (fase 4, 4.1).
 *
 * Gatilho derivado: nenhuma linha `message.keyword` é emitida — as regras dele
 * são avaliadas sobre o próprio `message.received`, e só as que casam o texto
 * rodam. Este teste fica vermelho se o motor deixar de procurá-las (a regra
 * nunca roda) ou deixar de filtrar pelo texto (roda para toda mensagem).
 *
 *     pnpm vitest run lib/automation/gatilho-palavra-chave-no-motor.test.ts
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { registerAction } from "@/lib/automation/actions";
import { runAutomationForEvent } from "@/lib/automation/engine";
import { automationRulesHandler } from "@/lib/automation/engine.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";

const ORG = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const REGRA_PRECO = "77777777-7777-4777-8777-7777777777a1";
const REGRA_SAIR = "77777777-7777-4777-8777-7777777777b1";
const REGRA_TORTA = "77777777-7777-4777-8777-7777777777c1";

const regrasQueRodaram: string[] = [];
registerAction({
  type: "call_webhook",
  async execute(ctx) {
    regrasQueRodaram.push(ctx.ruleId);
    return { type: "call_webhook", status: "success" };
  },
});

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>): SupabaseClient {
  function consulta(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v));
    const q = {
      select: () => q,
      insert: () => q,
      update: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => {
        filtros.push([c, v]);
        return q;
      },
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then: (ok: (r: { data: Linha[]; error: null }) => unknown) =>
        Promise.resolve({ data: linhas(), error: null }).then(ok),
    };
    return q;
  }
  return { from: consulta } as unknown as SupabaseClient;
}

function regra(id: string, triggerConfig: Record<string, unknown>): Linha {
  return {
    id,
    organization_id: ORG,
    trigger_event: "message.keyword",
    is_active: true,
    name: `Regra ${id.slice(-2)}`,
    conditions: [],
    actions: [{ type: "call_webhook", config: { url: "https://exemplo.test/hook" } }],
    trigger_config: triggerConfig,
  };
}

function mundo(corpo: string): SupabaseClient {
  return bancoFalso({
    automation_rules: [
      regra(REGRA_PRECO, { palavras: ["preço", "valor"], modo: "contem", ignorar_acentos: true }),
      regra(REGRA_SAIR, { palavras: ["sair"], modo: "exata" }),
      regra(REGRA_TORTA, { palavras: [], modo: "contem" }),
    ],
    messages: [{ id: MSG, organization_id: ORG, body: corpo }],
  });
}

function mensagem(eventType = "message.received", preview = ""): EventRow {
  return {
    id: "evt-1",
    organization_id: ORG,
    event_type: eventType,
    entity_kind: "message",
    entity_id: MSG,
    payload: { message_id: MSG, direction: "inbound", body_preview: preview },
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

describe("gatilho de palavra-chave no motor", () => {
  it("o handler do motor assina o gatilho (ele é oferecido na tela)", () => {
    expect(automationRulesHandler.events).toContain("message.keyword");
  });

  it("só a regra cuja palavra está no texto roda — e a regra torta não", async () => {
    regrasQueRodaram.length = 0;
    const r = await runAutomationForEvent(mundo("Oi, qual o PRECO do plano?"), mensagem());
    expect(r.status).toBe("ok");
    expect(regrasQueRodaram).toEqual([REGRA_PRECO]);
  });

  it("modo exata não casa a palavra no meio da frase", async () => {
    regrasQueRodaram.length = 0;
    await runAutomationForEvent(mundo("quero sair do grupo"), mensagem());
    expect(regrasQueRodaram).toEqual([]);
    await runAutomationForEvent(mundo("Sair!"), mensagem());
    expect(regrasQueRodaram).toEqual([REGRA_SAIR]);
  });

  it("sem corpo legível, vale o preview do evento", async () => {
    regrasQueRodaram.length = 0;
    const semMensagem = bancoFalso({
      automation_rules: [regra(REGRA_PRECO, { palavras: ["valor"], modo: "contem" })],
    });
    await runAutomationForEvent(semMensagem, mensagem("message.received", "qual o valor?"));
    expect(regrasQueRodaram).toEqual([REGRA_PRECO]);
  });

  it("mensagem que a equipe enviou não dispara", async () => {
    regrasQueRodaram.length = 0;
    const saida = mensagem();
    saida.payload = { ...saida.payload, direction: "outbound" };
    await runAutomationForEvent(mundo("o preço é 10"), saida);
    expect(regrasQueRodaram).toEqual([]);
  });

  it("uma linha message.keyword no event_log é recusada (ninguém a emite)", async () => {
    regrasQueRodaram.length = 0;
    const r = await runAutomationForEvent(mundo("preço"), mensagem("message.keyword"));
    expect(r).toMatchObject({ status: "skipped", detail: "gatilho_derivado" });
    expect(regrasQueRodaram).toEqual([]);
  });
});
