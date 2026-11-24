import { beforeEach, describe, expect, it, vi } from "vitest";

import { preverAudiencia } from "./preparacao";
import {
  categoriaDoModelo,
  estimarDuracao,
  janelaEfetiva,
  limiteDoNumeroHoje,
  resumirEnvio,
  resumoDoEnvioSchema,
} from "./resumo-do-envio";

vi.mock("./preparacao", () => ({ preverAudiencia: vi.fn() }));

/**
 * O RESUMO ANTES DE ENVIAR (fase 4, 4.7). Prende: a contagem vem de
 * `preverAudiencia` (a MESMA régua da preparação), o limite do dia é o do motor
 * de pacing (aquecimento contra o teto do CRM), a janela é a do número cortada
 * pela da campanha, e a duração respeita ritmo, tetos e janela.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const NUMERO = "55555555-5555-4555-8555-555555555555";
const AGORA = new Date("2026-11-24T15:00:00Z");

describe("categoriaDoModelo", () => {
  it("normaliza a categoria da plataforma", () => {
    expect(categoriaDoModelo("MARKETING")).toBe("marketing");
    expect(categoriaDoModelo("utility")).toBe("utilidade");
    expect(categoriaDoModelo("AUTHENTICATION")).toBe("autenticacao");
    expect(categoriaDoModelo(null)).toBeNull();
  });
});

describe("janelaEfetiva", () => {
  it("sem janela da campanha, vale a do número", () => {
    expect(janelaEfetiva({ inicio: 7, fim: 22 }, { inicio: null, fim: null })).toEqual({ inicio: 7, fim: 22, horas: 15 });
  });
  it("a da campanha só estreita", () => {
    expect(janelaEfetiva({ inicio: 7, fim: 22 }, { inicio: 5, fim: 12 })).toEqual({ inicio: 7, fim: 12, horas: 5 });
  });
  it("janelas que não se cruzam: zero horas", () => {
    expect(janelaEfetiva({ inicio: 7, fim: 10 }, { inicio: 12, fim: 18 }).horas).toBe(0);
  });
});

describe("limiteDoNumeroHoje — a conta de decidePacing", () => {
  it("número sem knobs é idade 0: o degrau mais conservador do aquecimento (20)", () => {
    expect(limiteDoNumeroHoje(null, null, AGORA, null)).toMatchObject({ limite: 20, origem: "aquecimento", idade: 0 });
  });
  it("teto do CRM menor que o aquecimento decide", () => {
    expect(limiteDoNumeroHoje(null, 10, AGORA, null)).toMatchObject({ limite: 10, origem: "teto_do_numero" });
  });
  it("número aquecido e sem teto: sem limite", () => {
    const aquecido = { number_activated_at: "2026-01-01T00:00:00Z" } as never;
    expect(limiteDoNumeroHoje(aquecido, null, AGORA, null)).toMatchObject({ limite: null, origem: null });
  });
});

describe("estimarDuracao", () => {
  const base = {
    numeros: 1,
    intervaloSegundos: null,
    tetoDiario: null,
    tetoHorario: null,
    limiteDoNumero: null,
    horasDeJanela: 15,
  };

  it("gradual: uma por minuto por número", () => {
    expect(estimarDuracao({ ...base, pessoas: 90, velocidade: "gradual" })).toEqual({ porDia: 900, minutos: 90, dias: 1 });
    expect(estimarDuracao({ ...base, pessoas: 90, velocidade: "gradual", numeros: 3 }).minutos).toBe(30);
  });

  it("o limite do número leva a lista para vários dias", () => {
    expect(estimarDuracao({ ...base, pessoas: 100, velocidade: "gradual", limiteDoNumero: 20 })).toEqual({
      porDia: 20,
      minutos: null,
      dias: 5,
    });
  });

  it("intervalo e teto da campanha só deixam mais devagar", () => {
    const r = estimarDuracao({ ...base, pessoas: 30, velocidade: "gradual", intervaloSegundos: 120 });
    expect(r.minutos).toBe(60);
    expect(estimarDuracao({ ...base, pessoas: 30, velocidade: "gradual", tetoDiario: 10 }).dias).toBe(3);
  });

  it("sem janela, nada sai", () => {
    expect(estimarDuracao({ ...base, pessoas: 10, velocidade: "gradual", horasDeJanela: 0 })).toEqual({
      porDia: 0,
      minutos: null,
      dias: null,
    });
  });

  it("rápida: muitas por minuto; transmissão: cerca de um minuto", () => {
    expect(estimarDuracao({ ...base, pessoas: 500, velocidade: "rapida" }).minutos).toBeLessThanOrEqual(3);
    expect(estimarDuracao({ ...base, pessoas: 500, velocidade: "transmissao" })).toEqual({ porDia: null, minutos: 1, dias: 1 });
  });
});

/** Admin falso: responde por tabela e registra os filtros. */
function adminFalso(respostas: Record<string, unknown>) {
  const filtros: Record<string, Array<[string, unknown]>> = {};
  return {
    filtros,
    admin: {
      from(tabela: string) {
        filtros[tabela] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
          select: () => q,
          eq: (c: string, v: unknown) => {
            filtros[tabela]!.push([c, v]);
            return q;
          },
          maybeSingle: async () => ({ data: respostas[tabela] ?? null, error: null }),
        };
        return q;
      },
    },
  };
}

const AUDIENCIA = { total: 12, elegiveis: 10, excluidos: 2, motivos: { opt_out: 1, sem_telefone: 1 }, truncado: false, amostra: [] };

describe("resumirEnvio", () => {
  beforeEach(() => {
    vi.mocked(preverAudiencia).mockReset();
    vi.mocked(preverAudiencia).mockResolvedValue(AUDIENCIA);
  });

  const pedido = resumoDoEnvioSchema.parse({
    audience_filter: { com_alguma_tag: ["vip"], limite: 100 },
    message_body: "Oi {{nome}}",
    channel_session_id: NUMERO,
  });

  it("conta pela MESMA função da preparação e lê o número só desta organização", async () => {
    const { admin, filtros } = adminFalso({
      channel_sessions: { daily_message_limit: 50 },
      channel_knobs: null,
      organizations: { timezone: "America/Sao_Paulo" },
    });
    const r = await resumirEnvio(admin as never, { organizationId: ORG, pedido, agora: AGORA });

    expect(preverAudiencia).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ organizationId: ORG, filtro: pedido.audience_filter, corpo: "Oi {{nome}}" }),
    );
    expect(filtros.channel_sessions).toEqual([["organization_id", ORG], ["id", NUMERO]]);
    expect(filtros.channel_knobs).toContainEqual(["organization_id", ORG]);
    expect(r.audiencia.elegiveis).toBe(10);
    expect(r.audiencia.legenda.opt_out).toBeTruthy();
    expect(r.custo).toBeNull();
    expect(r.modelo).toBeNull();
    expect(r.numero).toMatchObject({ limiteDoDia: 20, origemDoLimite: "aquecimento", janela: { inicio: 7, fim: 22 } });
    expect(r.velocidade).toBe("gradual");
    expect(r.duracao).toEqual({ porDia: 20, minutos: 10, dias: 1 });
  });

  it("número de outra organização: erro, nada de resumo pela metade", async () => {
    const { admin } = adminFalso({ channel_sessions: null });
    await expect(resumirEnvio(admin as never, { organizationId: ORG, pedido, agora: AGORA })).rejects.toThrow(
      "O número escolhido não é desta organização.",
    );
  });

  it("com modelo, a categoria vem da definição; sem modelo, a velocidade é sempre gradual", async () => {
    const { admin } = adminFalso({ channel_sessions: { daily_message_limit: null } });
    const rapidaSemModelo = await resumirEnvio(admin as never, {
      organizationId: ORG,
      pedido: { ...pedido, velocidade: "rapida" },
      agora: AGORA,
    });
    expect(rapidaSemModelo.velocidade).toBe("gradual");

    const comModelo = await resumirEnvio(admin as never, {
      organizationId: ORG,
      pedido: { ...pedido, velocidade: "rapida" },
      modelo: { definicao: { name: "promo", category: "MARKETING" }, contrato: {}, variaveis: {} } as never,
      agora: AGORA,
    });
    expect(comModelo.modelo).toEqual({ nome: "promo", categoria: "marketing" });
    expect(comModelo.velocidade).toBe("rapida");
  });

  it("e-mail não tem número: sem limite, janela nem duração", async () => {
    const { admin } = adminFalso({});
    const r = await resumirEnvio(admin as never, {
      organizationId: ORG,
      pedido: { ...pedido, canal: "email", channel_session_id: undefined },
      agora: AGORA,
    });
    expect(r.numero).toBeNull();
    expect(r.duracao).toBeNull();
    expect(preverAudiencia).toHaveBeenCalledWith(admin, expect.objectContaining({ canal: "email" }));
  });
});
