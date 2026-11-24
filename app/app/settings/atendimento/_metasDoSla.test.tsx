import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MetasDoSlaForm } from "./_metasDoSla";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const toastErro = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastErro(...a) } }));

const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  toastErro.mockReset();
  fetcher.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ data: {} }) });
});

const SETOR = "44444444-4444-4444-8444-444444444444";
const semMetas = { primeira_resposta_min: null, resolucao_horas: null, por_setor: {} };
const corpo = () => JSON.parse(fetcher.mock.calls[0]![1].body) as unknown;

describe("Metas de SLA na tela de atendimento", () => {
  it("em branco salva sem meta; número vira meta", async () => {
    render(<MetasDoSlaForm initial={semMetas} setores={[]} idioma="pt-BR" />);
    fireEvent.change(screen.getByLabelText("Primeira resposta (minutos)"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar metas" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(fetcher.mock.calls[0]![0]).toContain("/api/v1/settings/sla");
    expect(corpo()).toEqual({ primeira_resposta_min: 15, resolucao_horas: null, por_setor: {} });
  });

  it("meta própria do setor parte das metas da organização e vai junto", async () => {
    render(
      <MetasDoSlaForm
        initial={{ ...semMetas, resolucao_horas: 24 }}
        setores={[{ id: SETOR, name: "Comercial" }]}
        idioma="pt-BR"
      />,
    );
    expect(screen.getByText("Usa as metas da organização.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Comercial" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar metas" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(corpo()).toEqual({
      primeira_resposta_min: null,
      resolucao_horas: 24,
      por_setor: { [SETOR]: { primeira_resposta_min: null, resolucao_horas: 24 } },
    });
  });

  it("valor inválido não sai para a rota", () => {
    render(<MetasDoSlaForm initial={semMetas} setores={[]} idioma="pt-BR" />);
    fireEvent.change(screen.getByLabelText("Resolução (horas)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar metas" }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(toastErro).toHaveBeenCalled();
  });
});
