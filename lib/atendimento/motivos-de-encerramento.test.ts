import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  CATEGORIAS_DE_MOTIVO,
  SUGESTOES_DE_MOTIVO,
  criarMotivoSchema,
  decidirMotivo,
  editarMotivoSchema,
  motivoObrigatorioAoEncerrar,
  settingsComExigencia,
  type MotivoDeEncerramento,
} from "./motivos-de-encerramento";
import { aplicarMotivoNaDemanda, protocoloDaDemanda } from "./motivos-de-encerramento-server";

const M1: MotivoDeEncerramento = { id: "m1", nome: "Spam", categoria: "nao_procede", ativo: true, ordem: 0 };

describe("motivoObrigatorioAoEncerrar — só true booleano liga", () => {
  it.each([
    [undefined, false],
    [null, false],
    [{}, false],
    [{ atendimento: null }, false],
    [{ atendimento: { motivo_obrigatorio_ao_encerrar: "true" } }, false],
    [{ atendimento: { motivo_obrigatorio_ao_encerrar: 1 } }, false],
    [{ atendimento: { motivo_obrigatorio_ao_encerrar: true } }, true],
  ])("%j → %s", (settings, esperado) => {
    expect(motivoObrigatorioAoEncerrar(settings)).toBe(esperado);
  });
});

describe("settingsComExigencia — merge que não apaga vizinhas", () => {
  it("preserva as outras chaves de settings e do bloco atendimento", () => {
    const antes = { satisfacao: { ligado: true }, atendimento: { outra: 1 } };
    expect(settingsComExigencia(antes, true)).toEqual({
      satisfacao: { ligado: true },
      atendimento: { outra: 1, motivo_obrigatorio_ao_encerrar: true },
    });
  });
  it("settings ausente vira bloco novo", () => {
    expect(settingsComExigencia(null, false)).toEqual({ atendimento: { motivo_obrigatorio_ao_encerrar: false } });
  });
});

describe("decidirMotivo — a regra do fechamento", () => {
  it("motivo ativo da lista: ok com ele", () => {
    expect(decidirMotivo({ motivoId: "m1", exigido: false, ativos: [M1] })).toEqual({ tipo: "ok", motivo: M1 });
  });
  it("motivo fora da lista ativa (outra org, inativo, inventado): inválido — mesmo sem exigência", () => {
    expect(decidirMotivo({ motivoId: "x", exigido: false, ativos: [M1] })).toEqual({ tipo: "motivo_invalido" });
  });
  it("exigido e ausente: motivo_required com a lista", () => {
    expect(decidirMotivo({ motivoId: undefined, exigido: true, ativos: [M1] })).toEqual({
      tipo: "motivo_required",
      motivos: [M1],
    });
  });
  it("exigido sem nenhum motivo ativo: não bloqueia", () => {
    expect(decidirMotivo({ motivoId: undefined, exigido: true, ativos: [] })).toEqual({ tipo: "ok", motivo: null });
  });
  it("sem exigência e sem motivo: nada a gravar", () => {
    expect(decidirMotivo({ motivoId: undefined, exigido: false, ativos: [M1] })).toEqual({ tipo: "ok", motivo: null });
  });
});

describe("o vocabulário da categoria é o de demandas.desfecho", () => {
  it("as categorias são exatamente os desfechos do CHECK da 0136 e da migration 9482", () => {
    const migration = readFileSync(
      "supabase/migrations/20261124130000_9482_protocolo_e_motivos_de_encerramento.sql",
      "utf8",
    );
    const check = /motivos_de_encerramento_categoria_check\s+check \(categoria in \(([^)]*)\)/.exec(migration);
    expect(check, "o CHECK da categoria sumiu da migration").not.toBeNull();
    const doBanco = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(doBanco).toEqual([...CATEGORIAS_DE_MOTIVO].sort());
  });
  it("toda sugestão tem categoria válida e nome único", () => {
    for (const s of SUGESTOES_DE_MOTIVO) expect(CATEGORIAS_DE_MOTIVO).toContain(s.categoria);
    expect(new Set(SUGESTOES_DE_MOTIVO.map((s) => s.nome.toLowerCase())).size).toBe(SUGESTOES_DE_MOTIVO.length);
    expect(SUGESTOES_DE_MOTIVO.map((s) => s.nome)).toEqual([
      "Resolvido",
      "Sem resposta do cliente",
      "Duplicado",
      "Spam",
      "Venda realizada",
    ]);
  });
});

describe("schemas de entrada", () => {
  it("criar recusa campo de fora (organization_id não vem do corpo)", () => {
    expect(criarMotivoSchema.safeParse({ nome: "X", categoria: "resolvida", organization_id: "o" }).success).toBe(false);
    expect(criarMotivoSchema.safeParse({ nome: "  ", categoria: "resolvida" }).success).toBe(false);
    expect(criarMotivoSchema.safeParse({ nome: "X", categoria: "ganhou" }).success).toBe(false);
    expect(criarMotivoSchema.safeParse({ nome: " X ", categoria: "resolvida" }).data?.nome).toBe("X");
  });
  it("editar exige ao menos um campo", () => {
    expect(editarMotivoSchema.safeParse({}).success).toBe(false);
    expect(editarMotivoSchema.safeParse({ ativo: false }).success).toBe(true);
  });
});

describe("aplicarMotivoNaDemanda — a porta da fn_demanda_aplicar_motivo", () => {
  it("sem demanda vigente não chama o banco", async () => {
    const rpc = vi.fn();
    const r = await aplicarMotivoNaDemanda({ rpc } as never, {
      organizationId: "o", demandaId: null, motivoId: "m", actorUserId: "u",
    });
    expect(r).toEqual({ ok: false, erro: "sem_demanda" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passa a organização do contexto e traduz o 22023 em motivo_invalido", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "22023", message: "motivo_invalido" } }));
    const r = await aplicarMotivoNaDemanda({ rpc } as never, {
      organizationId: "o", demandaId: "d", motivoId: "m", actorUserId: "u",
    });
    expect(rpc).toHaveBeenCalledWith("fn_demanda_aplicar_motivo", {
      p_org: "o", p_demanda: "d", p_motivo: "m", p_actor: "u",
    });
    expect(r).toEqual({ ok: false, erro: "motivo_invalido" });
  });
  it("sucesso devolve desfecho e protocolo da demanda", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "d", desfecho: "nao_procede", protocolo: "20261124-000007" }, error: null }));
    const r = await aplicarMotivoNaDemanda({ rpc } as never, {
      organizationId: "o", demandaId: "d", motivoId: "m", actorUserId: "u",
    });
    expect(r).toEqual({ ok: true, demandaId: "d", desfecho: "nao_procede", protocolo: "20261124-000007" });
  });
});

describe("protocoloDaDemanda — nunca lança", () => {
  function db(resultado: unknown) {
    const eqs: Array<[string, unknown]> = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; },
      maybeSingle: async () => resultado,
    };
    return { cliente: { from: () => q } as never, eqs };
  }
  it("sem demanda: null sem consultar", async () => {
    expect(await protocoloDaDemanda({ from: () => { throw new Error("não"); } } as never, "o", null)).toBeNull();
  });
  it("filtra pela organização e devolve o texto", async () => {
    const { cliente, eqs } = db({ data: { protocolo: "20261124-000001" }, error: null });
    expect(await protocoloDaDemanda(cliente, "o", "d")).toBe("20261124-000001");
    expect(eqs).toContainEqual(["organization_id", "o"]);
  });
  it("erro de leitura: null", async () => {
    const { cliente } = db({ data: null, error: { message: "x" } });
    expect(await protocoloDaDemanda(cliente, "o", "d")).toBeNull();
  });
});
