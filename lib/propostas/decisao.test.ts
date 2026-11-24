import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  emitLeadActivity: vi.fn(),
  cancelaRetornoNoCrm: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: mocks.emitLeadActivity }));
vi.mock("@/lib/followup/retorno-crm", () => ({ cancelaRetornoNoCrm: mocks.cancelaRetornoNoCrm }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { registrarDecisao } from "./decisao";

/** Um `crm_proposals` de uma linha só, que respeita os filtros do UPDATE. */
function banco(linha: Record<string, unknown>) {
  const gravado: { patch: Record<string, unknown> | null } = { patch: null };
  const db = {
    from: () => {
      let patch: Record<string, unknown> = {};
      const filtros = new Map<string, unknown>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        update: (p: Record<string, unknown>) => {
          patch = p;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filtros.set(c, v);
          return q;
        },
        select: () => q,
        maybeSingle: async () => {
          if (![...filtros].every(([c, v]) => linha[c] === v)) return { data: null, error: null };
          Object.assign(linha, patch);
          gravado.patch = patch;
          return { data: { ...linha }, error: null };
        },
      };
      return q;
    },
  };
  return { db: db as never, gravado };
}

const BASE = {
  id: "p1",
  organization_id: "org-1",
  lead_id: "lead-1",
  contact_id: "c1",
  retorno_id: "ret-1",
  status: "enviada",
};

beforeEach(() => vi.resetAllMocks());

describe("registrarDecisao — o MESMO efeito pelas duas portas", () => {
  it("cliente: grava decided_via='cliente' SEM usuário, e o efeito no negócio é o da equipe", async () => {
    const { db, gravado } = banco({ ...BASE });
    const r = await registrarDecisao(db, {
      orgId: "org-1",
      propostaId: "p1",
      decisao: "aceita",
      motivo: null,
      quem: { via: "cliente", linkId: "link-1" },
      requestId: "req",
    });
    expect(r).toEqual({ ok: true, id: "p1", status: "aceita" });
    expect(gravado.patch).toMatchObject({ status: "aceita", decided_by_user_id: null, decided_via: "cliente" });
    expect(mocks.emitLeadActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "proposal_accepted", leadId: "lead-1", payload: { decided_via: "cliente" } }),
    );
    expect(mocks.cancelaRetornoNoCrm).toHaveBeenCalledWith(expect.anything(), "ret-1", expect.anything());
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "proposal.aceita",
        actorUserId: null,
        metadata: { decided_via: "cliente", link_id: "link-1" },
      }),
    );
  });

  it("equipe: grava o usuário e NÃO escreve decided_via (a sessão não pode — a coluna fica 'equipe')", async () => {
    const { db, gravado } = banco({ ...BASE });
    await registrarDecisao(db, {
      orgId: "org-1",
      propostaId: "p1",
      decisao: "recusada",
      motivo: "caro",
      quem: { via: "equipe", userId: "u1" },
      requestId: "req",
    });
    expect(gravado.patch).toMatchObject({ status: "recusada", decided_by_user_id: "u1", decision_reason: "caro" });
    expect(gravado.patch).not.toHaveProperty("decided_via");
    expect(mocks.emitLeadActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ type: "proposal_declined", actor: { type: "user", id: "u1" } }),
    );
  });

  it("proposta que não está enviada: nao_enviada, sem atividade nem auditoria", async () => {
    const { db } = banco({ ...BASE, status: "aceita" });
    const r = await registrarDecisao(db, {
      orgId: "org-1",
      propostaId: "p1",
      decisao: "recusada",
      motivo: null,
      quem: { via: "cliente", linkId: "link-1" },
      requestId: "req",
    });
    expect(r).toEqual({ ok: false, motivo: "nao_enviada" });
    expect(mocks.emitLeadActivity).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("proposta de outra organização: não decide", async () => {
    const { db } = banco({ ...BASE, organization_id: "org-2" });
    const r = await registrarDecisao(db, {
      orgId: "org-1",
      propostaId: "p1",
      decisao: "aceita",
      motivo: null,
      quem: { via: "cliente", linkId: "link-1" },
      requestId: "req",
    });
    expect(r.ok).toBe(false);
  });
});
