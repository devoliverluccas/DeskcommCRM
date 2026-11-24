import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: { get: (...args: unknown[]) => get(...args) } }));

import { ProtocoloDoAtendimento, SeletorDeMotivoAoEncerrar, useMotivoAoEncerrar } from "./MotivoAoEncerrar";

/**
 * O MOTIVO NO DIÁLOGO DE FECHAR (fase 3, 3.2).
 *
 * Prende: sem motivo cadastrado o diálogo é o de sempre (nada aparece, nada vai
 * no corpo — é o que mantém o e2e de encerramento intacto); com a exigência e
 * lista ativa, "Fechar" fica bloqueado até escolher; o motivo escolhido vai no
 * corpo e some quando o diálogo fecha; motivo inativo não é oferecido.
 */

const SPAM = { id: "m1", nome: "Spam", categoria: "nao_procede", ativo: true, ordem: 0 };
const VELHO = { id: "m2", nome: "Antigo", categoria: "resolvida", ativo: false, ordem: 1 };

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function Dialogo({ aberto }: { aberto: boolean }) {
  const estado = useMotivoAoEncerrar(aberto);
  return (
    <div>
      <SeletorDeMotivoAoEncerrar estado={estado} />
      <button disabled={estado.bloqueiaFechar}>Fechar</button>
      <output data-testid="corpo">{JSON.stringify(estado.corpo)}</output>
    </div>
  );
}

beforeEach(() => get.mockReset());

describe("useMotivoAoEncerrar + seletor", () => {
  it("sem motivo cadastrado: nada aparece, Fechar livre e corpo vazio", async () => {
    get.mockResolvedValue({ data: { motivos: [], motivo_obrigatorio_ao_encerrar: true } });
    render(<Dialogo aberto />, { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/motivos-de-encerramento"));
    expect(screen.queryByTestId("motivo-ao-encerrar")).toBeNull();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeEnabled();
    expect(screen.getByTestId("corpo").textContent).toBe("{}");
  });

  it("exigido: Fechar bloqueado até escolher; o motivo vai no corpo; inativo não é oferecido", async () => {
    get.mockResolvedValue({ data: { motivos: [SPAM, VELHO], motivo_obrigatorio_ao_encerrar: true } });
    render(<Dialogo aberto />, { wrapper });
    const seletor = await screen.findByLabelText("Motivo do encerramento");
    expect(screen.getByRole("button", { name: "Fechar" })).toBeDisabled();
    expect(screen.queryByRole("option", { name: "Antigo" })).toBeNull();

    fireEvent.change(seletor, { target: { value: "m1" } });

    expect(screen.getByRole("button", { name: "Fechar" })).toBeEnabled();
    expect(screen.getByTestId("corpo").textContent).toBe(JSON.stringify({ motivo_id: "m1" }));
  });

  it("opcional: aparece com 'Sem motivo' e não bloqueia", async () => {
    get.mockResolvedValue({ data: { motivos: [SPAM], motivo_obrigatorio_ao_encerrar: false } });
    render(<Dialogo aberto />, { wrapper });
    await screen.findByRole("option", { name: "Sem motivo" });
    expect(screen.getByRole("button", { name: "Fechar" })).toBeEnabled();
  });

  it("fechado não busca; reabrir recomeça sem a escolha anterior", async () => {
    get.mockResolvedValue({ data: { motivos: [SPAM], motivo_obrigatorio_ao_encerrar: false } });
    const { result, rerender } = renderHook(({ aberto }) => useMotivoAoEncerrar(aberto), {
      wrapper,
      initialProps: { aberto: false },
    });
    expect(get).not.toHaveBeenCalled();
    rerender({ aberto: true });
    await waitFor(() => expect(result.current.ativos).toHaveLength(1));
    act(() => result.current.escolher("m1"));
    expect(result.current.corpo).toEqual({ motivo_id: "m1" });
    rerender({ aberto: false });
    rerender({ aberto: true });
    expect(result.current.corpo).toEqual({});
  });
});

describe("ProtocoloDoAtendimento", () => {
  it("mostra o número; sem protocolo, nada", () => {
    const { rerender } = render(<ProtocoloDoAtendimento protocolo="20261124-000042" />);
    expect(screen.getByTestId("protocolo-do-atendimento").textContent).toContain("20261124-000042");
    rerender(<ProtocoloDoAtendimento protocolo={null} />);
    expect(screen.queryByTestId("protocolo-do-atendimento")).toBeNull();
  });
});
