import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  calcularNps,
  capturarRespostaDeSatisfacao,
  lerNotaDaResposta,
  lerOpcaoDaSatisfacao,
  pedirSatisfacaoAoEncerrar,
  resumoDaSatisfacao,
  TEXTO_DA_PERGUNTA_NPS,
  TEXTO_DA_PERGUNTA_PADRAO,
} from "@/lib/atendimento/satisfacao";

import { bancoFake } from "./_duplo-de-banco-692";

import { PATCH as patchDaPesquisa } from "@/app/api/v1/settings/atendimento/route";

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: vi.fn() }));
vi.mock("@/lib/automation/janela-do-canal", () => ({ adiarAteAJanelaAbrir: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * 3.4 — A PESQUISA DO ENCERRAMENTO NO MODO NPS (0 A 10).
 *
 * ─── O QUE ESTE ARQUIVO PRENDE ──────────────────────────────────────────────
 *
 *   - a régua é escolha da organização, com o 1 a 5 de sempre como padrão;
 *   - a pergunta padrão acompanha a régua (a de 1 a 5 gravada no bloco desde o
 *     #4023 não sai com a régua em NPS);
 *   - o pedido NASCE com a régua, e a resposta é lida na régua do PEDIDO: "0" e
 *     "10!" são nota num pedido NPS; "8" num pedido de 1 a 5 não é nota e o
 *     pedido continua esperando;
 *   - NPS = %promotores(9–10) − %detratores(0–6), `null` sem resposta;
 *   - o PATCH grava a régua escolhida sem perder o resto do bloco.
 *
 * ─── SABOTAGEM ──────────────────────────────────────────────────────────────
 *
 *   - ler a nota sempre na régua de 1 a 5: o "10!" do pedido NPS acusa;
 *   - ler a régua da CONFIGURAÇÃO em vez do pedido: o "8" do pedido CSAT acusa;
 *   - contar neutro como promotor: o NPS de 9/8/0 acusa (daria 33, é 0).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const CONVERSA = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendMessageHandler).mockResolvedValue({ id: "msg-1", status: "sent" } as never);
  vi.mocked(adiarAteAJanelaAbrir).mockResolvedValue(null);
});

describe("3.4 — o leitor de nota segue a régua", () => {
  it("NPS: entende 0 a 10 com pontuação, prefixo e 'de 10'", () => {
    expect(lerNotaDaResposta("0", "nps_0_10")).toBe(0);
    expect(lerNotaDaResposta("10", "nps_0_10")).toBe(10);
    expect(lerNotaDaResposta("10!", "nps_0_10")).toBe(10);
    expect(lerNotaDaResposta("nota 9", "nps_0_10")).toBe(9);
    expect(lerNotaDaResposta("nota: 7", "nps_0_10")).toBe(7);
    expect(lerNotaDaResposta("8/10", "nps_0_10")).toBe(8);
    expect(lerNotaDaResposta("6 de 10", "nps_0_10")).toBe(6);
    expect(lerNotaDaResposta("9 👍", "nps_0_10")).toBe(9);
  });

  it("NPS: continua estrito — número que não é nota não vira nota", () => {
    expect(lerNotaDaResposta("11", "nps_0_10")).toBeNull();
    expect(lerNotaDaResposta("50", "nps_0_10")).toBeNull();
    expect(lerNotaDaResposta("2024", "nps_0_10")).toBeNull();
    expect(lerNotaDaResposta("10 reais", "nps_0_10")).toBeNull();
    expect(lerNotaDaResposta("quero 3 caixas", "nps_0_10")).toBeNull();
  });

  it("CSAT (padrão) não mudou: 0 e 8 não são nota de 1 a 5", () => {
    expect(lerNotaDaResposta("0")).toBeNull();
    expect(lerNotaDaResposta("8")).toBeNull();
    expect(lerNotaDaResposta("4 de 5")).toBe(4);
  });
});

describe("3.4 — o NPS", () => {
  it("é %promotores − %detratores, com neutro no total", () => {
    expect(calcularNps({ "9": 1, "8": 1, "0": 1 }).nps).toBe(0);
    expect(calcularNps({ "10": 3, "7": 1 }).nps).toBe(75);
    expect(calcularNps({ "6": 2 }).nps).toBe(-100);
    const r = calcularNps({ "10": 2, "9": 1, "8": 1, "5": 1 });
    expect(r).toEqual({ nps: 40, respostas: 5, promotores: 3, neutros: 1, detratores: 1 });
  });

  it("sem resposta é null, não zero; chave fora de 0–10 é ignorada", () => {
    expect(calcularNps({}).nps).toBeNull();
    expect(calcularNps(null).nps).toBeNull();
    expect(calcularNps({ "11": 4, "-1": 2, x: 1 }).nps).toBeNull();
  });
});

describe("3.4 — a opção da organização", () => {
  it("padrão é 1 a 5; NPS troca a pergunta padrão, e texto da empresa fica", () => {
    expect(lerOpcaoDaSatisfacao({ satisfacao: { ligado: true } }).escala).toBe("csat_1_5");
    const nps = lerOpcaoDaSatisfacao({
      satisfacao: { ligado: true, escala: "nps_0_10", pergunta: TEXTO_DA_PERGUNTA_PADRAO },
    });
    expect(nps.escala).toBe("nps_0_10");
    expect(nps.pergunta).toBe(TEXTO_DA_PERGUNTA_NPS);
    const propria = lerOpcaoDaSatisfacao({
      satisfacao: { ligado: true, escala: "nps_0_10", pergunta: "Dê uma nota de 0 a 10 para a loja!" },
    });
    expect(propria.pergunta).toBe("Dê uma nota de 0 a 10 para a loja!");
    expect(lerOpcaoDaSatisfacao({ satisfacao: { escala: "likert" } }).escala).toBe("csat_1_5");
  });
});

describe("3.4 — o pedido nasce com a régua e a resposta é lida nela", () => {
  it("com NPS ligado, a pergunta é a de 0 a 10 e o pedido guarda nps_0_10", async () => {
    const banco = bancoFake({ settings: { satisfacao: { ligado: true, escala: "nps_0_10" } } });

    const desfecho = await pedirSatisfacaoAoEncerrar(banco.client, {
      organizationId: ORG,
      conversationId: CONVERSA,
      contactId: CONTATO,
    });

    expect(desfecho.pedida).toBe(true);
    expect(banco.estado.pedidos[0]?.escala).toBe("nps_0_10");
    const entrada = vi.mocked(sendMessageHandler).mock.calls[0]?.[2] as { body: string };
    expect(entrada.body).toBe(TEXTO_DA_PERGUNTA_NPS);
  });

  const pedido = (escala: "csat_1_5" | "nps_0_10") => ({
    id: "pedido-1",
    organization_id: ORG,
    conversation_id: CONVERSA,
    contact_id: CONTATO,
    status: "aguardando" as const,
    perguntado_em: "2026-11-24T10:00:00.000Z",
    expira_em: "2026-11-25T10:00:00.000Z",
    escala,
  });

  it("pedido NPS: '0' vira nota zero (não silêncio)", async () => {
    const banco = bancoFake({ pedidos: [pedido("nps_0_10")] });
    const r = await capturarRespostaDeSatisfacao(banco.client, {
      organizationId: ORG,
      conversationId: CONVERSA,
      texto: "0",
      enviadaEm: new Date("2026-11-24T10:05:00.000Z"),
    });
    expect(r).toEqual({ capturada: true, nota: 0, pedidoId: "pedido-1" });
    expect(banco.estado.pedidos[0]?.nota).toBe(0);
  });

  it("pedido NPS: '10!' vira nota 10", async () => {
    const banco = bancoFake({ pedidos: [pedido("nps_0_10")] });
    const r = await capturarRespostaDeSatisfacao(banco.client, {
      organizationId: ORG,
      conversationId: CONVERSA,
      texto: "10!",
      enviadaEm: new Date("2026-11-24T10:05:00.000Z"),
    });
    expect(r.nota).toBe(10);
    expect(banco.estado.pedidos[0]?.status).toBe("respondida");
  });

  it("pedido de 1 a 5: '8' não é nota e o pedido segue esperando", async () => {
    const banco = bancoFake({ pedidos: [pedido("csat_1_5")] });
    const r = await capturarRespostaDeSatisfacao(banco.client, {
      organizationId: ORG,
      conversationId: CONVERSA,
      texto: "8",
      enviadaEm: new Date("2026-11-24T10:05:00.000Z"),
    });
    expect(r).toEqual({ capturada: false, motivo: "nao_e_nota" });
    expect(banco.estado.pedidos[0]?.status).toBe("aguardando");
  });
});

describe("3.4 — o resumo separa as réguas", () => {
  it("lê por_escala do banco e degrada para CSAT quando o banco é anterior à 9484", async () => {
    const comRegua = {
      rpc: vi.fn(async () => ({
        data: {
          respostas: 3,
          pedidos: 4,
          sem_nota: 1,
          aguardando: 0,
          media: 4,
          notas: { "4": 1 },
          por_escala: {
            csat_1_5: { respostas: 1, media: 4, notas: { "4": 1 } },
            nps_0_10: { respostas: 2, media: 9.5, notas: { "9": 1, "10": 1 } },
          },
        },
        error: null,
      })),
    };
    const r = await resumoDaSatisfacao(comRegua as never, { organizationId: ORG });
    expect(r.por_escala.nps_0_10.respostas).toBe(2);
    expect(calcularNps(r.por_escala.nps_0_10.notas).nps).toBe(100);

    const antigo = {
      rpc: vi.fn(async () => ({
        data: { respostas: 2, pedidos: 2, sem_nota: 0, aguardando: 0, media: 3.5, notas: { "3": 1, "4": 1 } },
        error: null,
      })),
    };
    const velho = await resumoDaSatisfacao(antigo as never, { organizationId: ORG });
    expect(velho.por_escala.csat_1_5).toEqual({ respostas: 2, media: 3.5, notas: { "3": 1, "4": 1 } });
    expect(velho.por_escala.nps_0_10.respostas).toBe(0);
  });
});

describe("3.4 — o PATCH grava a régua", () => {
  it("escala nps_0_10 entra no bloco sem apagar a janela", async () => {
    const banco = bancoFake({ settings: { outra: 1, satisfacao: { ligado: false, janela_horas: 48 } } });
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u-1", idioma: "pt-BR" },
      org: { orgId: ORG, role: "admin" },
    } as Awaited<ReturnType<typeof requireRole>>);
    vi.mocked(createAdminClient).mockReturnValue(banco.client);

    const resposta = await patchDaPesquisa(
      new NextRequest("http://localhost/api/v1/settings/atendimento", {
        method: "PATCH",
        body: JSON.stringify({ ligado: true, escala: "nps_0_10" }),
      }),
    );

    expect(resposta.status).toBe(200);
    const bloco = banco.estado.settings.satisfacao as Record<string, unknown>;
    expect(bloco.escala).toBe("nps_0_10");
    expect(bloco.janela_horas).toBe(48);
    expect(banco.estado.settings.outra).toBe(1);
  });

  it("escala fora da lista é 422", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: true,
      user: { id: "u-1", idioma: "pt-BR" },
      org: { orgId: ORG, role: "admin" },
    } as Awaited<ReturnType<typeof requireRole>>);
    const resposta = await patchDaPesquisa(
      new NextRequest("http://localhost/api/v1/settings/atendimento", {
        method: "PATCH",
        body: JSON.stringify({ ligado: true, escala: "estrelas" }),
      }),
    );
    expect(resposta.status).toBe(422);
  });
});
