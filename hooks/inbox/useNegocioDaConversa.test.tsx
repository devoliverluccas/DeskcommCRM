import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";

/**
 * O NEGÓCIO DA CONVERSA — o que a faixa do topo lê e como ela move.
 *
 * O que cada bloco guarda, e por quê:
 *
 *  1. **As regras puras** (negócio aberto mais recente, setas que pulam os
 *     desfechos, quais mutações releem o resumo).
 *  2. **O move é o da página do negócio**: relê a linha para ter o
 *     `expected_updated_at` fresco e chama `POST /leads/{id}/move` — NUNCA
 *     `/leads/bulk`. Um teste que só olhasse "houve POST" ficaria verde com o
 *     caminho errado; este olha a URL e o corpo.
 *  3. **As recusas viram diálogo**: etapa de perda pede motivo ANTES de
 *     escrever; 422 de campos obrigatórios abre os campos e reenvia NA MESMA
 *     escrita.
 *  4. **O resumo é relido** depois do gesto da faixa e depois de mutação de
 *     OUTRO lugar que toque um negócio do contato (o seletor do painel).
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import {
  etapaVizinha,
  mutacaoMexeNoNegocio,
  negociosAbertos,
  useNegocioDaConversa,
  type NegocioDoResumo,
} from "./useNegocioDaConversa";

const CONTATO = "c0000000-0000-4000-8000-000000000001";
const ETAPAS = [
  { id: "e-novo", name: "Novo", is_won: false, is_lost: false },
  { id: "e-proposta", name: "Proposta", is_won: false, is_lost: false },
  { id: "e-fechamento", name: "Fechamento", is_won: false, is_lost: false },
  { id: "e-ganho", name: "Ganho", is_won: true, is_lost: false },
  { id: "e-perdido", name: "Perdido", is_won: false, is_lost: true },
];

function negocio(over: Partial<NegocioDoResumo> = {}): NegocioDoResumo {
  return {
    id: "lead-1",
    title: "Orçamento 176",
    status: "open",
    value_cents: 2_355_640,
    currency: "BRL",
    updated_at: "2026-11-20T10:00:00.000Z",
    pipeline_id: "funil-1",
    stage_id: "e-proposta",
    funil_nome: "Vendas",
    etapa_nome: "Proposta",
    etapas_do_funil: ETAPAS,
    motivos_de_perda: [],
    ...over,
  };
}

let leadsDoResumo: NegocioDoResumo[] = [];
let leituraDoLead: Record<string, unknown> | null = null;

function chamadasDoResumo() {
  return api.get.mock.calls.filter(([url]) => String(url).includes("crm-summary")).length;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  leadsDoResumo = [negocio()];
  leituraDoLead = {
    id: "lead-1",
    status: "open",
    stage_id: "e-proposta",
    lost_reason: null,
    updated_at: "2026-11-21T09:00:00.000Z",
  };
  api.get.mockImplementation(async (url: string) => {
    if (url.includes("crm-summary")) return { data: { leads: leadsDoResumo } };
    if (url.startsWith("/api/v1/leads/")) return { data: leituraDoLead };
    throw new Error(`GET inesperado: ${url}`);
  });
  api.post.mockImplementation(async () => ({ data: { id: "lead-1" } }));
});

function montar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const visto = renderHook(() => useNegocioDaConversa(CONTATO), { wrapper });
  return { ...visto, qc, wrapper };
}

describe("regras puras", () => {
  it("o negócio da faixa é o ABERTO mais recente — a ordem da rota, sem os encerrados", () => {
    const lista = [
      negocio({ id: "ganho", status: "won" }),
      negocio({ id: "recente" }),
      negocio({ id: "antigo" }),
    ];
    expect(negociosAbertos(lista).map((l) => l.id)).toEqual(["recente", "antigo"]);
    expect(negociosAbertos(null)).toEqual([]);
  });

  it("as setas andam pelo caminho e NÃO caem em ganho nem em perda", () => {
    expect(etapaVizinha(ETAPAS, "e-proposta", 1)?.id).toBe("e-fechamento");
    expect(etapaVizinha(ETAPAS, "e-proposta", -1)?.id).toBe("e-novo");
    expect(etapaVizinha(ETAPAS, "e-novo", -1)).toBeNull();
    // Depois da última etapa aberta vem "Ganho" no quadro — a seta para nele.
    expect(etapaVizinha(ETAPAS, "e-fechamento", 1)).toBeNull();
    expect(etapaVizinha(ETAPAS, "inexistente", 1)).toBeNull();
  });

  it("só mutação que toca negócio DESTE contato relê o resumo", () => {
    const ctx = { contactId: CONTATO, leadIds: ["lead-1"] };
    expect(mutacaoMexeNoNegocio({ leadId: "lead-1", stageId: "x" }, ctx)).toBe(true);
    expect(mutacaoMexeNoNegocio({ action: "move", lead_ids: ["lead-1"] }, ctx)).toBe(true);
    expect(mutacaoMexeNoNegocio({ contact_id: CONTATO, title: "novo" }, ctx)).toBe(true);
    expect(mutacaoMexeNoNegocio({ leadId: "lead-de-outro" }, ctx)).toBe(false);
    expect(mutacaoMexeNoNegocio({ conversation_id: "conv-1", body: "oi" }, ctx)).toBe(false);
    expect(mutacaoMexeNoNegocio(undefined, ctx)).toBe(false);
  });
});

describe("mover pela faixa", () => {
  it("relê a linha e move por POST /leads/{id}/move com o updated_at FRESCO — nunca pelo bulk", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio?.id).toBe("lead-1"));

    await act(async () => {
      await result.current.mudarEtapa("e-fechamento");
    });

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [url, corpo] = api.post.mock.calls[0]!;
    expect(url).toBe("/api/v1/leads/lead-1/move");
    expect(corpo).toMatchObject({
      stage_id: "e-fechamento",
      expected_updated_at: "2026-11-21T09:00:00.000Z",
    });
    expect(api.post.mock.calls.some(([u]) => String(u).includes("/leads/bulk"))).toBe(false);
    expect(api.get).toHaveBeenCalledWith("/api/v1/leads/lead-1");
  });

  it("depois do move o resumo é relido, e a etapa nova aparece já no clique", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());
    expect(chamadasDoResumo()).toBe(1);

    leadsDoResumo = [negocio({ stage_id: "e-fechamento", etapa_nome: "Fechamento" })];
    await act(async () => {
      await result.current.mudarEtapa("e-fechamento");
    });

    await waitFor(() => expect(chamadasDoResumo()).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(result.current.etapaExibida).toBe("e-fechamento"));
  });

  it("a seta para a frente move para a próxima etapa do caminho", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());
    act(() => result.current.andar(1));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]![1]).toMatchObject({ stage_id: "e-fechamento" });
  });

  it("etapa de PERDA não escreve: pede o motivo, e o motivo vai NA MESMA escrita do move", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());

    await act(async () => {
      await result.current.mudarEtapa("e-perdido");
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(result.current.perda).toMatchObject({ leadId: "lead-1", stageId: "e-perdido" });

    act(() => result.current.confirmarPerda("price"));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]![0]).toBe("/api/v1/leads/lead-1/move");
    expect(api.post.mock.calls[0]![1]).toMatchObject({
      stage_id: "e-perdido",
      lost_reason: "price",
    });
    expect(result.current.perda).toBeNull();
  });

  it("422 de campos obrigatórios abre os campos e reenvia o MESMO move com eles", async () => {
    const faltando = [{ chave: "cpf", rotulo: "CPF" }];
    api.post.mockRejectedValueOnce(
      new ApiError(422, "required_fields_missing", { faltando }, "req-1"),
    );
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());

    await act(async () => {
      await result.current.mudarEtapa("e-fechamento");
    });
    await waitFor(() => expect(result.current.recusa?.faltando).toEqual(faltando));

    act(() => result.current.confirmarCampos({ customFields: { cpf: "123" } }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1]![0]).toBe("/api/v1/leads/lead-1/move");
    expect(api.post.mock.calls[1]![1]).toMatchObject({
      stage_id: "e-fechamento",
      custom_fields: { cpf: "123" },
    });
  });
});

describe("ganho", () => {
  it("Ganho usa a rota do card (/win) e relê o resumo", async () => {
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());
    act(() => result.current.marcarGanho());
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/leads/lead-1/win", {}));
    await waitFor(() => expect(chamadasDoResumo()).toBeGreaterThanOrEqual(2));
  });

  it("ganho recusado por campos abre os campos, que reenviam como move para a etapa de ganho", async () => {
    const faltando = [{ chave: "won_reason", rotulo: "Motivo do ganho" }];
    api.post.mockRejectedValueOnce(
      new ApiError(422, "required_fields_missing", { faltando }, "req-2"),
    );
    const { result } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());
    act(() => result.current.marcarGanho());
    await waitFor(() => expect(result.current.recusa?.args.stageId).toBe("e-ganho"));
  });
});

describe("releitura por mutação de outro lugar", () => {
  it("o seletor do painel (lote com o id do negócio) relê a faixa; uma mensagem enviada não", async () => {
    const { result, wrapper } = montar();
    await waitFor(() => expect(result.current.negocio).not.toBeNull());
    expect(chamadasDoResumo()).toBe(1);

    const outro = renderHook(
      () => ({
        lote: useMutation({
          mutationFn: async (_v: { action: string; lead_ids: string[] }) => ({ ok: true }),
        }),
        mensagem: useMutation({
          mutationFn: async (_v: { conversation_id: string; body: string }) => ({ ok: true }),
        }),
      }),
      { wrapper },
    );

    await act(async () => {
      await outro.result.current.mensagem.mutateAsync({ conversation_id: "conv-1", body: "oi" });
    });
    expect(chamadasDoResumo()).toBe(1);

    await act(async () => {
      await outro.result.current.lote.mutateAsync({ action: "move", lead_ids: ["lead-1"] });
    });
    await waitFor(() => expect(chamadasDoResumo()).toBe(2));
  });
});
