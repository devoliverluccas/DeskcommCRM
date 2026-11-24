/**
 * O SELO DE SLA na linha da lista (fase 3, item 3.3).
 *
 * ─── SABOTAGEM ──────────────────────────────────────────────────────────────
 * - Tirar `<SeloDeSla>` da linha: caem "estourado aparece" e "perto aparece".
 * - Mostrar dentro do prazo na lista (tirar o `!estado.perto`): cai "dentro não aparece".
 * - Ignorar `sla_ignorado_em` em `estadoDoSla`: cai "ignorada não aparece".
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MetasDoSla } from "@/lib/schemas/settings";

import { ConversationListItem } from "./ConversationListItem";
import { ProvedorDoSlaFixo, SeloDeSla, type ValorDoSla } from "./SeloDeSla";
import { conversaDeExemplo } from "./__fixtures__/conversa";

const AGORA = new Date("2026-11-23T15:00:00.000Z");
const metas: MetasDoSla = { primeira_resposta_min: 30, resolucao_horas: null, por_setor: {} };
const valor: ValorDoSla = { metas, expedientes: {}, agora: AGORA };

function linha(esperaDesde: string, extra: Record<string, unknown> = {}, comProvedor = true) {
  const conversation = {
    ...conversaDeExemplo.conversation,
    last_inbound_at: esperaDesde,
    awaiting_since: esperaDesde,
    last_outbound_at: null,
    ...extra,
  };
  const item = <ConversationListItem conversation={conversation} {...conversaDeExemplo.props} />;
  return render(comProvedor ? <ProvedorDoSlaFixo value={valor}>{item}</ProvedorDoSlaFixo> : item);
}

describe("SeloDeSla na lista de conversas", () => {
  it("estourado aparece em destaque de erro, dizendo quanto passou", () => {
    linha("2026-11-23T13:00:00.000Z"); // 2h de espera, meta de 30 min
    const selo = screen.getByTestId("selo-sla");
    expect(selo).toHaveAttribute("data-estado", "estourado");
    expect(selo).toHaveTextContent("+1h 30min");
    expect(selo.className).toContain("bg-error-bg");
  });

  it("perto de estourar (≥ 80%) aparece discreto", () => {
    linha("2026-11-23T14:35:00.000Z"); // 25 de 30 min
    const selo = screen.getByTestId("selo-sla");
    expect(selo).toHaveAttribute("data-estado", "perto");
    expect(selo).toHaveTextContent("faltam 5min");
    expect(selo.className).toContain("text-warning-fg");
  });

  it("dentro do prazo não aparece na lista", () => {
    linha("2026-11-23T14:55:00.000Z");
    expect(screen.queryByTestId("selo-sla")).toBeNull();
  });

  it("ignorada ou encerrada não aparece", () => {
    linha("2026-11-23T13:00:00.000Z", { sla_ignorado_em: "2026-11-23T14:00:00.000Z" });
    expect(screen.queryByTestId("selo-sla")).toBeNull();
  });

  it("encerrada não aparece", () => {
    linha("2026-11-23T13:00:00.000Z", { status: "closed" });
    expect(screen.queryByTestId("selo-sla")).toBeNull();
  });

  it("sem provedor (sem meta) a linha é a de antes", () => {
    linha("2026-11-23T13:00:00.000Z", {}, false);
    expect(screen.queryByTestId("selo-sla")).toBeNull();
  });

  it("no cabeçalho (`sempre`) aparece também dentro do prazo, em tom neutro", () => {
    render(
      <ProvedorDoSlaFixo value={valor}>
        <SeloDeSla
          sempre
          conversa={{
            status: "open",
            last_inbound_at: "2026-11-23T14:55:00.000Z",
            awaiting_since: "2026-11-23T14:55:00.000Z",
          }}
        />
      </ProvedorDoSlaFixo>,
    );
    const selo = screen.getByTestId("selo-sla");
    expect(selo).toHaveAttribute("data-estado", "dentro");
    expect(selo).toHaveAttribute("title", "Primeira resposta: faltam 25min");
  });
});
