import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";

import { ResumoDoEnvio } from "./ResumoDoEnvio";

/**
 * O RESUMO ANTES DE ENVIAR na página de criar campanha (fase 4, 4.7): a tela só
 * formata o que o servidor contou — quem recebe e quem fica de fora, a
 * categoria do modelo, o custo NÃO estimado (com o porquê), o limite do número,
 * a janela e a duração — e avisa quando o formulário mudou depois do resumo.
 */

vi.mock("@/lib/api/client");
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));

const PEDIDO = { audience_filter: { com_alguma_tag: ["vip"] }, channel_session_id: "n1" };

const RESUMO = {
  audiencia: {
    total: 12,
    elegiveis: 10,
    excluidos: 2,
    motivos: { opt_out: 1, sem_telefone: 1 },
    truncado: false,
    amostra: [],
    legenda: { opt_out: "Pediu para não receber mensagens", sem_telefone: "Sem telefone no cadastro" },
  },
  modelo: { nome: "promo_black", categoria: "marketing" },
  custo: null,
  numero: {
    limiteDoDia: 20,
    origemDoLimite: "aquecimento",
    idadeEmDias: 2,
    janela: { inicio: 7, fim: 22, horas: 15 },
    fuso: "America/Sao_Paulo",
    numeros: 1,
  },
  velocidade: "gradual",
  duracao: { porDia: 20, minutos: 10, dias: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ResumoDoEnvio", () => {
  it("sem critério de público, não há o que contar", () => {
    render(<ResumoDoEnvio pedido={null} />);
    expect(screen.getByRole("button", { name: "Ver o resumo do envio" })).toBeDisabled();
  });

  it("mostra o que o servidor contou, e diz que o custo não é estimado", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: RESUMO });
    render(<ResumoDoEnvio pedido={PEDIDO} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver o resumo do envio" }));

    expect(await screen.findByText("10")).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith("/api/v1/campaigns/resumo", PEDIDO);
    const secao = screen.getByTestId("resumo-do-envio");
    expect(screen.getByTestId("resumo-exclusoes").textContent).toContain("Pediu para não receber mensagens");
    expect(secao.textContent).toContain("promo_black");
    expect(secao.textContent).toContain("Marketing");
    expect(secao.textContent).toContain("Não estimado: não há tabela de preço por mensagem configurada neste sistema.");
    expect(secao.textContent).toContain("aquecimento: número com 2 dia(s) de uso");
    expect(secao.textContent).toContain("7h–22h");
    expect(screen.getByTestId("resumo-duracao").textContent).toContain("cerca de 10 min");
  });

  it("lista que leva dias mostra os dias e o teto por dia", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { ...RESUMO, duracao: { porDia: 20, minutos: null, dias: 5 } } });
    render(<ResumoDoEnvio pedido={PEDIDO} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver o resumo do envio" }));
    const duracao = await screen.findByTestId("resumo-duracao");
    expect(duracao.textContent).toContain("cerca de 5 dias");
    expect(duracao.textContent).toContain("até 20 por dia");
  });

  it("o formulário mudou depois do resumo: avisa que está desatualizado", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: RESUMO });
    const { rerender } = render(<ResumoDoEnvio pedido={PEDIDO} />);
    fireEvent.click(screen.getByRole("button", { name: "Ver o resumo do envio" }));
    await screen.findByTestId("resumo-duracao");
    expect(screen.queryByTestId("resumo-desatualizado")).not.toBeInTheDocument();

    rerender(<ResumoDoEnvio pedido={{ ...PEDIDO, teto_diario: 5 }} />);
    expect(screen.getByTestId("resumo-desatualizado")).toBeInTheDocument();
  });
});
