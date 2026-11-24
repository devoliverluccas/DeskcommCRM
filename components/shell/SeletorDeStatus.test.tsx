/**
 * "● Online / ○ Offline" no rodapé do menu: liga e desliga o `is_available` da
 * PRÓPRIA pessoa pela mesma rota e pelos mesmos hooks da tela Equipe.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/lib/auth/types";

const EU = "11111111-1111-4111-8111-111111111111";
const OUTRA = "22222222-2222-4222-8222-222222222222";

const cenario = vi.hoisted(() => ({
  papel: "agent" as Role,
  roster: [] as Array<{ user_id: string; is_available: boolean }> | undefined,
  mutate: vi.fn(),
  rosterPedido: 0,
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: EU }, activeOrg: { orgId: "org-1", role: cenario.papel } }),
}));
vi.mock("@/hooks/team/useAttendants", () => ({
  useAttendants: () => {
    cenario.rosterPedido += 1;
    return { data: cenario.roster ? { data: cenario.roster } : undefined };
  },
  useUpdateAvailability: () => ({ mutate: cenario.mutate, isPending: false }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));

import { SeletorDeStatus } from "./SeletorDeStatus";

function comCliente(no: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{no}</QueryClientProvider>);
}

const seletor = () => screen.queryByTestId("seletor-de-status");

beforeEach(() => {
  cenario.papel = "agent";
  cenario.roster = [
    { user_id: OUTRA, is_available: false },
    { user_id: EU, is_available: true },
  ];
  cenario.mutate = vi.fn();
  cenario.rosterPedido = 0;
});
afterEach(() => cleanup());

describe("o seletor de status no rodapé do menu", () => {
  it("mostra o estado atual da PRÓPRIA pessoa: Online", () => {
    comCliente(<SeletorDeStatus collapsed={false} />);
    const el = seletor()!;
    expect(el.getAttribute("role")).toBe("switch");
    expect(el.getAttribute("aria-checked")).toBe("true");
    expect(el.textContent).toBe("Online");
  });

  it("desligado, diz Offline — e clicar liga", () => {
    cenario.roster = [{ user_id: EU, is_available: false }];
    comCliente(<SeletorDeStatus collapsed={false} />);
    const el = seletor()!;
    expect(el.getAttribute("aria-checked")).toBe("false");
    expect(el.textContent).toBe("Offline");
    fireEvent.click(el);
    expect(cenario.mutate).toHaveBeenCalledWith({ userId: EU, patch: { is_available: true } });
  });

  it("ligado, clicar desliga — só o próprio usuário, nunca outro", () => {
    comCliente(<SeletorDeStatus collapsed={false} />);
    fireEvent.click(seletor()!);
    expect(cenario.mutate).toHaveBeenCalledWith({ userId: EU, patch: { is_available: false } });
  });

  it("recolhido: só a bolinha, com o estado no title", () => {
    comCliente(<SeletorDeStatus collapsed />);
    const el = seletor()!;
    expect(el.textContent).toBe("");
    expect(el.getAttribute("title")).toBe("Online");
    expect(el.querySelector('[data-status="online"]')).not.toBeNull();
  });

  it("antes do roster chegar, não chuta um estado", () => {
    cenario.roster = undefined;
    comCliente(<SeletorDeStatus collapsed={false} />);
    expect(seletor()).toBeNull();
  });

  it("viewer não vê o seletor — e o roster nem é pedido", () => {
    cenario.papel = "viewer";
    comCliente(<SeletorDeStatus collapsed={false} />);
    expect(seletor()).toBeNull();
    expect(cenario.rosterPedido).toBe(0);
  });

  it("sem cliente de consultas (prévia do menu), não derruba o menu", () => {
    const { container } = render(<SeletorDeStatus collapsed={false} />);
    expect(container.innerHTML).toBe("");
  });
});
