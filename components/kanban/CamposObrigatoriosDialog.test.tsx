/**
 * O DIÁLOGO DAS TRAVAS DE ETAPA (fase 2, item 2.3).
 *
 *   - item `tipo: "requisito"` vira linha com atalho, não input;
 *   - o título nomeia a etapa quando o quadro está em cache;
 *   - "Mover mesmo assim" só aparece com a marca `pode_forcar` do servidor, e
 *     reenvia o MESMO move com `forcar: true` e os campos preenchidos;
 *   - sem requisito, o diálogo é o de sempre ("Campos obrigatórios", "Mover agora").
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";

import { CamposObrigatoriosDialog, atalhoDoRequisito } from "./CamposObrigatoriosDialog";

vi.mock("@/lib/api/client", () => ({ apiClient: { post: vi.fn(async () => ({ data: {} })) } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

const LEAD = "33333333-3333-4333-8333-333333333333";
const ETAPA = "66666666-6666-4666-8666-666666666666";
const ARGS = { leadId: LEAD, stageId: ETAPA, positionInStage: 1500, expectedUpdatedAt: "2026-11-24T12:00:00.000Z" };

function comQuadro(no: ReactNode) {
  const qc = new QueryClient();
  qc.setQueryData(["board", "funil"], {
    pipeline: {},
    stages: [{ id: ETAPA, name: "Proposta enviada" }],
    leads: [],
  });
  return <QueryClientProvider client={qc}>{no}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe("CamposObrigatoriosDialog — travas de etapa", () => {
  it("requisito vira linha com atalho, e o título nomeia a etapa", () => {
    render(
      comQuadro(
        <CamposObrigatoriosDialog
          open
          onOpenChange={() => {}}
          onConfirmar={() => {}}
          recusa={{
            args: ARGS,
            faltando: [
              { chave: "orcamento_vinculado", rotulo: "Orçamento vinculado ao negócio", tipo: "requisito" },
              { chave: "agendamento_marcado", rotulo: "Agendamento marcado", tipo: "requisito" },
              { chave: "tarefa_concluida", rotulo: "Tarefa concluída", tipo: "requisito" },
            ],
          }}
        />,
      ),
    );
    expect(screen.getByText("Para mover para Proposta enviada falta:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar orçamento" })).toHaveAttribute(
      "href",
      `/app/proposals/novo?lead_id=${LEAD}`,
    );
    expect(screen.getByRole("link", { name: "Agendar" })).toHaveAttribute("href", "/app/agenda");
    expect(screen.getByRole("link", { name: "Ver tarefas" })).toHaveAttribute(
      "href",
      `/app/leads/${LEAD}/pagina`,
    );
    // Sem a marca do servidor não há forçar, e "Mover agora" não resolveria nada.
    expect(screen.queryByRole("button", { name: "Mover mesmo assim" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mover agora" })).toBeNull();
  });

  it("com pode_forcar, 'Mover mesmo assim' reenvia o move com forcar e os campos", async () => {
    const aoFechar = vi.fn();
    render(
      comQuadro(
        <CamposObrigatoriosDialog
          open
          onOpenChange={aoFechar}
          onConfirmar={() => {}}
          recusa={{
            args: ARGS,
            faltando: [
              { chave: "concorrente", rotulo: "Concorrente", tipo: "text" },
              {
                chave: "orcamento_vinculado",
                rotulo: "Orçamento vinculado ao negócio",
                tipo: "requisito",
                pode_forcar: true,
              } as never,
            ],
          }}
        />,
      ),
    );
    const forcar = screen.getByRole("button", { name: "Mover mesmo assim" });
    // O campo obrigatório continua obrigatório: sem ele, forçar fica travado.
    expect(forcar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Concorrente"), { target: { value: "Acme" } });
    fireEvent.click(forcar);
    await waitFor(() => expect(aoFechar).toHaveBeenCalledWith(false));
    expect(apiClient.post).toHaveBeenCalledWith(`/api/v1/leads/${LEAD}/move`, {
      stage_id: ETAPA,
      position_in_stage: 1500,
      expected_updated_at: ARGS.expectedUpdatedAt,
      custom_fields: { concorrente: "Acme" },
      forcar: true,
    });
  });

  it("sem requisito, o diálogo é o de sempre", () => {
    render(
      <CamposObrigatoriosDialog
        open
        onOpenChange={() => {}}
        onConfirmar={() => {}}
        recusa={{ args: ARGS, faltando: [{ chave: "concorrente", rotulo: "Concorrente", tipo: "text" }] }}
      />,
    );
    expect(screen.getByText("Campos obrigatórios")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mover agora" })).toBeInTheDocument();
    expect(screen.queryByTestId("requisitos-faltando")).toBeNull();
  });

  it("fora do quadro (sem cache), o título fica genérico", () => {
    render(
      <CamposObrigatoriosDialog
        open
        onOpenChange={() => {}}
        onConfirmar={() => {}}
        recusa={{
          args: ARGS,
          faltando: [{ chave: "tarefa_concluida", rotulo: "Tarefa concluída", tipo: "requisito" }],
        }}
      />,
    );
    expect(screen.getByText("Para mover para esta etapa falta:")).toBeInTheDocument();
  });

  it("tipo desconhecido não ganha atalho", () => {
    expect(atalhoDoRequisito("outra_coisa", LEAD)).toBeNull();
  });
});
