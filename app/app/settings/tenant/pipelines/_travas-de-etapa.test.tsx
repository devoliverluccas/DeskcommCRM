/**
 * AS TRAVAS NA TELA DO FUNIL (fase 2, item 2.3): marcar grava o mapa INTEIRO
 * pela porta do funil, desmarcar a última tira a etapa do mapa, e o interruptor
 * do funil grava só a chave dele. Gravação recusada desfaz a marca na tela.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { updatePipelineConfig } from "@/app/actions/settings/updatePipelineConfig";

import {
  PermitirMoverMesmoAssim,
  RequisitosDaEtapa,
  mapaComRequisito,
  useTravasDoFunil,
} from "./_travas-de-etapa";

vi.mock("@/app/actions/settings/updatePipelineConfig", () => ({
  updatePipelineConfig: vi.fn(async () => ({ ok: true })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const FUNIL = "44444444-4444-4444-8444-444444444444";
const ETAPA = "55555555-5555-4555-8555-555555555555";
const OUTRA = "66666666-6666-4666-8666-666666666666";

function Tela({ settings }: { settings: unknown }) {
  const travas = useTravasDoFunil(FUNIL, settings);
  return (
    <>
      <PermitirMoverMesmoAssim travas={travas} desabilitado={false} />
      <RequisitosDaEtapa stageId={ETAPA} nomeDaEtapa="Proposta" travas={travas} desabilitado={false} />
    </>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("mapaComRequisito", () => {
  it("liga, desliga e tira a etapa vazia do mapa", () => {
    const um = mapaComRequisito({}, ETAPA, "tarefa_concluida", true);
    expect(um).toEqual({ [ETAPA]: ["tarefa_concluida"] });
    const dois = mapaComRequisito(um, ETAPA, "orcamento_vinculado", true);
    expect(dois).toEqual({ [ETAPA]: ["orcamento_vinculado", "tarefa_concluida"] });
    expect(mapaComRequisito({ [ETAPA]: ["tarefa_concluida"] }, ETAPA, "tarefa_concluida", false)).toEqual({});
  });
});

describe("travas na tela do funil", () => {
  it("marcar grava o mapa inteiro, preservando as outras etapas", async () => {
    render(
      <Tela settings={{ requisitos_por_etapa: { [OUTRA]: [{ tipo: "agendamento_marcado" }] } }} />,
    );
    expect(screen.getByText("Exigir para entrar nesta etapa")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`requisito-orcamento_vinculado-${ETAPA}`));
    await waitFor(() => expect(updatePipelineConfig).toHaveBeenCalledTimes(1));
    expect(updatePipelineConfig).toHaveBeenCalledWith(FUNIL, {
      requisitos_por_etapa: {
        [OUTRA]: [{ tipo: "agendamento_marcado" }],
        [ETAPA]: [{ tipo: "orcamento_vinculado" }],
      },
    });
  });

  it("o interruptor do funil grava só a chave dele", async () => {
    render(<Tela settings={{}} />);
    fireEvent.click(screen.getByTestId("permitir-mover-mesmo-assim"));
    await waitFor(() =>
      expect(updatePipelineConfig).toHaveBeenCalledWith(FUNIL, { permitir_mover_mesmo_assim: true }),
    );
  });

  it("gravação recusada desfaz a marca", async () => {
    vi.mocked(updatePipelineConfig).mockResolvedValueOnce({ ok: false, error: "forbidden_role" });
    render(<Tela settings={{}} />);
    const caixa = screen.getByTestId(`requisito-tarefa_concluida-${ETAPA}`) as HTMLInputElement;
    fireEvent.click(caixa);
    await waitFor(() => expect(updatePipelineConfig).toHaveBeenCalled());
    await waitFor(() => expect(caixa.checked).toBe(false));
  });
});
