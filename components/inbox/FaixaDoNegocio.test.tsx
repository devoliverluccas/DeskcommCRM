import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import type { NegocioDoResumo } from "@/hooks/inbox/useNegocioDaConversa";

/**
 * A FAIXA DO NEGÓCIO NO TOPO DA CONVERSA — o que ela mostra e quando age.
 *
 *  - com negócio aberto: título, valor, funil, etapa com as setas, a barrinha
 *    do caminho e os desfechos;
 *  - com mais de um aberto: o seletor de negócio, com o MAIS RECENTE escolhido;
 *  - sem nenhum: só o "Novo negócio";
 *  - quem não pode mover (viewer, suporte em leitura) vê, mas não age;
 *  - grupo não tem negócio: a faixa não existe e a leitura nem sai.
 *
 * Os diálogos do quadro são dublês: o que se mede aqui é que a faixa os ABRE
 * com o negócio certo. Como cada um escreve é coberto nos testes deles e em
 * `hooks/inbox/useNegocioDaConversa.test.tsx`.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

const auth = vi.hoisted(() => ({
  atual: {
    user: { id: "u1", support: null, is_platform_admin: false } as Record<string, unknown>,
    activeOrg: { orgId: "org-1", role: "agent" } as Record<string, unknown> | null,
  },
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => auth.atual }));
const FUNIL_PADRAO = { pipeline: { id: "funil-padrao", settings: {} }, stages: [] };
const funilPadrao = vi.hoisted(() => ({ lido: vi.fn() }));
vi.mock("@/hooks/pipelines/useDefaultPipeline", () => ({
  useDefaultPipeline: () => ({
    data: funilPadrao.lido.mock.results.length > 0 ? FUNIL_PADRAO : undefined,
    isFetching: false,
    refetch: funilPadrao.lido,
  }),
}));
vi.mock("@/components/kanban/NewLeadDialog", () => ({
  NewLeadDialog: (p: { open: boolean; contactId: string }) =>
    p.open ? <div data-testid="dialogo-novo-negocio" data-contato={p.contactId} /> : null,
}));
vi.mock("@/components/kanban/LoseLeadDialog", () => ({
  LoseLeadDialog: (p: { open: boolean; leadId?: string }) =>
    p.open ? <div data-testid="dialogo-perdido" data-lead={p.leadId ?? ""} /> : null,
}));
vi.mock("@/components/kanban/CamposObrigatoriosDialog", () => ({
  CamposObrigatoriosDialog: () => null,
}));
vi.mock("@/components/kanban/RetomarComoNovoNegocioDialog", () => ({
  RetomarComoNovoNegocioDialog: () => null,
}));

import { FaixaDoNegocio } from "./FaixaDoNegocio";

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
    title: "Orçamento nº 176",
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

let leads: NegocioDoResumo[] = [];

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  auth.atual = {
    user: { id: "u1", support: null, is_platform_admin: false },
    activeOrg: { orgId: "org-1", role: "agent" },
  };
  leads = [negocio()];
  funilPadrao.lido.mockReset();
  funilPadrao.lido.mockResolvedValue({ isError: false, data: FUNIL_PADRAO });
  api.get.mockImplementation(async (url: string) => {
    if (url.includes("crm-summary")) return { data: { leads } };
    if (url.startsWith("/api/v1/leads/"))
      return {
        data: {
          id: "lead-1",
          status: "open",
          stage_id: "e-proposta",
          lost_reason: null,
          updated_at: "2026-11-21T09:00:00.000Z",
        },
      };
    throw new Error(`GET inesperado: ${url}`);
  });
  api.post.mockResolvedValue({ data: { id: "lead-1" } });
});

function conversa(over: Record<string, unknown> = {}): ConversationWithContact {
  return {
    id: "conv-1",
    contact_id: CONTATO,
    is_group: false,
    status: "open",
    contacts: { id: CONTATO, name: "Heriberto", is_anonymized: false },
    ...over,
  } as unknown as ConversationWithContact;
}

function montar(props: { conversation?: ConversationWithContact; somenteLeitura?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <FaixaDoNegocio
        conversation={props.conversation ?? conversa()}
        somenteLeitura={props.somenteLeitura}
      />
    </QueryClientProvider>,
  );
}

describe("a faixa do negócio", () => {
  it("mostra o negócio aberto: título, valor, funil, etapa, o caminho e os desfechos", async () => {
    montar();
    const faixa = await screen.findByTestId("faixa-do-negocio");
    expect(within(faixa).getByText("Orçamento nº 176")).toBeTruthy();
    expect(within(faixa).getByTestId("faixa-valor").textContent).toMatch(/23\.556,40/);
    expect(within(faixa).getByText("Vendas")).toBeTruthy();
    expect(within(faixa).getByTestId("faixa-etapa-select").textContent).toContain("Proposta");

    // O caminho tem as três etapas abertas (sem ganho e perda) e está cheio até a atual.
    const segmentos = within(faixa).getByTestId("faixa-caminho").querySelectorAll("[data-cheio]");
    expect(Array.from(segmentos).map((s) => s.getAttribute("data-cheio"))).toEqual([
      "sim",
      "sim",
      "nao",
    ]);

    for (const id of [
      "faixa-ganho",
      "faixa-perdido",
      "faixa-novo-negocio",
      "faixa-etapa-anterior",
      "faixa-etapa-proxima",
    ]) {
      expect(within(faixa).getByTestId(id), id).toBeTruthy();
    }
  });

  it("a seta para a frente move para a próxima etapa pela rota /move", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByRole("button", { name: "Próxima etapa" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]![0]).toBe("/api/v1/leads/lead-1/move");
    expect(api.post.mock.calls[0]![1]).toMatchObject({ stage_id: "e-fechamento" });
  });

  it("na primeira etapa a seta de voltar fica desligada — e na última aberta, a de avançar", async () => {
    leads = [negocio({ stage_id: "e-novo" })];
    const { unmount } = montar();
    expect(
      (await screen.findByRole("button", { name: "Etapa anterior" })).hasAttribute("disabled"),
    ).toBe(true);
    unmount();

    leads = [negocio({ stage_id: "e-fechamento" })];
    montar();
    expect(
      (await screen.findByRole("button", { name: "Próxima etapa" })).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("Perdido abre a janela de motivo do quadro para ESTE negócio", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("faixa-perdido"));
    expect(screen.getByTestId("dialogo-perdido").getAttribute("data-lead")).toBe("lead-1");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("Ganho marca pela rota do card", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("faixa-ganho"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/leads/lead-1/win", {}));
  });

  it("com mais de um aberto, um seletor pequeno — e o escolhido é o mais recente", async () => {
    leads = [
      negocio({ id: "lead-recente", title: "Pedido recente" }),
      negocio({ id: "lead-antigo", title: "Pedido antigo" }),
    ];
    montar();
    const seletor = await screen.findByTestId("faixa-escolher-negocio");
    expect(seletor.textContent).toContain("Pedido recente");
    expect(screen.getByTestId("faixa-do-negocio").getAttribute("data-negocio")).toBe(
      "lead-recente",
    );
  });

  it("um negócio só: sem seletor de negócio", async () => {
    montar();
    await screen.findByTestId("faixa-do-negocio");
    expect(screen.queryByTestId("faixa-escolher-negocio")).toBeNull();
  });

  it("sem negócio aberto: só o botão Novo negócio, que abre o diálogo do quadro com o contato", async () => {
    leads = [negocio({ status: "won" })];
    const user = userEvent.setup();
    montar();
    const faixa = await screen.findByTestId("faixa-do-negocio");
    expect(faixa.getAttribute("data-estado")).toBe("sem-negocio");
    expect(screen.queryByTestId("faixa-etapa-select")).toBeNull();
    expect(screen.queryByTestId("faixa-ganho")).toBeNull();

    await user.click(within(faixa).getByRole("button", { name: "Novo negócio" }));
    expect((await screen.findByTestId("dialogo-novo-negocio")).getAttribute("data-contato")).toBe(
      CONTATO,
    );
  });

  it("sem funil na organização, Novo negócio avisa e não abre diálogo vazio", async () => {
    funilPadrao.lido.mockResolvedValue({ isError: true, data: undefined });
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("faixa-novo-negocio"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nenhum funil configurado nesta organização."),
    );
    expect(screen.queryByTestId("dialogo-novo-negocio")).toBeNull();
  });

  it("viewer vê o negócio, mas não age: sem setas, sem desfechos, seletor desligado", async () => {
    auth.atual = {
      user: { id: "u1", support: null },
      activeOrg: { orgId: "org-1", role: "viewer" },
    };
    montar();
    const faixa = await screen.findByTestId("faixa-do-negocio");
    expect(within(faixa).getByText("Orçamento nº 176")).toBeTruthy();
    for (const id of [
      "faixa-ganho",
      "faixa-perdido",
      "faixa-novo-negocio",
      "faixa-etapa-anterior",
      "faixa-etapa-proxima",
    ]) {
      expect(within(faixa).queryByTestId(id), id).toBeNull();
    }
    expect(within(faixa).getByTestId("faixa-etapa-select").hasAttribute("disabled")).toBe(true);
  });

  it("suporte em leitura também não age, mesmo com papel de atendente", async () => {
    montar({ somenteLeitura: true });
    const faixa = await screen.findByTestId("faixa-do-negocio");
    expect(within(faixa).queryByTestId("faixa-ganho")).toBeNull();
  });

  it("sem negócio e sem poder criar: a faixa nem aparece", async () => {
    leads = [];
    auth.atual = {
      user: { id: "u1", support: null },
      activeOrg: { orgId: "org-1", role: "viewer" },
    };
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId("faixa-do-negocio")).toBeNull();
  });

  it("grupo não tem negócio: nada aparece e o resumo não é pedido", async () => {
    montar({ conversation: conversa({ is_group: true }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("faixa-do-negocio")).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("falha na leitura não desenha faixa vazia", async () => {
    api.get.mockRejectedValue(new Error("rede"));
    montar();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("faixa-do-negocio")).toBeNull();
  });
});
