import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";

import { encerrarInativas, MOTIVO_DA_INATIVIDADE, ultimaPalavraFoiDaEquipe } from "./route";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const AGORA = new Date("2026-11-24T12:00:00Z");
const ORG = "org-ligada";

interface Estado {
  orgs: Array<{ id: string; settings: unknown }>;
  paradas: string[];
  conversas: Array<Record<string, unknown>>;
  demandas: Record<string, { id: string; revision: number; fechada_em: string | null }>;
  rpcErro: Record<string, { code: string; message: string } | null>;
}

let estado: Estado;
const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
const filtrosDaConversa: Array<[string, unknown]> = [];

function fakeAdmin() {
  return {
    from(tabela: string) {
      const filtros: Array<[string, string, unknown]> = [];
      const q: Record<string, unknown> = {};
      const passo = (op: string) => (col: string, val?: unknown) => {
        filtros.push([op, col, val]);
        if (tabela === "conversations") filtrosDaConversa.push([`${op}:${col}`, val]);
        return q;
      };
      for (const op of ["eq", "neq", "in", "is", "lt", "not"]) q[op] = passo(op);
      q.select = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => {
        const id = filtros.find(([op, col]) => op === "eq" && col === "id")?.[2] as string;
        return { data: estado.demandas[id] ?? null, error: null };
      };
      q.then = (resolve: (x: unknown) => unknown) => {
        let data: unknown = [];
        if (tabela === "organizations") {
          data = filtros.some(([op]) => op === "neq") ? estado.paradas.map((id) => ({ id })) : estado.orgs;
        } else if (tabela === "conversations") {
          data = estado.conversas;
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return q;
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      const chave = `${nome}:${String(args.p_conversation ?? args.p_demanda)}`;
      return { data: null, error: estado.rpcErro[chave] ?? null };
    },
  };
}

const conversa = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  service_revision: 4,
  current_demanda_id: "d1",
  last_inbound_at: "2026-11-23T08:00:00Z",
  last_outbound_at: "2026-11-23T09:00:00Z",
  snooze_until: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  rpcs.length = 0;
  filtrosDaConversa.length = 0;
  estado = {
    orgs: [{ id: ORG, settings: { atendimento: { encerrar_inativas_apos_horas: 24 } } }],
    paradas: [],
    conversas: [conversa()],
    demandas: { d1: { id: "d1", revision: 7, fechada_em: null } },
    rpcErro: {},
  };
});

const rodar = () =>
  encerrarInativas(fakeAdmin() as unknown as Parameters<typeof encerrarInativas>[0], AGORA, "req-1");

describe("cron encerrar-inativas (item 3.8)", () => {
  it("encerra pela porta do botão Fechar (CAS da revisão), fecha a demanda com desfecho de sistema e audita UMA linha", async () => {
    const r = await rodar();
    expect(r).toEqual({ organizacoes: 1, examinadas: 1, encerradas: 1, falhas: 0 });
    expect(rpcs[0]).toEqual({
      nome: "fn_service_status",
      args: { p_org: ORG, p_conversation: "c1", p_status: "closed", p_expected: 4 },
    });
    expect(rpcs[1]).toMatchObject({
      nome: "fn_demanda_encerrar",
      args: { p_org: ORG, p_demanda: "d1", p_expected: 7, p_desfecho: "expirada_sem_resposta", p_actor: null },
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "conversation.encerrada_por_inatividade",
        organizationId: ORG,
        resourceId: "c1",
        metadata: { motivo: MOTIVO_DA_INATIVIDADE, apos_horas: 24 },
      }),
    );
  });

  it("a varredura pede só conversa viva, sem cliente esperando, não pendente, não grupo, com a última saída antes do corte", async () => {
    await rodar();
    expect(filtrosDaConversa).toContainEqual(["eq:organization_id", ORG]);
    expect(filtrosDaConversa).toContainEqual(["is:awaiting_since", null]);
    expect(filtrosDaConversa).toContainEqual(["is:pendente_em", null]);
    expect(filtrosDaConversa).toContainEqual(["eq:is_group", false]);
    expect(filtrosDaConversa).toContainEqual(["lt:last_outbound_at", "2026-11-23T12:00:00.000Z"]);
  });

  it("cliente respondeu por último: NUNCA encerra (é a conversa que espera a equipe)", async () => {
    estado.conversas = [conversa({ last_inbound_at: "2026-11-23T10:00:00Z" })];
    const r = await rodar();
    expect(r.encerradas).toBe(0);
    expect(rpcs).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("lembrada para depois (snooze no futuro) não é encerrada", async () => {
    estado.conversas = [conversa({ snooze_until: "2026-11-25T00:00:00Z" })];
    expect((await rodar()).encerradas).toBe(0);
  });

  it("desligado (sem a chave) ou organização parada: nada é lido nem encerrado, nada audita", async () => {
    estado.orgs = [{ id: ORG, settings: { atendimento: { encerrar_inativas_apos_horas: null } } }];
    expect(await rodar()).toEqual({ organizacoes: 0, examinadas: 0, encerradas: 0, falhas: 0 });
    estado.orgs = [{ id: ORG, settings: { atendimento: { encerrar_inativas_apos_horas: 24 } } }];
    estado.paradas = [ORG];
    expect((await rodar()).organizacoes).toBe(0);
    expect(rpcs).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("CAS recusou (alguém mexeu): conta falha, não audita e não toca a demanda", async () => {
    estado.rpcErro["fn_service_status:c1"] = { code: "PT409", message: "service_stale" };
    const r = await rodar();
    expect(r).toMatchObject({ encerradas: 0, falhas: 1 });
    expect(rpcs.map((x) => x.nome)).toEqual(["fn_service_status"]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("idempotente: a segunda rodada, com a conversa já fora da varredura, não faz nada", async () => {
    await rodar();
    estado.conversas = [];
    vi.mocked(audit).mockClear();
    expect((await rodar()).encerradas).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("ultimaPalavraFoiDaEquipe", () => {
  it("sem saída nunca; sem entrada, a saída basta", () => {
    expect(ultimaPalavraFoiDaEquipe({ last_inbound_at: null, last_outbound_at: null })).toBe(false);
    expect(ultimaPalavraFoiDaEquipe({ last_inbound_at: null, last_outbound_at: "2026-11-23T09:00:00Z" })).toBe(true);
  });
});
