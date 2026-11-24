import { describe, expect, it } from "vitest";

import { esperaDaConversa } from "./comando-da-conversa";
import { duracaoCurta, estadoDoSla, tempoDeExpedienteMs, type FatosDoSla } from "./sla";

const H = 3_600_000;
const MIN = 60_000;

/** Segunda-feira, 23/11/2026, 12:00 em São Paulo (15:00 UTC). */
const SEGUNDA_MEIO_DIA = new Date("2026-11-23T15:00:00.000Z");

const comercial = {
  timezone: "America/Sao_Paulo",
  // seg a sex, 09:00–18:00
  windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "18:00" })),
};

function conversa(parcial: Partial<FatosDoSla> = {}): FatosDoSla {
  return {
    status: "open",
    created_at: "2026-11-20T10:00:00.000Z",
    service_started_at: null,
    last_inbound_at: "2026-11-23T14:50:00.000Z",
    awaiting_since: "2026-11-23T14:50:00.000Z",
    last_outbound_at: null,
    sla_ignorado_em: null,
    ...parcial,
  };
}

describe("tempoDeExpedienteMs", () => {
  it("sem janela é o relógio corrido (24/7, como a fila)", () => {
    const ini = new Date(SEGUNDA_MEIO_DIA.getTime() - 5 * H);
    expect(tempoDeExpedienteMs(ini, SEGUNDA_MEIO_DIA, null)).toBe(5 * H);
    expect(tempoDeExpedienteMs(ini, SEGUNDA_MEIO_DIA, { timezone: "UTC", windows: [] })).toBe(5 * H);
  });

  it("dentro da mesma janela conta tudo", () => {
    const ini = new Date(SEGUNDA_MEIO_DIA.getTime() - 2 * H); // 10:00 local
    expect(tempoDeExpedienteMs(ini, SEGUNDA_MEIO_DIA, comercial)).toBe(2 * H);
  });

  it("a noite e o fim de semana não contam", () => {
    // sexta 17:00 local (20:00 UTC) → segunda 10:00 local (13:00 UTC):
    // 1h na sexta + 1h na segunda.
    const sexta17 = new Date("2026-11-20T20:00:00.000Z");
    const segunda10 = new Date("2026-11-23T13:00:00.000Z");
    expect(tempoDeExpedienteMs(sexta17, segunda10, comercial)).toBe(2 * H);
  });

  it("começar fora do expediente espera a próxima janela, respeitando segundos", () => {
    // domingo 23:59:30 local → segunda 09:00:30 local = 30s úteis
    const ini = new Date("2026-11-23T02:59:30.000Z");
    const fim = new Date("2026-11-23T12:00:30.000Z");
    expect(tempoDeExpedienteMs(ini, fim, comercial)).toBe(30_000);
  });

  it("intervalo invertido é zero", () => {
    expect(tempoDeExpedienteMs(SEGUNDA_MEIO_DIA, new Date(0), comercial)).toBe(0);
  });
});

describe("duracaoCurta", () => {
  it("dois termos no máximo", () => {
    expect(duracaoCurta(12 * MIN)).toBe("12min");
    expect(duracaoCurta(3 * H + 20 * MIN)).toBe("3h 20min");
    expect(duracaoCurta(2 * H)).toBe("2h");
    expect(duracaoCurta(5 * 24 * H + 6 * H + 10 * MIN)).toBe("5d 6h");
    expect(duracaoCurta(10_000)).toBe("1min");
  });
});

describe("estadoDoSla", () => {
  const metas = { primeira_resposta_min: 30, resolucao_horas: 24 };

  it("sem meta nenhuma não há selo (o comportamento de antes)", () => {
    expect(
      estadoDoSla({
        conversa: conversa(),
        metas: { primeira_resposta_min: null, resolucao_horas: null },
        agora: SEGUNDA_MEIO_DIA,
      }),
    ).toBeNull();
  });

  it("encerrada, ignorada ou sem mensagem do cliente não têm selo", () => {
    for (const c of [
      conversa({ status: "closed" }),
      conversa({ sla_ignorado_em: "2026-11-23T14:55:00.000Z" }),
      conversa({ last_inbound_at: null, awaiting_since: null }),
    ]) {
      expect(estadoDoSla({ conversa: c, metas, agora: SEGUNDA_MEIO_DIA })).toBeNull();
    }
  });

  it("primeira resposta dentro do prazo: faltam", () => {
    const e = estadoDoSla({ conversa: conversa(), metas, agora: SEGUNDA_MEIO_DIA });
    expect(e).toMatchObject({ tipo: "primeira_resposta", estourado: false, perto: false });
    expect(e?.restanteMs).toBe(20 * MIN);
    expect(e?.rotulo).toBe("faltam 20min");
  });

  it("perto de estourar a partir de 80% do prazo", () => {
    const e = estadoDoSla({
      conversa: conversa({ awaiting_since: "2026-11-23T14:35:00.000Z" }), // 25 de 30 min
      metas,
      agora: SEGUNDA_MEIO_DIA,
    });
    expect(e).toMatchObject({ estourado: false, perto: true });
  });

  it("estourado diz quanto passou", () => {
    const e = estadoDoSla({
      conversa: conversa({ awaiting_since: "2026-11-23T13:00:00.000Z" }), // 2h de espera
      metas,
      agora: SEGUNDA_MEIO_DIA,
    });
    expect(e).toMatchObject({ tipo: "primeira_resposta", estourado: true, perto: true });
    expect(e?.excedidoMs).toBe(90 * MIN);
    expect(e?.rotulo).toBe("+1h 30min");
  });

  it("a espera é a MESMA de esperaDaConversa (a fila e o selo têm uma régua só)", () => {
    // Sem awaiting_since, a régua cai em last_inbound_at — e o selo acompanha.
    const c = conversa({ awaiting_since: null, last_inbound_at: "2026-11-23T14:40:00.000Z" });
    const e = estadoDoSla({ conversa: c, metas, agora: SEGUNDA_MEIO_DIA });
    const desde = new Date(esperaDaConversa(c) as string).getTime();
    expect(e?.restanteMs).toBe(30 * MIN - (SEGUNDA_MEIO_DIA.getTime() - desde));
  });

  it("fora do expediente o relógio para", () => {
    // Cliente escreveu sexta 17:50 local; agora é segunda 09:10 local → 20 min úteis.
    const e = estadoDoSla({
      conversa: conversa({ awaiting_since: "2026-11-20T20:50:00.000Z", last_inbound_at: "2026-11-20T20:50:00.000Z" }),
      metas,
      agora: new Date("2026-11-23T12:10:00.000Z"),
      expediente: comercial,
    });
    expect(e).toMatchObject({ estourado: false, restanteMs: 10 * MIN });
  });

  it("depois da primeira resposta vale a resolução, desde o começo do atendimento", () => {
    const e = estadoDoSla({
      conversa: conversa({
        service_started_at: "2026-11-22T16:00:00.000Z",
        last_outbound_at: "2026-11-22T16:05:00.000Z",
      }),
      metas,
      agora: SEGUNDA_MEIO_DIA,
    });
    expect(e).toMatchObject({ tipo: "resolucao", estourado: false, perto: true });
    expect(e?.rotulo).toBe("faltam 1h");
  });

  it("resposta de um atendimento ANTERIOR não conta como primeira resposta", () => {
    const e = estadoDoSla({
      conversa: conversa({
        service_started_at: "2026-11-23T14:45:00.000Z",
        last_outbound_at: "2026-11-21T10:00:00.000Z",
      }),
      metas,
      agora: SEGUNDA_MEIO_DIA,
    });
    expect(e?.tipo).toBe("primeira_resposta");
  });

  it("respondida e sem meta de resolução: sem selo", () => {
    const e = estadoDoSla({
      conversa: conversa({ last_outbound_at: "2026-11-23T14:55:00.000Z" }),
      metas: { primeira_resposta_min: 30, resolucao_horas: null },
      agora: SEGUNDA_MEIO_DIA,
    });
    expect(e).toBeNull();
  });

  it("o texto passa pelo tradutor", () => {
    const e = estadoDoSla({
      conversa: conversa(),
      metas,
      agora: SEGUNDA_MEIO_DIA,
      t: (s) => (s === "faltam" ? "quedan" : s),
    });
    expect(e?.rotulo).toBe("quedan 20min");
  });
});
