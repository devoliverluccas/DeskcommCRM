import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A CONVERSA AO VIVO NO DOSSIÊ (item 1.4) — com o `ChatThread` e o `Composer`
 * DE VERDADE, dentro do `AuthProvider` de verdade.
 *
 * ─── Por que nada do inbox é mockado ────────────────────────────────────────
 *
 * O risco desta entrega é montar as peças do inbox num lugar que não é o inbox:
 * se o fio ou a caixa dependessem de um provider que só o `InboxLayout` monta,
 * o dossiê quebraria na tela e um teste com sondas no lugar das duas peças
 * ficaria verde. Aqui só a REDE é falsa (`apiClient`) e o que o jsdom não tem
 * (o canal do Supabase). O `AuthProvider` é o real — é ele que, em `/app`, monta
 * o react-query (`<Providers>`) e responde `useUser`/`useActiveOrg`/
 * `usePermission` para os dois componentes.
 *
 * O resto mede a decisão: o que trava a caixa sai de `estadoDoCompositor`, a
 * mesma régua do inbox, e o gesto que destrava (Assumir, Reabrir) chama a MESMA
 * rota que o cabeçalho do inbox chama.
 */

const rede = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", () => ({ apiClient: rede }));
// O `AuthProvider` real monta `<Providers>` (react-query, transição de org).
// O react-query vem do lado de fora, com `retry: false`, para o 404 não esperar.
vi.mock("@/app/providers", () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { refreshSession: vi.fn() } }),
  resetRealtimeAuthentication: vi.fn(),
  prepareRealtimeAuthentication: vi.fn(),
}));
// O canal do Supabase é o que o jsdom não tem; a assinatura não participa.
vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: () => ({ status: "SUBSCRIBED", ultimaEntrega: { current: null } }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/pipelines/funil-1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: { href: string; children: ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

import { AuthProvider } from "@/hooks/auth/AuthProvider";
import { ApiError } from "@/lib/api/types";
import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import { ConversaNoDossieAoVivo } from "./ConversaNoDossieAoVivo";

// jsdom: o fio mede a rolagem e acompanha o fim.
window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
window.HTMLElement.prototype.scrollTo ??= () => undefined;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const EU = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";
const RESUMO = { id: CONV, preview: "Quanto custa?", last_message_at: "2026-11-24T11:00:00Z", unread: 1 };

function usuario(over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: EU,
    email: "eu@exemplo.com",
    full_name: "Eu",
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR",
    organizations: [],
    ...over,
  } as AuthUser;
}

function org(over: Partial<ActiveOrg> = {}): ActiveOrg {
  return { orgId: "org-1", name: "Org", role: "agent", ...over } as ActiveOrg;
}

function conversaCompleta(over: Record<string, unknown> = {}) {
  return {
    id: CONV,
    organization_id: "org-1",
    contact_id: "c-1",
    channel_session_id: "sess-1",
    status: "open",
    service_revision: 7,
    assigned_to_user_id: EU,
    assigned_to_user_name: "Eu",
    last_inbound_at: new Date(Date.now() - 3_600_000).toISOString(),
    unread_count_for_assignee: 0,
    tags: [],
    contacts: {
      id: "c-1",
      display_name: "Rafael",
      name: "Rafael",
      phone_number: "+5511900000000",
      tags: [],
      is_blocked: false,
      is_anonymized: false,
      is_personal: false,
    },
    channel_sessions: { provider: "waha" },
    ...over,
  };
}

const MENSAGEM = {
  id: "m-1",
  organization_id: "org-1",
  conversation_id: CONV,
  direction: "inbound",
  type: "text",
  body: "Quanto custa o pacote?",
  status: "delivered",
  sent_at: new Date(Date.now() - 3_600_000).toISOString(),
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  external_id: "ext-1",
  metadata: {},
};

/** A rede: a conversa (ou o erro dela), uma mensagem, e vazio para o resto. */
function responder(conversa: unknown | Error) {
  rede.get.mockImplementation(async (url: string) => {
    if (url === `/api/v1/conversations/${CONV}`) {
      if (conversa instanceof Error) throw conversa;
      return { data: conversa };
    }
    if (url.startsWith(`/api/v1/conversations/${CONV}/messages`)) {
      return { data: [MENSAGEM], meta: { has_more: false, cursor: null } };
    }
    if (url.endsWith("/participants")) return { data: { participantes: [] } };
    return { data: [] };
  });
}

function montar(opts: { user?: AuthUser; activeOrg?: ActiveOrg } = {}) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider user={opts.user ?? usuario()} activeOrg={opts.activeOrg ?? org()}>
      <QueryClientProvider client={cliente}>
        <ConversaNoDossieAoVivo conversa={RESUMO} />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rede.post.mockResolvedValue({ data: {} });
  rede.patch.mockResolvedValue({ data: {} });
});

describe("monta o fio e a caixa do inbox dentro de /app", () => {
  it("carrega a conversa pelo id do negócio e mostra as mensagens e a caixa liberada", async () => {
    responder(conversaCompleta());
    montar();

    expect(await screen.findByText("Quanto custa o pacote?", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(rede.get).toHaveBeenCalledWith(`/api/v1/conversations/${CONV}`);
    const campo = screen.getByLabelText("Mensagem");
    expect(campo).not.toBeDisabled();
    expect(screen.getByTestId("dossie-conversa-abrir-inbox")).toHaveAttribute(
      "href",
      `/app/inbox?id=${CONV}`,
    );
    // Conversa minha e aberta: nenhum gesto de destravar à vista.
    expect(screen.queryByTestId("dossie-conversa-assumir")).toBeNull();
    expect(screen.queryByTestId("dossie-conversa-reabrir")).toBeNull();
  });

  it("responde daqui: o envio sai pela rota de envio, nesta conversa", async () => {
    responder(conversaCompleta());
    montar();
    const campo = await screen.findByLabelText("Mensagem", {}, { timeout: 5000 });
    await userEvent.type(campo, "Sai por 1.200");
    await userEvent.click(screen.getByLabelText("Enviar"));
    await waitFor(() =>
      expect(rede.post).toHaveBeenCalledWith(
        "/api/v1/messages",
        expect.objectContaining({ conversation_id: CONV, body: "Sai por 1.200", type: "text" }),
        expect.anything(),
      ),
    );
  });
});

describe("a caixa travada mostra o motivo", () => {
  it("janela de 24h fechada no canal oficial: o motivo aparece e a resposta trava", async () => {
    responder(
      conversaCompleta({
        channel_sessions: { provider: "meta_cloud" },
        last_inbound_at: new Date(Date.now() - 30 * 3_600_000).toISOString(),
      }),
    );
    montar();
    const motivo = await screen.findByTestId("dossie-conversa-janela", {}, { timeout: 5000 });
    expect(motivo).toHaveTextContent("A janela de 24h fechou há");
    expect(screen.getByLabelText("Mensagem")).toBeDisabled();
  });

  it("contato bloqueado: a caixa vira o motivo", async () => {
    responder(
      conversaCompleta({
        contacts: { ...conversaCompleta().contacts, is_blocked: true },
      }),
    );
    montar();
    expect(
      await screen.findByText("Contato bloqueado — envio de mensagens desabilitado.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).toBeNull();
  });

  it("trava até assumir (opção da org) + conversa sem dono: aviso, botão Assumir, e o clique assume", async () => {
    responder(conversaCompleta({ assigned_to_user_id: null, assigned_to_user_name: null }));
    montar({ activeOrg: org({ interface_settings: { bloquearAteAssumir: true } } as Partial<ActiveOrg>) });

    const assumir = await screen.findByTestId("dossie-conversa-assumir", {}, { timeout: 5000 });
    expect(screen.getByTestId("aviso-assumir")).toBeInTheDocument();
    expect(screen.getByLabelText("Mensagem")).toBeDisabled();

    await userEvent.click(assumir);
    await waitFor(() =>
      expect(rede.post).toHaveBeenCalledWith(`/api/v1/conversations/${CONV}/claim`, {
        expected_assignee: null,
      }),
    );
  });

  it("CONTROLE: a mesma conversa sem dono, com a opção DESLIGADA, não trava nem oferece Assumir", async () => {
    responder(conversaCompleta({ assigned_to_user_id: OUTRO }));
    montar();
    const campo = await screen.findByLabelText("Mensagem", {}, { timeout: 5000 });
    expect(campo).not.toBeDisabled();
    expect(screen.queryByTestId("dossie-conversa-assumir")).toBeNull();
  });

  it("conversa fechada: o selo diz, e Reabrir chama a rota do inbox com a revisão", async () => {
    responder(conversaCompleta({ status: "closed" }));
    montar();
    expect(await screen.findByTestId("dossie-conversa-status", {}, { timeout: 5000 })).toHaveTextContent(
      "Fechada",
    );
    await userEvent.click(screen.getByTestId("dossie-conversa-reabrir"));
    await waitFor(() =>
      expect(rede.patch).toHaveBeenCalledWith(`/api/v1/conversations/${CONV}`, {
        status: "open",
        expected_revision: 7,
      }),
    );
  });

  it("suporte somente leitura: o motivo do inbox, e nenhum gesto de escrita", async () => {
    responder(conversaCompleta({ status: "closed", assigned_to_user_id: null }));
    montar({
      user: usuario({ support: { access_mode: "support_readonly" } } as Partial<AuthUser>),
      activeOrg: org({ interface_settings: { bloquearAteAssumir: true } } as Partial<ActiveOrg>),
    });
    expect(await screen.findByText("Acompanhamento somente leitura", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId("dossie-conversa-reabrir")).toBeNull();
    expect(screen.queryByTestId("dossie-conversa-assumir")).toBeNull();
  });
});

describe("quando a conversa não vem", () => {
  it("fora do acesso (404): diz isso, em vez de um painel vazio", async () => {
    responder(new ApiError(404, "not_found", undefined, "req-1"));
    montar();
    expect(
      await screen.findByText("Conversa não encontrada ou fora do seu acesso.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("outra falha: volta a porta de antes, com a prévia e o link para o inbox", async () => {
    responder(new ApiError(500, "internal", undefined, "req-1"));
    montar();
    expect(await screen.findByText("Quanto custa?", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/app/inbox?id=${CONV}`);
  });
});
