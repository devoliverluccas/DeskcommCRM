/**
 * A faixa da fila no topo: quantas esperam, há quanto tempo, em que fila — e a
 * porta para a aba Fila. Lê a MESMA consulta do contador do menu (sem filtros),
 * some com a fila vazia e só aparece para quem pega conversa (agent+).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationCounts } from "@/hooks/inbox/useConversationCounts";
import type { Role } from "@/lib/auth/types";

const cenario = vi.hoisted(() => ({
  papel: "agent" as Role,
  contagem: { unassigned: 0, mine: 0, all: 0 } as ConversationCounts,
  chamadas: [] as Array<[string | null, unknown]>,
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ activeOrg: { orgId: "org-1", role: cenario.papel } }),
}));
vi.mock("@/hooks/inbox/useConversationCounts", () => ({
  useConversationCounts: (orgId: string | null, filtros?: unknown) => {
    cenario.chamadas.push([orgId, filtros]);
    return { data: cenario.contagem };
  },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

import { ENDERECO_DA_FILA, FaixaDaFila } from "./FaixaDaFila";

const faixa = () => screen.queryByTestId("faixa-da-fila");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
  cenario.papel = "agent";
  cenario.chamadas = [];
  cenario.contagem = {
    fila: 3,
    unassigned: 3,
    mine: 0,
    all: 0,
    fila_mais_antiga_desde: "2026-11-21T10:00:00.000Z",
    setores: [{ id: "s1", nome: "Vendas", na_fila: 3 }],
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a faixa da fila no topo", () => {
  it("diz quantas esperam, há quanto tempo a mais antiga, em que fila, e leva à aba Fila", () => {
    render(<FaixaDaFila />);
    const el = faixa()!;
    expect(el).not.toBeNull();
    expect(el.getAttribute("href")).toBe(ENDERECO_DA_FILA);
    expect(ENDERECO_DA_FILA).toBe("/app/inbox?filter=unassigned");
    expect(el.textContent).toContain("3 na fila");
    // 3 dias e 2 horas: o formato curto do painel de atendimento arredonda para baixo.
    expect(screen.getByTestId("faixa-da-fila-espera").textContent).toContain("mais antigo há 3 d");
    expect(screen.getByTestId("faixa-da-fila-setores").textContent).toContain("Vendas 3");
    expect(el.textContent).toContain("Ver fila");
  });

  it("lê a MESMA consulta do contador do menu: a da organização, sem filtros", () => {
    render(<FaixaDaFila />);
    expect(cenario.chamadas).toEqual([["org-1", undefined]]);
  });

  it("fila vazia: não desenha nada", () => {
    cenario.contagem = { fila: 0, unassigned: 0, mine: 0, all: 0, fila_mais_antiga_desde: null, setores: [] };
    const { container } = render(<FaixaDaFila />);
    expect(container.innerHTML).toBe("");
  });

  it("sem a espera nem os setores (cache antigo), mostra só o número e a porta", () => {
    cenario.contagem = { unassigned: 2, mine: 0, all: 0 };
    render(<FaixaDaFila />);
    expect(faixa()!.textContent).toContain("2 na fila");
    expect(screen.queryByTestId("faixa-da-fila-espera")).toBeNull();
    expect(screen.queryByTestId("faixa-da-fila-setores")).toBeNull();
  });

  it("viewer não vê a faixa — e nem pede a contagem", () => {
    cenario.papel = "viewer";
    render(<FaixaDaFila />);
    expect(faixa()).toBeNull();
    expect(cenario.chamadas).toEqual([]);
  });

  it("não aparece abaixo de md: a barra inferior do celular já tem o contador", () => {
    render(<FaixaDaFila />);
    const classes = faixa()!.className.split(/\s+/);
    expect(classes).toContain("hidden");
    expect(classes).toContain("md:flex");
  });
});
