import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationHeader } from "@/components/inbox/ConversationHeader";
import { ProvedorDoSlaFixo } from "@/components/inbox/SeloDeSla";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import { SEM_METAS_DE_SLA } from "@/lib/schemas/settings";

/**
 * Item 3.7 — as três marcas do menu ⋯: privada, pendente e bloquear contato.
 *
 * Cada item aparece sob o MESMO gate da rota dele (o menu não oferece o que a
 * rota recusa) e, clicado, chama a rota certa com o corpo certo. A rede é o
 * único dublê de comportamento (`apiClient.post`); o resto são dublês de
 * fronteira iguais aos de `inbox-barra-enxuta-3003.test.tsx`.
 */

const estado = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  post: vi.fn(async (..._args: unknown[]) => ({ data: {} })),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...real, apiClient: { ...real.apiClient, post: estado.post } };
});
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => estado.auth,
  usePermission: () => true,
}));
vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useReleaseConversation", () => ({
  useReleaseConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useCloseConversation", () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useResumeAiAttendance", () => ({
  useResumeAiAttendance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/usePauseAiAttendance", () => ({
  usePauseAiAttendance: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useIaComDono", () => ({
  useIaComDono: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/contacts/usePersonalContact", () => ({
  useMarkPersonalContact: () => ({ mutate: vi.fn(), isPending: false }),
  useUnmarkPersonalContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/ai/useAutomaticoAtivo", () => ({
  useAutomaticoAtivo: () => ({ data: true }),
}));
vi.mock("@/hooks/inbox/useEnderecoDaResposta", () => ({
  useEnderecoDaResposta: () => ({ data: undefined }),
}));
vi.mock("@/hooks/voice/useVoiceSessionStatus", () => ({
  useVoiceSessionStatus: () => ({ data: { configured: false, paired: false } }),
}));
vi.mock("@/components/voice/VoiceCallContext", () => ({
  useVoiceCall: () => ({ call: null, startCall: vi.fn() }),
}));
vi.mock("@/hooks/inbox/useParticipantesDaConversa", () => ({
  useParticipantesDaConversa: () => ({ data: [] }),
  useConvidarParticipante: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useRemoverParticipante: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  chaveDosParticipantes: () => ["participantes"],
}));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: () => ({ data: [] }),
}));
vi.mock("@/components/kanban/OwnerBadge", () => ({ OwnerBadge: () => null }));
vi.mock("@/components/inbox/FaixaDaCarteira", () => ({ FaixaDaCarteira: () => null }));
vi.mock("@/components/inbox/ReassignDialog", () => ({ ReassignDialog: () => null }));
vi.mock("@/components/inbox/JanelaSelo", () => ({ JanelaSelo: () => null }));
vi.mock("@/components/inbox/ChannelLogo", () => ({ ChannelLogo: () => null }));

const CONTATO = {
  id: "contato-1",
  display_name: "Fulana",
  name: null,
  phone_number: "5511999",
  tags: [],
  is_blocked: false,
  is_personal: false,
  is_anonymized: false,
  force_human: false,
};

function montar(opts: {
  papel: "viewer" | "agent" | "manager";
  conversa?: Record<string, unknown>;
  contato?: Record<string, unknown>;
  /** Monta o provedor do SLA como se a organização tivesse meta. */
  comMetaDeSla?: boolean;
}) {
  estado.auth = {
    user: { id: "u1", support: null, is_platform_admin: false },
    activeOrg: { orgId: "org-1", role: opts.papel },
  };
  const conversa = {
    id: "conv-1",
    organization_id: "org-1",
    contact_id: "contato-1",
    status: "open",
    assigned_to_user_id: "u2",
    assigned_to_user_name: "Outra pessoa",
    assignee_kind: "user",
    bot_silenced_until: null,
    snooze_until: null,
    service_revision: 3,
    is_group: false,
    last_inbound_at: null,
    tags: [],
    privada: false,
    pendente_em: null,
    contacts: { ...CONTATO, ...opts.contato },
    channel_sessions: null,
    ...opts.conversa,
  } as unknown as ConversationWithContact;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const cabecalho = <ConversationHeader conversation={conversa} onBuscar={() => {}} />;
  return render(
    <QueryClientProvider client={client}>
      {opts.comMetaDeSla ? (
        <ProvedorDoSlaFixo value={{ metas: SEM_METAS_DE_SLA, expedientes: {}, agora: new Date() }}>
          {cabecalho}
        </ProvedorDoSlaFixo>
      ) : (
        cabecalho
      )}
    </QueryClientProvider>,
  );
}

async function abrirOMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByTestId("menu-de-acoes"), { button: 0, ctrlKey: false, pointerId: 1 });
  return await screen.findByTestId("menu-de-acoes-conteudo");
}

beforeEach(() => {
  estado.post.mockClear();
});

describe("item 3.7 — o ⋯ oferece cada marca sob o gate da rota dela", () => {
  it("atendente que NÃO é o responsável: pendente sim; privada e bloquear não", async () => {
    montar({ papel: "agent" });
    const menu = await abrirOMenu();
    expect(within(menu).queryByTestId("acao-pendente")).not.toBeNull();
    expect(within(menu).queryByTestId("acao-privada")).toBeNull();
    expect(within(menu).queryByTestId("acao-bloquear-contato")).toBeNull();
  });

  it("o responsável marca a própria conversa como privada", async () => {
    montar({ papel: "agent", conversa: { assigned_to_user_id: "u1" } });
    const menu = await abrirOMenu();
    fireEvent.click(within(menu).getByTestId("acao-privada"));
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/privada", { privada: true }),
    );
  });

  it("conversa já privada oferece 'Tornar pública', e o clique manda false", async () => {
    montar({ papel: "manager", conversa: { privada: true } });
    const menu = await abrirOMenu();
    const item = within(menu).getByTestId("acao-privada");
    expect(item.textContent).toContain("Tornar pública");
    fireEvent.click(item);
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/privada", { privada: false }),
    );
  });

  it("marcar e tirar de pendente vão à rota de pendente com o estado oposto", async () => {
    montar({ papel: "agent" });
    const menu = await abrirOMenu();
    expect(within(menu).getByTestId("acao-pendente").textContent).toContain("Marcar como pendente");
    fireEvent.click(within(menu).getByTestId("acao-pendente"));
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/pendente", { pendente: true }),
    );
  });

  it("conversa pendente oferece 'Tirar de pendente'", async () => {
    montar({ papel: "agent", conversa: { pendente_em: "2026-11-24T10:00:00Z" } });
    const menu = await abrirOMenu();
    const item = within(menu).getByTestId("acao-pendente");
    expect(item.textContent).toContain("Tirar de pendente");
    fireEvent.click(item);
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/pendente", { pendente: false }),
    );
  });

  it("encerrada não oferece pendente, mas privada sim", async () => {
    montar({ papel: "manager", conversa: { status: "closed" } });
    const menu = await abrirOMenu();
    expect(within(menu).queryByTestId("acao-pendente")).toBeNull();
    expect(within(menu).queryByTestId("acao-privada")).not.toBeNull();
  });

  it("visualizador não vê nenhuma das três", async () => {
    montar({ papel: "viewer" });
    const menu = await abrirOMenu();
    expect(within(menu).queryByTestId("acao-pendente")).toBeNull();
    expect(within(menu).queryByTestId("acao-privada")).toBeNull();
    expect(within(menu).queryByTestId("acao-bloquear-contato")).toBeNull();
  });

  it("contato já bloqueado: 'Bloquear contato' sai do menu", async () => {
    montar({ papel: "manager", contato: { is_blocked: true } });
    const menu = await abrirOMenu();
    expect(within(menu).queryByTestId("acao-bloquear-contato")).toBeNull();
  });

  it("bloquear pede confirmação e motivo; sem motivo não confirma", async () => {
    montar({ papel: "manager" });
    const menu = await abrirOMenu();
    fireEvent.click(within(menu).getByTestId("acao-bloquear-contato"));
    const dialogo = await screen.findByTestId("confirmar-bloqueio");
    const confirmar = within(dialogo).getByTestId("confirmar-bloqueio-acao");
    expect((confirmar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialogo).getByTestId("motivo-do-bloqueio"), {
      target: { value: "  spam repetido  " },
    });
    expect((confirmar as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmar);
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/contacts/contato-1/bloquear", { motivo: "spam repetido" }),
    );
  });

  it("a tecla M marca a conversa como pendente", async () => {
    montar({ papel: "agent" });
    fireEvent.keyDown(document.body, { key: "m", code: "KeyM" });
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/pendente", { pendente: true }),
    );
  });

  it("SLA: sem meta na organização, o item não existe; com meta, só gestor o vê", async () => {
    montar({ papel: "manager" });
    expect(within(await abrirOMenu()).queryByTestId("acao-ignorar-sla")).toBeNull();
  });

  it("SLA: gestor ignora e retoma pela rota do SLA", async () => {
    montar({ papel: "manager", comMetaDeSla: true });
    const menu = await abrirOMenu();
    const item = within(menu).getByTestId("acao-ignorar-sla");
    expect(item.textContent).toContain("Ignorar SLA");
    fireEvent.click(item);
    await waitFor(() =>
      expect(estado.post).toHaveBeenCalledWith("/api/v1/conversations/conv-1/sla", { ignorar: true }),
    );
  });

  it("SLA: conversa já ignorada oferece Retomar; atendente não vê o item", async () => {
    montar({ papel: "manager", comMetaDeSla: true, conversa: { sla_ignorado_em: "2026-11-24T10:00:00Z" } });
    expect(within(await abrirOMenu()).getByTestId("acao-ignorar-sla").textContent).toContain("Retomar SLA");
  });

  it("SLA: atendente não vê o item mesmo com meta", async () => {
    montar({ papel: "agent", comMetaDeSla: true });
    expect(within(await abrirOMenu()).queryByTestId("acao-ignorar-sla")).toBeNull();
  });
});
