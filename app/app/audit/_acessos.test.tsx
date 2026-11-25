/**
 * Aba "Acessos": a tela desenha pessoa por NOME, evento legível, aparelho
 * resumido e o IP como a rota mandou (mascarado para quem não administra).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

const m = vi.hoisted(() => ({ get: vi.fn(), paginas: [] as unknown[] }));

vi.mock("@/lib/api/client", () => ({ apiClient: { get: m.get } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/hooks/team/useTeamMembers", () => ({
  useTeamMembers: () => ({
    data: {
      data: [
        { user_id: "11111111-1111-4111-8111-111111111111", full_name: "Ana Souza", email: "ana@example.com" },
      ],
    },
  }),
}));

import { AcessosDaEmpresa } from "./_acessos";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(IdiomaProvider, { locale: "pt-BR", children: <AcessosDaEmpresa /> }),
    ),
  );
}

beforeEach(() => {
  m.get.mockReset();
});
afterEach(cleanup);

describe("Auditoria › Acessos", () => {
  it("mostra nome, evento, aparelho legível e o IP mascarado com a explicação", async () => {
    m.get.mockResolvedValue({
      data: [
        {
          id: "a1",
          created_at: "2026-11-25T13:00:00.000Z",
          actor_user_id: "11111111-1111-4111-8111-111111111111",
          action: "auth.login_success",
          metadata: { provider: "google" },
          ip: "203.0.113.x",
          ip_mascarado: true,
          user_agent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        },
      ],
      meta: { has_more: false, cursor: null },
    });
    montar();
    expect(await screen.findByText("Entrou com Google")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ana Souza" })).toBeInTheDocument();
    expect(screen.getByText("Chrome no Windows")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.x")).toBeInTheDocument();
    expect(screen.getByText(/só quem administra a empresa vê o endereço completo/)).toBeInTheDocument();
    expect(m.get).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/v1\/audit\/acessos\?/));
  });

  it("sem acessos no período, diz isso", async () => {
    m.get.mockResolvedValue({ data: [], meta: { has_more: false } });
    montar();
    expect(await screen.findByText("Nenhum acesso no período.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar planilha" })).toBeInTheDocument();
  });
});
