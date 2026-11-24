import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";

import { PontosDoContato } from "./PontosDoContato";

/**
 * PONTOS NA FICHA (fase 4, 4.5): o total ao lado do score e o extrato a um
 * clique. Sem regra nem extrato, nada é desenhado — e falha de leitura também
 * não quebra a ficha.
 */

vi.mock("@/lib/api/client");
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));

const CONTATO = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PontosDoContato", () => {
  it("mostra o total e, ao clicar, o extrato com sinal, motivo e evento", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        total: 15,
        itens: [
          { id: "e1", contact_id: CONTATO, lead_id: null, regra_id: "r1", evento: "respondeu_followup", pontos: 20, motivo: "Respondeu", ocorrido_em: "2026-11-24T12:00:00Z" },
          { id: "e2", contact_id: CONTATO, lead_id: null, regra_id: "r2", evento: "tag_aplicada", pontos: -5, motivo: "Frio", ocorrido_em: "2026-11-24T11:00:00Z" },
        ],
      },
    });
    render(<PontosDoContato contactId={CONTATO} />);

    const gatilho = await screen.findByTestId("pontos-do-contato");
    expect(gatilho.textContent).toContain("15");
    expect(apiClient.get).toHaveBeenCalledWith(`/api/v1/pontuacao/extrato?contact_id=${CONTATO}`);

    fireEvent.click(gatilho);
    const extrato = await screen.findByTestId("pontos-extrato");
    expect(extrato.textContent).toContain("+20");
    expect(extrato.textContent).toContain("−5");
    expect(extrato.textContent).toContain("Respondeu");
    expect(extrato.textContent).toContain("Tag aplicada");
  });

  it("sem pontos e sem extrato, não desenha nada", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { total: 0, itens: [] } });
    const { container } = render(<PontosDoContato contactId={CONTATO} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("falha de leitura não quebra a ficha", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("caiu"));
    const { container } = render(<PontosDoContato contactId={CONTATO} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("negócio sem contato não consulta", () => {
    render(<PontosDoContato contactId={null} />);
    expect(apiClient.get).not.toHaveBeenCalled();
  });
});
