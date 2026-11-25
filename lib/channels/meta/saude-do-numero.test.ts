import { afterEach, describe, expect, it, vi } from "vitest";

import {
  avisoDaQueda,
  conversasDoLimite,
  gravarSaudeDoNumero,
  leituraEnvelheceu,
  lerSaudeNaGraph,
  normalizarLimite,
  normalizarQualidade,
  qualidadeDoEvento,
  tituloDaQueda,
} from "./saude-do-numero";
import { parseMetaWebhook } from "./webhook";

const ORG = "00000000-0000-4000-8000-000000000001";
const SESSAO = "00000000-0000-4000-8000-000000000002";

describe("vocabulário da saúde", () => {
  it("nota: o da Graph, o do Gerenciador e o desconhecido", () => {
    expect(normalizarQualidade("green")).toBe("GREEN");
    expect(normalizarQualidade("MEDIUM")).toBe("YELLOW");
    expect(normalizarQualidade("LOW")).toBe("RED");
    expect(normalizarQualidade("NOVA_COR")).toBe("UNKNOWN");
    expect(normalizarQualidade(undefined)).toBeNull();
  });
  it("limite: só a forma TIER_*, e a conta de conversas", () => {
    expect(normalizarLimite("tier_1k")).toBe("TIER_1K");
    expect(normalizarLimite("ilimitado")).toBeNull();
    expect(conversasDoLimite("TIER_250")).toBe(250);
    expect(conversasDoLimite("TIER_10K")).toBe(10_000);
    expect(conversasDoLimite("TIER_UNLIMITED")).toBeNull();
    expect(conversasDoLimite("TIER_ESTRANHO")).toBeUndefined();
  });
  it("FLAGGED é nota baixa; UNFLAGGED não afirma nota nenhuma", () => {
    expect(qualidadeDoEvento("FLAGGED")).toBe("RED");
    expect(qualidadeDoEvento("UNFLAGGED")).toBeNull();
    expect(qualidadeDoEvento("UPGRADE")).toBeNull();
  });
  it("leitura envelhece em 30 minutos; sem leitura, envelheceu", () => {
    const agora = new Date("2026-11-25T12:00:00Z");
    expect(leituraEnvelheceu(null, agora)).toBe(true);
    expect(leituraEnvelheceu("2026-11-25T11:50:00Z", agora)).toBe(false);
    expect(leituraEnvelheceu("2026-11-25T11:00:00Z", agora)).toBe(true);
  });
});

describe("avisoDaQueda", () => {
  it("avisa só quando piora para média ou baixa", () => {
    expect(avisoDaQueda("GREEN", "YELLOW", "Loja")).toMatchObject({ severity: "warn", kind: "channel_number_alert" });
    expect(avisoDaQueda("YELLOW", "RED", "Loja")).toMatchObject({ severity: "critical" });
    expect(avisoDaQueda(null, "RED", "Loja")).not.toBeNull();
    expect(avisoDaQueda("RED", "RED", "Loja")).toBeNull();
    expect(avisoDaQueda("RED", "YELLOW", "Loja")).toBeNull();
    expect(avisoDaQueda("YELLOW", "GREEN", "Loja")).toBeNull();
  });
});

describe("parseMetaWebhook — saúde do número", () => {
  it("lê phone_number_quality_update e account_update", () => {
    const eventos = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              field: "phone_number_quality_update",
              value: { display_phone_number: "5541999999999", event: "FLAGGED", current_limit: "TIER_1K" },
            },
            { field: "account_update", value: { event: "ACCOUNT_RESTRICTION", phone_number: "5541999999999" } },
            { field: "phone_number_quality_update", value: {} },
          ],
        },
      ],
    });
    expect(eventos).toEqual([
      {
        kind: "number_quality",
        wabaId: "WABA1",
        displayPhoneNumber: "5541999999999",
        event: "FLAGGED",
        currentLimit: "TIER_1K",
        quality: null,
      },
      { kind: "account_update", wabaId: "WABA1", event: "ACCOUNT_RESTRICTION", phoneNumber: "5541999999999" },
    ]);
  });
});

/** Admin falso: a linha da conexão, as escritas e os avisos. */
function adminFalso(linha: Record<string, unknown> | null, avisoAberto = false) {
  const updates: Array<{ tabela: string; valores: Record<string, unknown>; filtros: Array<[string, unknown]> }> = [];
  const inserts: Array<{ tabela: string; valores: Record<string, unknown> }> = [];
  const admin = {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      let modo: "select" | "update" = "select";
      let valores: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        update: (v: Record<string, unknown>) => {
          modo = "update";
          valores = v;
          return q;
        },
        insert: async (v: Record<string, unknown>) => {
          inserts.push({ tabela, valores: v });
          return { error: null };
        },
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return q;
        },
        in: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return q;
        },
        limit: () => q,
        maybeSingle: async () => {
          if (tabela === "channel_sessions") return { data: linha, error: null };
          return { data: avisoAberto ? { id: "x" } : null, error: null };
        },
        then: (resolve: (r: unknown) => void) => {
          if (modo === "update") updates.push({ tabela, valores, filtros });
          resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { admin, updates, inserts };
}

describe("gravarSaudeDoNumero", () => {
  const alvo = { organizationId: ORG, channelSessionId: SESSAO };
  const linha = { id: SESSAO, display_name: "Loja", phone_number: "+5541999999999", meta_quality_rating: "GREEN" };

  it("queda para baixa: grava a nota e o limite, filtra pela organização e abre aviso", async () => {
    const { admin, updates, inserts } = adminFalso(linha);
    const r = await gravarSaudeDoNumero(admin as never, alvo, {
      qualidade: "RED",
      limite: "TIER_1K",
      numeroExibido: "5541999999999",
    });
    expect(r).toBe("saude:aviso");
    const escrita = updates.find((u) => u.tabela === "channel_sessions")!;
    expect(escrita.valores).toMatchObject({ meta_quality_rating: "RED", meta_messaging_limit_tier: "TIER_1K" });
    expect(escrita.filtros).toContainEqual(["organization_id", ORG]);
    expect(inserts).toEqual([
      expect.objectContaining({
        tabela: "agent_inbox_items",
        valores: expect.objectContaining({
          organization_id: ORG,
          kind: "channel_number_alert",
          severity: "critical",
          ref_kind: "channel_session",
          ref_id: SESSAO,
          title: tituloDaQueda("RED", "Loja"),
        }),
      }),
    ]);
  });

  it("aviso igual já aberto não repete", async () => {
    const { admin, inserts } = adminFalso(linha, true);
    expect(await gravarSaudeDoNumero(admin as never, alvo, { qualidade: "RED" })).toBe("saude");
    expect(inserts).toEqual([]);
  });

  it("evento de outro número da mesma conta não toca esta conexão", async () => {
    const { admin, updates } = adminFalso(linha);
    expect(await gravarSaudeDoNumero(admin as never, alvo, { qualidade: "RED", numeroExibido: "5511888887777" })).toBe(
      "saude:outro_numero",
    );
    expect(updates).toEqual([]);
  });

  it("voltou ao verde: fecha os avisos de queda desta conexão", async () => {
    const { admin, updates, inserts } = adminFalso({ ...linha, meta_quality_rating: "RED" });
    await gravarSaudeDoNumero(admin as never, alvo, { qualidade: "GREEN" });
    const fechamento = updates.find((u) => u.tabela === "agent_inbox_items")!;
    expect(fechamento.valores).toEqual({ status: "resolved" });
    expect(fechamento.filtros).toContainEqual(["ref_id", SESSAO]);
    expect(inserts).toEqual([]);
  });

  it("restrição da conta abre aviso crítico", async () => {
    const { admin, inserts } = adminFalso(linha);
    expect(await gravarSaudeDoNumero(admin as never, alvo, { eventoDaConta: "account_restriction" })).toBe("saude:aviso");
    expect(inserts[0]!.valores).toMatchObject({ severity: "critical" });
  });

  it("conexão que não é desta organização: nada a gravar", async () => {
    const { admin, updates } = adminFalso(null);
    expect(await gravarSaudeDoNumero(admin as never, alvo, { qualidade: "RED" })).toBe("saude:sem_conexao");
    expect(updates).toEqual([]);
  });
});

describe("lerSaudeNaGraph", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pergunta os dois campos e normaliza a resposta", async () => {
    const fetchFalso = vi.fn(async () =>
      new Response(JSON.stringify({ quality_rating: "YELLOW", messaging_limit_tier: "TIER_10K" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchFalso);
    const r = await lerSaudeNaGraph({ phoneNumberId: "123", token: "tok", graphVersion: "v22.0" });
    expect(r).toEqual({ ok: true, qualidade: "YELLOW", limite: "TIER_10K" });
    expect(String((fetchFalso.mock.calls[0] as unknown[])[0])).toContain("/123?fields=quality_rating,messaging_limit_tier");
  });

  it("erro da Meta vira motivo, nunca exceção", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "token expirado" } }), { status: 400 })));
    expect(await lerSaudeNaGraph({ phoneNumberId: "123", token: "tok" })).toEqual({ ok: false, motivo: "token expirado" });
  });
});
