// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const { registrar } = vi.hoisted(() => ({ registrar: vi.fn(async (_entrada: unknown) => undefined) }));
vi.mock("@/lib/inbox/atividade-de-comando", () => ({ registrarTrocaDeComando: registrar }));

import { getAction } from "@/lib/automation/actions";
import "./pause-ai";
import type { ActionCtx } from "@/lib/automation/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown>;

function bancoFalso(conversas: Linha[]) {
  const updates: Array<{ tabela: string; valores: Linha; filtros: Array<[string, unknown]> }> = [];
  function consulta(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    let atualizando: Linha | null = null;
    const linhas = () => conversas.filter((l) => filtros.every(([c, v]) => l[c] === v));
    const q = {
      select: () => q,
      not: () => q,
      order: () => q,
      limit: () => q,
      update: (valores: Linha) => {
        atualizando = valores;
        return q;
      },
      eq: (c: string, v: unknown) => {
        filtros.push([c, v]);
        return q;
      },
      maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
      then: (ok: (r: { data: null; error: null }) => unknown) => {
        if (atualizando) updates.push({ tabela, valores: atualizando, filtros: [...filtros] });
        return Promise.resolve({ data: null, error: null }).then(ok);
      },
    };
    return q;
  }
  return { db: { from: consulta } as unknown as SupabaseClient, updates };
}

function ctx(db: SupabaseClient, payload: Linha): ActionCtx {
  return {
    admin: db,
    organizationId: ORG,
    ruleId: "regra-1",
    ruleName: "Pausar quando pedir humano",
    event: {
      id: "evt-1",
      organization_id: ORG,
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "msg-1",
      payload,
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context: {},
    requestId: "evt-1",
  };
}

const conversa = (extra: Linha = {}): Linha => ({
  id: CONV,
  organization_id: ORG,
  contact_id: "contato-1",
  status: "ai_handling",
  assigned_to_user_id: null,
  bot_silenced_until: null,
  ...extra,
});

describe("ação pause_ai", () => {
  it("silencia a IA da conversa do evento para sempre e devolve à fila quando ninguém é dono", async () => {
    registrar.mockClear();
    const { db, updates } = bancoFalso([conversa()]);
    const r = await getAction("pause_ai")!.execute(ctx(db, { conversation_id: CONV }), {});
    expect(r).toMatchObject({ status: "success", detail: { mudou: true, voltou_para_a_fila: true } });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.valores).toMatchObject({ bot_silenced_until: "infinity", status: "pending" });
    expect(updates[0]!.filtros).toContainEqual(["organization_id", ORG]);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "conversation_ai_paused" }));
  });

  it("com dono, só silencia — não mexe no status", async () => {
    const { db, updates } = bancoFalso([conversa({ assigned_to_user_id: "u-1", status: "claimed" })]);
    await getAction("pause_ai")!.execute(ctx(db, { conversation_id: CONV }), {});
    expect(updates[0]!.valores).not.toHaveProperty("status");
  });

  it("já pausada é sucesso sem escrita; encerrada e sem conversa são pulos nomeados", async () => {
    const pausada = bancoFalso([conversa({ bot_silenced_until: "infinity" })]);
    expect(await getAction("pause_ai")!.execute(ctx(pausada.db, { conversation_id: CONV }), {})).toMatchObject({
      status: "success",
      detail: { mudou: false },
    });
    expect(pausada.updates).toEqual([]);

    const encerrada = bancoFalso([conversa({ status: "closed" })]);
    expect(await getAction("pause_ai")!.execute(ctx(encerrada.db, { conversation_id: CONV }), {})).toMatchObject({
      status: "skipped",
      detail: { reason: "pausa_sem_conversa_aberta" },
    });

    const nada = bancoFalso([]);
    expect(await getAction("pause_ai")!.execute(ctx(nada.db, {}), {})).toMatchObject({
      status: "skipped",
      detail: { reason: "pausa_sem_conversa_aberta" },
    });
  });
});
