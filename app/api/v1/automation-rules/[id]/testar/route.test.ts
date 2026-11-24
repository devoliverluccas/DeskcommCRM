// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

/**
 * O "Testar" do editor (fase 4, 4.1): simula a regra contra um contato SEM
 * EFEITO. O dublê do banco anota qualquer escrita — e a única aceita é nenhuma:
 * a auditoria sai pelo `audit()` (mockado), não pelo client da sessão.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const RULE = "77777777-7777-4777-8777-777777777777";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const CANAL = "44444444-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;

function banco(tabelas: Record<string, Linha[]>) {
  const escritas: string[] = [];
  function consulta(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v));
    const escrever = () => {
      escritas.push(tabela);
      return q;
    };
    const q: Record<string, unknown> = {
      select: () => q,
      not: () => q,
      order: () => q,
      limit: () => q,
      in: () => q,
      gte: () => q,
      gt: () => q,
      lte: () => q,
      insert: escrever,
      update: escrever,
      upsert: escrever,
      delete: escrever,
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
  return { db: { from: consulta, rpc: async () => ({ data: null, error: null }) }, escritas };
}

function regra(extra: Linha = {}): Linha {
  return {
    id: RULE,
    organization_id: ORG,
    trigger_event: "message.keyword",
    trigger_config: { palavras: ["preço"], modo: "contem" },
    conditions: [],
    actions: [
      { type: "send_whatsapp_message", config: { channel_session_id: CANAL, template: "Olá {{contact.name}}" } },
      { type: "pause_ai", config: {} },
    ],
    ...extra,
  };
}

function mundo(r: Linha = regra(), canalStatus = "WORKING") {
  return banco({
    automation_rules: [r],
    contacts: [{ id: CONTATO, organization_id: ORG, name: "Ana", phone_number: "5511999990000" }],
    conversations: [{ id: CONVERSA, organization_id: ORG, contact_id: CONTATO }],
    channel_sessions: [{ id: CANAL, organization_id: ORG, status: canalStatus, metadata: {} }],
    organizations: [{ id: ORG, locale: "pt-BR", timezone: "America/Sao_Paulo" }],
  });
}

function autenticar() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u-1", idioma: "pt-BR" },
    org: { orgId: ORG, name: "Org", role: "manager" },
  } as never);
}

function req(body: unknown) {
  return new NextRequest(`http://localhost/api/v1/automation-rules/${RULE}/testar`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: RULE }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/v1/automation-rules/[id]/testar", () => {
  it("avalia a palavra-chave, descreve as ações e não escreve nada além da auditoria", async () => {
    autenticar();
    const { db, escritas } = mundo();
    vi.mocked(createClient).mockResolvedValue(db as never);
    const { POST } = await import("./route");

    const res = await POST(req({ contact_id: CONTATO, texto: "Qual o preco?" }), params);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      gatilho: { situacao: "casou", palavra: "preço" },
      condicoes: { situacao: "sem_condicoes" },
      rodaria: true,
      alvo: { contato: { id: CONTATO, name: "Ana" }, conversa_id: CONVERSA },
    });
    expect(data.acoes).toEqual([
      expect.objectContaining({ type: "send_whatsapp_message", rodaria: true, aviso: null, previa: "Olá Ana" }),
      expect.objectContaining({ type: "pause_ai", rodaria: true, aviso: null }),
    ]);
    expect(escritas).toEqual([]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "automation.rule_tested", resourceId: RULE }));
  });

  it("texto sem a palavra não roda; canal desconectado vira aviso na ação", async () => {
    autenticar();
    const { db } = mundo(regra(), "SCAN_QR_CODE");
    vi.mocked(createClient).mockResolvedValue(db as never);
    const { POST } = await import("./route");

    const res = await POST(req({ contact_id: CONTATO, texto: "bom dia" }), params);
    const { data } = (await res.json()) as {
      data: { rodaria: boolean; gatilho: { situacao: string }; acoes: Array<{ aviso: string | null }> };
    };
    expect(data.gatilho.situacao).toBe("nao_casou");
    expect(data.rodaria).toBe(false);
    expect(data.acoes[0]!.aviso).toBe("canal_inativo");
  });

  it("condição que não passa é avaliada de verdade", async () => {
    autenticar();
    const { db } = mundo(
      regra({ trigger_event: "message.received", trigger_config: {}, conditions: [{ field: "contact.name", op: "eq", value: "Bia" }] }),
    );
    vi.mocked(createClient).mockResolvedValue(db as never);
    const { POST } = await import("./route");
    const res = await POST(req({ contact_id: CONTATO }), params);
    const { data } = (await res.json()) as { data: { gatilho: { situacao: string }; condicoes: { situacao: string }; rodaria: boolean } };
    expect(data.gatilho.situacao).toBe("suposto");
    expect(data.condicoes.situacao).toBe("nao_passam");
    expect(data.rodaria).toBe(false);
  });

  it("sem contato nem conversa → 400; regra de outra organização → 404; contato inexistente → 404", async () => {
    autenticar();
    const { db } = mundo();
    vi.mocked(createClient).mockResolvedValue(db as never);
    const { POST } = await import("./route");

    expect((await POST(req({}), params)).status).toBe(400);

    const vazio = banco({ automation_rules: [] });
    vi.mocked(createClient).mockResolvedValue(vazio.db as never);
    expect((await POST(req({ contact_id: CONTATO }), params)).status).toBe(404);

    vi.mocked(createClient).mockResolvedValue(db as never);
    expect((await POST(req({ contact_id: "99999999-9999-4999-8999-999999999999" }), params)).status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });
});
