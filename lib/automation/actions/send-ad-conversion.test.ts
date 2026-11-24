// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { processarConversao } = vi.hoisted(() => ({ processarConversao: vi.fn() }));
vi.mock("@/lib/conversoes/envio.handler", () => ({ processarConversao }));

import { getAction } from "@/lib/automation/actions";
import "./send-ad-conversion";
import type { ActionCtx } from "@/lib/automation/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "33333333-3333-4333-8333-333333333333";
const REGRA = "77777777-7777-4777-8777-777777777777";

function ctx(context: Record<string, unknown>): ActionCtx {
  return {
    admin: {} as ActionCtx["admin"],
    organizationId: ORG,
    ruleId: REGRA,
    ruleName: "Conversão",
    event: {
      id: "evt-1",
      organization_id: ORG,
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "msg-1",
      payload: {},
      metadata: {},
      consumed_by: [],
      attempts: 0,
    },
    context,
    requestId: "evt-1",
  };
}

describe("ação send_ad_conversion", () => {
  it("a venda chama o envio das regras de conversão com o negócio como entidade", async () => {
    processarConversao.mockReset().mockResolvedValue({ consumer_key: "x", status: "ok" });
    const r = await getAction("send_ad_conversion")!.execute(ctx({ lead: { id: LEAD } }), { evento: "Purchase" });
    expect(r.status).toBe("success");
    expect(processarConversao).toHaveBeenCalledTimes(1);
    const [linha, etapa] = processarConversao.mock.calls[0]!;
    expect(linha).toMatchObject({ entity_id: LEAD, organization_id: ORG, entity_kind: "crm_lead" });
    expect(etapa).toBeUndefined();
  });

  it("evento padrão da Meta vai como etapa, com chave por regra", async () => {
    processarConversao.mockReset().mockResolvedValue({ consumer_key: "x", status: "ok" });
    await getAction("send_ad_conversion")!.execute(ctx({ lead: { id: LEAD } }), { evento: "QualifiedLead" });
    const [, etapa] = processarConversao.mock.calls[0]!;
    expect(etapa).toMatchObject({ evento: `MetaEtapa:${REGRA}`, eventoMeta: "QualifiedLead" });
  });

  it("pulo e espera do envio viram motivo nomeado; sem negócio não chama nada", async () => {
    processarConversao.mockReset().mockResolvedValue({ consumer_key: "x", status: "skipped", detail: "sem_atribuicao" });
    expect(await getAction("send_ad_conversion")!.execute(ctx({ lead: { id: LEAD } }), { evento: "Purchase" })).toMatchObject({
      status: "skipped",
      detail: { reason: "conversao_nao_enviada", motivo_do_envio: "sem_atribuicao" },
    });

    processarConversao.mockReset().mockResolvedValue({ consumer_key: "x", status: "retry", detail: "transitorio" });
    expect(await getAction("send_ad_conversion")!.execute(ctx({ lead: { id: LEAD } }), { evento: "Purchase" })).toMatchObject({
      status: "failed",
      error: "conversao_adiada",
    });

    processarConversao.mockReset();
    expect(await getAction("send_ad_conversion")!.execute(ctx({}), { evento: "Purchase" })).toMatchObject({
      status: "skipped",
      detail: { reason: "conversao_sem_negocio" },
    });
    expect(processarConversao).not.toHaveBeenCalled();
  });
});
