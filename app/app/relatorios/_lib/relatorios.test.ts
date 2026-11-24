import { describe, expect, it } from "vitest";

import { montarCsv } from "./csv";
import { diaCurto, formatarTempo } from "./formato";
import { origensPorLinha } from "./origens";
import { abaDaUrl, abasVisiveis, deslocarDia, instantesDoPeriodo, periodoDaUrl } from "./periodo";

/**
 * 3.6 — as regras puras da tela de Relatórios.
 *
 * SABOTAGEM: contar os 7 dias a partir de amanhã (ou em UTC) quebra o caso do
 * fuso; deixar a aba de gestão abrir para o agent quebra o caso de papel; tirar
 * o apóstrofo do CSV quebra o caso da fórmula.
 */

const sp = (q: string) => new URLSearchParams(q);

describe("3.6 — a aba vem da URL", () => {
  it("aba desconhecida abre Desempenho; aba de gestão só para quem gerencia", () => {
    expect(abaDaUrl(null, true)).toBe("desempenho");
    expect(abaDaUrl("xyz", true)).toBe("desempenho");
    expect(abaDaUrl("atendimentos", false)).toBe("atendimentos");
    expect(abaDaUrl("satisfacao", true)).toBe("satisfacao");
    expect(abaDaUrl("satisfacao", false)).toBe("desempenho");
    expect(abaDaUrl("atribuicao", false)).toBe("desempenho");
    expect(abaDaUrl("sla", false)).toBe("desempenho");
    expect(abaDaUrl("sla", true)).toBe("sla");
    expect(abasVisiveis(false)).toEqual(["desempenho", "atendimentos", "origens"]);
  });
});

describe("3.6 — o período é de dias civis no fuso da organização", () => {
  // 02h30 UTC de 25/11 ainda é 24/11 em São Paulo.
  const agora = new Date("2026-11-25T02:30:00.000Z");

  it("7 dias terminam HOJE no fuso da organização, hoje incluído", () => {
    expect(periodoDaUrl(sp("p=7"), agora, "America/Sao_Paulo")).toEqual({
      preset: "7",
      de: "2026-11-18",
      ate: "2026-11-24",
    });
    expect(periodoDaUrl(sp("p=7"), agora, "UTC").ate).toBe("2026-11-25");
  });

  it("sem nada é 30 dias; personalizado válido é respeitado; torto volta para 30", () => {
    expect(periodoDaUrl(sp(""), agora, "America/Sao_Paulo")).toEqual({
      preset: "30",
      de: "2026-10-26",
      ate: "2026-11-24",
    });
    expect(periodoDaUrl(sp("p=personalizado&de=2026-09-01&ate=2026-09-30"), agora, "UTC")).toEqual({
      preset: "personalizado",
      de: "2026-09-01",
      ate: "2026-09-30",
    });
    expect(periodoDaUrl(sp("p=personalizado&de=2026-09-30&ate=2026-09-01"), agora, "UTC").preset).toBe("30");
    expect(periodoDaUrl(sp("p=personalizado&de=2024-01-01&ate=2026-09-01"), agora, "UTC").preset).toBe("30");
    expect(periodoDaUrl(sp("p=personalizado&de=ontem&ate=hoje"), agora, "UTC").preset).toBe("30");
  });

  it("os instantes começam e terminam na meia-noite do fuso", () => {
    expect(instantesDoPeriodo({ de: "2026-11-01", ate: "2026-11-01" }, "America/Sao_Paulo")).toEqual({
      from: "2026-11-01T03:00:00.000Z",
      to: "2026-11-02T03:00:00.000Z",
    });
    expect(deslocarDia("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("3.6 — formatos", () => {
  it("a duração sobe de unidade e null é traço", () => {
    expect(formatarTempo(null)).toBe("—");
    expect(formatarTempo(45)).toBe("45 s");
    expect(formatarTempo(600)).toBe("10 min");
    expect(formatarTempo(3600 * 3 + 20 * 60)).toBe("3 h 20 min");
    expect(formatarTempo(86400 + 4 * 3600)).toBe("1 d 4 h");
  });

  it("o dia curto segue o idioma de quem lê", () => {
    expect(diaCurto("2026-11-03", "pt-BR")).toBe("03/11");
    expect(diaCurto("2026-11-03", "en-US")).toBe("11/03");
  });

  it("CSV com ; e BOM, aspas quando precisa, e fórmula neutralizada", () => {
    const csv = montarCsv(["Nome", "Total"], [["Ana; Bia", 3], ["=HYPERLINK(1)", null], ['Diz "oi"', 1]]);
    expect(csv.startsWith("﻿")).toBe(true);
    const linhas = csv.slice(1).trimEnd().split("\r\n");
    expect(linhas).toEqual(["Nome;Total", '"Ana; Bia";3', "'=HYPERLINK(1);", '"Diz ""oi""";1']);
  });
});

describe("3.6 — origens por linha", () => {
  it("vira a matriz origem × status em uma linha por origem, sem somar moedas", () => {
    const linhas = origensPorLinha([
      { origem: "instagram", status: "won", quantidade: 2, por_moeda: [{ moeda: "BRL", quantidade: 2, valor_cents: 5000 }, { moeda: "USD", quantidade: 0, valor_cents: 100 }] },
      { origem: "instagram", status: "lost", quantidade: 1, por_moeda: [] },
      { origem: "site", status: "open", quantidade: 5, por_moeda: [] },
    ]);
    expect(linhas[0]).toMatchObject({ origem: "site", abertos: 5, total: 5 });
    expect(linhas[1]).toMatchObject({ origem: "instagram", ganhos: 2, perdidos: 1, total: 3 });
    expect(linhas[1]?.ganhoPorMoeda).toEqual([
      { moeda: "BRL", valor_cents: 5000 },
      { moeda: "USD", valor_cents: 100 },
    ]);
  });
});
