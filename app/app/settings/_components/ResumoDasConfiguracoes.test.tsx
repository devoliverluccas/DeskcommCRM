/**
 * O ÍNDICE DE CONFIGURAÇÕES — resumo nos cinco grupos, uma porta por tela.
 *
 * As specs e2e entram em `/app/settings` e clicam a porta pelo nome
 * (`getByRole("link", { name: /Distribuição de atendimento/ })`, sem `.first()`):
 * duas portas com o mesmo nome na tela reprovariam por ambiguidade. Por isso o
 * índice não ganha a coluna lateral, e aqui se cobra uma porta por destino.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const estado = { role: "admin" as string | null, agencia: false };

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      is_platform_admin: false,
      support: null,
      agency_org_ids: estado.agencia ? ["org-1"] : [],
    },
    activeOrg: {
      orgId: "org-1",
      role: estado.role,
      interface_settings: undefined,
      modulos_ligados: estado.agencia ? ["agencias"] : [],
      capacidades_ligadas: [],
    },
  }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/settings",
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));

import { ResumoDasConfiguracoes } from "./ResumoDasConfiguracoes";

describe("ResumoDasConfiguracoes", () => {
  it("título Configurações e os grupos como seções", () => {
    estado.role = "admin";
    estado.agencia = false;
    render(<ResumoDasConfiguracoes />);
    expect(screen.getByRole("heading", { level: 1, name: "Configurações" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Atendimento" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Equipe e segurança" })).toBeTruthy();
  });

  it("uma porta por destino, com rótulo e descrição no mesmo link", () => {
    estado.role = "admin";
    render(<ResumoDasConfiguracoes />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(screen.getAllByRole("link", { name: /Distribuição de atendimento/ })).toHaveLength(1);
    expect(hrefs).toContain("/app/settings/tags");
  });

  it("a porta da agência só aparece para a agência", () => {
    estado.agencia = false;
    const { unmount } = render(<ResumoDasConfiguracoes />);
    expect(document.querySelector('a[href="/app/settings/organizacoes"]')).toBeNull();
    unmount();
    estado.agencia = true;
    render(<ResumoDasConfiguracoes />);
    expect(document.querySelector('a[href="/app/settings/organizacoes"]')).not.toBeNull();
  });

  it("a busca filtra o resumo", () => {
    estado.agencia = false;
    render(<ResumoDasConfiguracoes />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar seção" }), {
      target: { value: "perfil" },
    });
    expect(document.querySelector('a[href="/app/settings/profile"]')).not.toBeNull();
    expect(document.querySelector('a[href="/app/settings/tags"]')).toBeNull();
  });
});
