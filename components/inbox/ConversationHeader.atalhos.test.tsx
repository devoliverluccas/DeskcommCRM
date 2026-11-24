import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import type * as MoverParaFila from "@/components/inbox/MoverParaFila";
import { ATALHOS_DO_INBOX, atalhoDo } from "./atalhos-da-conversa";

/**
 * OS ATALHOS DAS AÇÕES DA CONVERSA — a tecla vale onde a ação vale.
 *
 * Cada atalho é medido nos DOIS lados da condição que já governava o botão ou o
 * item do menu ⋯: com a ação na tela, a tecla age; sem ela, a tecla não faz
 * nada. Um atalho que transferisse conversa encerrada, ou pausasse um automático
 * que não está de pé, seria uma ação escondida — exatamente o que o menu ⋯
 * prometeu não ter (#3003).
 *
 * E a fonte única: a dica à direita do item do menu e a ajuda (`?`) leem a mesma
 * lista que registra a tecla (`ATALHOS_DO_INBOX`).
 */

const estado = vi.hoisted(() => ({
  auth: {
    user: { id: "u1", support: null } as Record<string, unknown>,
    activeOrg: undefined as Record<string, unknown> | undefined,
  },
  automaticoDaOrg: true as boolean | undefined,
  pausar: vi.fn(),
  retomar: vi.fn(),
}));

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
  useResumeAiAttendance: () => ({ mutate: estado.retomar, isPending: false }),
}));
vi.mock("@/hooks/inbox/usePauseAiAttendance", () => ({
  usePauseAiAttendance: () => ({ mutate: estado.pausar, isPending: false }),
}));
vi.mock("@/hooks/inbox/useIaComDono", () => ({
  useIaComDono: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/contacts/usePersonalContact", () => ({
  useMarkPersonalContact: () => ({ mutate: vi.fn(), isPending: false }),
  useUnmarkPersonalContact: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/ai/useAutomaticoAtivo", () => ({
  useAutomaticoAtivo: () => ({ data: estado.automaticoDaOrg }),
}));
vi.mock("@/hooks/inbox/useEnderecoDaResposta", () => ({
  useEnderecoDaResposta: () => ({ data: undefined }),
}));
vi.mock("@/components/kanban/OwnerBadge", () => ({ OwnerBadge: () => null }));
vi.mock("@/components/inbox/FaixaDaCarteira", () => ({ FaixaDaCarteira: () => null }));
vi.mock("@/components/inbox/ReassignDialog", () => ({
  ReassignDialog: (p: { open: boolean }) =>
    p.open ? <div data-testid="dialogo-transferir" /> : null,
}));
vi.mock("@/components/inbox/NovaTarefaDaConversa", () => ({
  NovaTarefaDaConversa: () => <div data-testid="dialogo-tarefa" />,
}));
vi.mock("@/components/inbox/MoverParaFila", async (importOriginal) => {
  const real = await importOriginal<typeof MoverParaFila>();
  return {
    podeMoverParaFila: real.podeMoverParaFila,
    ItemMoverParaFila: () => null,
    DialogoMoverParaFila: (p: { aberto: boolean }) =>
      p.aberto ? <div data-testid="dialogo-fila" /> : null,
  };
});
// Com `activeOrg` de atendente a reserva de serviço aparece, e ela consulta por query.
vi.mock("@/components/agenda/ReservarServicoNaConversa", () => ({
  ItemReservarServico: () => null,
  ReservarServicoNaConversa: () => null,
}));
vi.mock("@/components/inbox/JanelaSelo", () => ({ JanelaSelo: () => null }));
vi.mock("@/components/inbox/ChannelLogo", () => ({ ChannelLogo: () => null }));
vi.mock("@/components/voice/DialButton", () => ({ DialButton: () => null }));
vi.mock("@/components/inbox/VideoCallButton", () => ({ VideoCallButton: () => null }));
vi.mock("@/components/inbox/ParticipantesDaConversa", () => ({
  ParticipantesDaConversa: () => null,
  DialogoDeConvite: () => null,
}));
vi.mock("@/components/inbox/SnoozeButton", () => ({
  SnoozeButton: () => (
    <button type="button" role="menuitem" data-testid="acao-lembrar">
      Lembrar
    </button>
  ),
}));

import { ConversationHeader } from "./ConversationHeader";

function conversa(over: Record<string, unknown> = {}, contato: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    organization_id: "org-1",
    contact_id: "contato-1",
    status: "open",
    assigned_to_user_id: null,
    assigned_to_user_name: null,
    assignee_kind: "ai",
    bot_silenced_until: null,
    snooze_until: null,
    service_revision: 3,
    is_group: false,
    tags: [],
    contacts: {
      id: "contato-1",
      display_name: "Fulana",
      name: null,
      phone_number: "5511999",
      tags: [],
      is_blocked: false,
      is_personal: false,
      is_anonymized: false,
      force_human: false,
      ...contato,
    },
    channel_sessions: null,
    ...over,
  } as unknown as ConversationWithContact;
}

function montar(c: ConversationWithContact, onNavegar?: (href: string) => void) {
  return render(<ConversationHeader conversation={c} onNavegar={onNavegar} />);
}

beforeEach(() => {
  estado.auth = {
    user: { id: "u1", support: null, is_platform_admin: true },
    activeOrg: undefined,
  };
  estado.automaticoDaOrg = true;
  estado.pausar.mockReset();
  estado.retomar.mockReset();
});

describe("T — transferir", () => {
  it("abre a transferência na conversa aberta", async () => {
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("t");
    expect(screen.getByTestId("dialogo-transferir")).toBeTruthy();
  });

  it("não faz nada na conversa encerrada (o botão também não existe ali)", async () => {
    const user = userEvent.setup();
    montar(conversa({ status: "closed" }));
    await user.keyboard("t");
    expect(screen.queryByTestId("dialogo-transferir")).toBeNull();
  });

  it("não dispara de dentro de um campo de texto — quem digita não transfere", async () => {
    const user = userEvent.setup();
    render(
      <>
        <textarea aria-label="resposta" />
        <ConversationHeader conversation={conversa()} />
      </>,
    );
    await user.click(screen.getByLabelText("resposta"));
    await user.keyboard("t");
    expect(screen.queryByTestId("dialogo-transferir")).toBeNull();
  });

  it("não dispara com uma camada aberta por cima (um diálogo de outro componente)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <div role="dialog" data-state="open">
          <button type="button">dentro</button>
        </div>
        <ConversationHeader conversation={conversa()} />
      </>,
    );
    await user.keyboard("t");
    expect(screen.queryByTestId("dialogo-transferir")).toBeNull();
  });

  it("no acompanhamento só-leitura nenhum atalho age", async () => {
    estado.auth = {
      user: { id: "u1", support: { access_mode: "support_readonly" } },
      activeOrg: undefined,
    };
    const user = userEvent.setup();
    montar(conversa({ assigned_to_user_id: "u2", assignee_kind: "user" }));
    await user.keyboard("tp");
    expect(screen.queryByTestId("dialogo-transferir")).toBeNull();
    expect(estado.pausar).not.toHaveBeenCalled();
  });
});

describe("P — pausar ou devolver o automático", () => {
  it("com dono e o automático de pé, P pausa", async () => {
    const user = userEvent.setup();
    montar(conversa({ assigned_to_user_id: "u2", assignee_kind: "user" }));
    await user.keyboard("p");
    expect(estado.pausar).toHaveBeenCalledWith({ conversation_id: "conv-1" });
    expect(estado.retomar).not.toHaveBeenCalled();
  });

  it("com o automático calado, P devolve", async () => {
    const user = userEvent.setup();
    montar(
      conversa({
        assigned_to_user_id: "u1",
        assignee_kind: "user",
        bot_silenced_until: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    );
    await user.keyboard("p");
    expect(estado.retomar).toHaveBeenCalledWith({ conversation_id: "conv-1" });
    expect(estado.pausar).not.toHaveBeenCalled();
  });

  it("sem dono e sem trava (nem pausar nem devolver aparecem), P não faz nada", async () => {
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("p");
    expect(estado.pausar).not.toHaveBeenCalled();
    expect(estado.retomar).not.toHaveBeenCalled();
  });
});

describe("F — mover para fila", () => {
  it("com o módulo de filas ligado e papel de atendente, abre o diálogo da fila", async () => {
    estado.auth = {
      user: { id: "u1", support: null },
      activeOrg: { orgId: "org-1", role: "agent", modulos_ligados: ["setores"] },
    };
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("f");
    expect(screen.getByTestId("dialogo-fila")).toBeTruthy();
  });

  it("com o módulo desligado (o padrão), F não faz nada", async () => {
    estado.auth = {
      user: { id: "u1", support: null },
      activeOrg: { orgId: "org-1", role: "agent", modulos_ligados: [] },
    };
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("f");
    expect(screen.queryByTestId("dialogo-fila")).toBeNull();
  });
});

describe("C — criar tarefa, V — ver contato", () => {
  it("C abre a tarefa para quem pode criar", async () => {
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("c");
    expect(screen.getByTestId("dialogo-tarefa")).toBeTruthy();
  });

  it("C não abre nada para viewer (o item do menu também não aparece)", async () => {
    estado.auth = {
      user: { id: "u1", support: null },
      activeOrg: { orgId: "org-1", role: "viewer" },
    };
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("c");
    expect(screen.queryByTestId("dialogo-tarefa")).toBeNull();
  });

  it("V abre a ficha do contato pelo roteador", async () => {
    const navegar = vi.fn();
    const user = userEvent.setup();
    montar(conversa(), navegar);
    await user.keyboard("v");
    expect(navegar).toHaveBeenCalledWith("/app/contacts/contato-1");
  });

  it("V sem contato não navega", async () => {
    const navegar = vi.fn();
    const user = userEvent.setup();
    montar(conversa({ contacts: null }), navegar);
    await user.keyboard("v");
    expect(navegar).not.toHaveBeenCalled();
  });
});

describe("L — lembrar", () => {
  it("abre o menu ⋯ com o foco em Lembrar", async () => {
    const user = userEvent.setup();
    montar(conversa());
    await user.keyboard("l");
    const menu = await screen.findByTestId("menu-de-acoes-conteudo");
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(within(menu).getByTestId("acao-lembrar")),
    );
  });

  it("na conversa encerrada (sem Lembrar no menu), L não abre nada", async () => {
    const user = userEvent.setup();
    montar(conversa({ status: "closed" }));
    await user.keyboard("l");
    expect(screen.queryByTestId("menu-de-acoes-conteudo")).toBeNull();
  });
});

describe("a dica no menu e a ajuda saem da MESMA lista", () => {
  async function abrirOMenu() {
    fireEvent.pointerDown(screen.getByTestId("menu-de-acoes"), {
      button: 0,
      ctrlKey: false,
      pointerId: 1,
    });
    return await screen.findByTestId("menu-de-acoes-conteudo");
  }

  it("cada item com atalho mostra a tecla da lista e a anuncia em aria-keyshortcuts", async () => {
    montar(conversa({ assigned_to_user_id: "u2", assignee_kind: "user" }), vi.fn());
    const menu = await abrirOMenu();

    const casos = [
      { testid: "acao-ver-contato", id: "ver-contato" },
      { testid: "acao-criar-tarefa", id: "criar-tarefa" },
      { testid: "pausar-o-automatico", id: "automatico" },
    ] as const;
    for (const caso of casos) {
      const item = within(menu).getByTestId(caso.testid);
      const dica = item.querySelector(`[data-atalho="${caso.id}"]`);
      expect(dica?.textContent, caso.testid).toBe(atalhoDo(caso.id).exibicao);
      expect(dica?.getAttribute("aria-hidden"), "a dica não entra no nome acessível").toBe("true");
      expect(item.getAttribute("aria-keyshortcuts")).toBe(atalhoDo(caso.id).exibicao);
    }
    // Lembrar é do SnoozeButton: a dica fica por cima do item, da mesma lista.
    expect(menu.querySelector('[data-atalho="lembrar"]')?.textContent).toBe(
      atalhoDo("lembrar").exibicao,
    );
    // O nome acessível continua sendo só o rótulo (é por ele que os testes acham o item).
    expect(within(menu).getByRole("menuitem", { name: "Criar tarefa" })).toBeTruthy();
  });

  it("os botões da barra anunciam a tecla sem mudar o rótulo", () => {
    montar(conversa());
    const transferir = screen.getByRole("button", { name: "Transferir" });
    expect(transferir.getAttribute("aria-keyshortcuts")).toBe(atalhoDo("transferir").exibicao);
    expect(transferir.textContent?.trim()).toBe("Transferir");
  });

  it("nenhuma tecla registrada se repete na lista — duas ações na mesma letra seria uma delas morta", () => {
    const teclas = ATALHOS_DO_INBOX.map((a) => a.tecla).filter((t): t is string => t !== null);
    expect(new Set(teclas).size).toBe(teclas.length);
  });
});
