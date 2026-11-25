/**
 * LOJAS E FILIAIS — sem o módulo, nada aparece e nada quebra (item 5.4).
 *
 * As duas chaves somam: módulo de TABELA instalado (`modulos_instalados`) E a
 * empresa ligada (`settings.lojas.enabled === true`). Faltando uma, a
 * capacidade não liga, a porta do menu não aparece, as telas recebem zero lojas
 * e o filtro da URL é recusado.
 */
import { describe, expect, it, vi } from "vitest";

import { lerLojaDoFiltro } from "@/lib/lojas/filtro";
import { MODULOS_OPCIONAIS, type ModuloOpcional } from "@/lib/instalacao/modulos";
import { CATALOGO_DE_MODULOS } from "@/lib/modulos/catalogo";
import { hubSections, searchable } from "@/lib/navigation/registry";
import { capacidadesLigadas } from "@/lib/organizacao/capacidades";
import { RECURSOS_OPCIONAIS } from "@/lib/recursos-opcionais/catalogo";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { lojasDaTela } from "./leitura";
import { lojasHabilitadas, lojasLigadas } from "./modulo";
import { registrarLojaDaPropostaNaCriacao } from "./proposta";
import { ordenarLojas } from "./schemas";

/** Um cliente de serviço de mentira: cada tabela devolve o que o teste mandar. */
function banco(tabelas: Record<string, unknown[]>, falhar: readonly string[] = []) {
  const chamadas: Array<{ tabela: string; op: string; valor?: unknown }> = [];
  const db = {
    chamadas,
    from(tabela: string) {
      const linhas = tabelas[tabela] ?? [];
      const resposta = falhar.includes(tabela)
        ? { data: null, error: { code: "42P01", message: "relation does not exist" } }
        : { data: linhas, error: null };
      const cadeia: Record<string, unknown> = {};
      const devolve = () => cadeia;
      for (const m of ["select", "eq", "in", "is", "order", "limit", "or"]) cadeia[m] = devolve;
      cadeia.maybeSingle = async () =>
        falhar.includes(tabela) ? resposta : { data: (linhas[0] as unknown) ?? null, error: null };
      cadeia.upsert = async (valor: unknown) => {
        chamadas.push({ tabela, op: "upsert", valor });
        return { error: null };
      };
      cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
      return cadeia;
    },
  };
  return db;
}

const INSTALADO = { modulos_instalados: [{ modulo: "lojas", estado: "ativo" }] };

describe("as duas chaves", () => {
  it("só o booleano true da empresa liga", () => {
    expect(lojasHabilitadas({ lojas: { enabled: true } })).toBe(true);
    for (const s of [{ lojas: { enabled: "true" } }, { lojas: true }, { lojas: {} }, {}, null, undefined, []]) {
      expect(lojasHabilitadas(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("a capacidade `lojas` exige o módulo instalado E a empresa ligada", () => {
    expect(capacidadesLigadas({ lojas: { enabled: true } }, ["lojas"])).toContain("lojas");
    expect(capacidadesLigadas({ lojas: { enabled: true } }, [])).not.toContain("lojas");
    expect(capacidadesLigadas({ lojas: { enabled: false } }, ["lojas"])).not.toContain("lojas");
    expect(capacidadesLigadas({}, ["lojas"])).not.toContain("lojas");
  });

  it("lojasLigadas: sem o módulo instalado é false mesmo com a empresa ligada", async () => {
    const semModulo = banco({ modulos_instalados: [], organizations: [{ settings: { lojas: { enabled: true } } }] });
    expect(await lojasLigadas(semModulo as never, "org-a")).toBe(false);
    const ligado = banco({ ...INSTALADO, organizations: [{ settings: { lojas: { enabled: true } } }] });
    expect(await lojasLigadas(ligado as never, "org-a")).toBe(true);
    const empresaDesligada = banco({ ...INSTALADO, organizations: [{ settings: {} }] });
    expect(await lojasLigadas(empresaDesligada as never, "org-a")).toBe(false);
  });

  it("banco que falha = desligado, sem lançar", async () => {
    const quebrado = banco({}, ["modulos_instalados", "organizations", "platform_config", "organization_modules"]);
    expect(await lojasLigadas(quebrado as never, "org-a")).toBe(false);
  });
});

describe("sem o módulo, nada aparece", () => {
  const hrefs = (modulos: readonly ModuloOpcional[]) =>
    hubSections("organizacao", false, "admin", undefined, modulos).flatMap((s) => s.items.map((i) => i.href));
  const busca = (modulos: readonly ModuloOpcional[]) => searchable(false, "admin", undefined, modulos).map((d) => d.href);

  it("a porta de Configurações › Lojas só existe com o módulo instalado", () => {
    expect(hrefs([])).not.toContain("/app/settings/lojas");
    expect(busca([])).not.toContain("/app/settings/lojas");
    expect(hrefs(["lojas"])).toContain("/app/settings/lojas");
  });

  it("as telas recebem zero lojas sem o módulo (filtro, seletor e estoque não são desenhados)", async () => {
    const semModulo = banco({ modulos_instalados: [], organizations: [{ settings: { lojas: { enabled: true } } }], lojas: [{ id: "l1", nome: "Centro", ativa: true, padrao: true }] });
    expect(await lojasDaTela(semModulo as never, "org-a")).toEqual([]);
    const ligado = banco({ ...INSTALADO, organizations: [{ settings: { lojas: { enabled: true } } }], lojas: [{ id: "l1", nome: "Centro", ativa: true, padrao: true }] });
    expect(await lojasDaTela(ligado as never, "org-a")).toEqual([{ id: "l1", nome: "Centro", ativa: true, padrao: true }]);
  });

  it("a tabela que ainda não existe (módulo nunca instalado) não derruba a tela", async () => {
    const semTabela = banco({ ...INSTALADO, organizations: [{ settings: { lojas: { enabled: true } } }] }, ["lojas"]);
    expect(await lojasDaTela(semTabela as never, "org-a")).toEqual([]);
  });

  it("criar proposta sem o módulo não grava loja nenhuma", async () => {
    const semModulo = banco({ modulos_instalados: [], organizations: [{ settings: { lojas: { enabled: true } } }] });
    expect(await registrarLojaDaPropostaNaCriacao(semModulo as never, "org-a", "p1", null)).toBeNull();
    expect(semModulo.chamadas).toEqual([]);
  });

  it("criar proposta com o módulo registra a loja padrão quando não há conversa", async () => {
    const ligado = banco({
      ...INSTALADO,
      organizations: [{ settings: { lojas: { enabled: true } } }],
      lojas: [{ id: "loja-padrao" }],
    });
    expect(await registrarLojaDaPropostaNaCriacao(ligado as never, "org-a", "p1", null)).toBe("loja-padrao");
    expect(ligado.chamadas).toEqual([
      { tabela: "proposta_da_loja", op: "upsert", valor: { organization_id: "org-a", proposal_id: "p1", loja_id: "loja-padrao" } },
    ]);
  });

  it("o filtro da URL: vazio é sem filtro, lixo é recusado", () => {
    expect(lerLojaDoFiltro(new URLSearchParams(""))).toBeNull();
    expect(lerLojaDoFiltro(new URLSearchParams("loja="))).toBeNull();
    expect(lerLojaDoFiltro(new URLSearchParams("loja=centro"))).toBe("invalida");
    const id = "3f1c1a52-6a3b-4d55-9a0e-2f1f0d0c9b11";
    expect(lerLojaDoFiltro(new URLSearchParams(`loja=${id}`))).toBe(id);
  });
});

describe("o registro do módulo", () => {
  it("é módulo de TABELA instalável em /admin/modulos, com linha em Recursos opcionais", () => {
    expect(MODULOS_OPCIONAIS).toContain("lojas");
    expect(CATALOGO_DE_MODULOS.some((m) => m.slug === "lojas")).toBe(true);
    expect(RECURSOS_OPCIONAIS.find((r) => r.id === "modulo:lojas")?.href).toBe("/admin/modulos");
    expect(RECURSOS_OPCIONAIS.find((r) => r.id === "lojas_da_empresa")).toMatchObject({
      capacidade: "lojas",
      href: "/app/settings/lojas",
    });
  });

  it("ordena a padrão primeiro, depois as ativas, por nome", () => {
    const l = (nome: string, ativa: boolean, padrao = false) => ({ nome, ativa, padrao });
    expect(ordenarLojas([l("Zona", true), l("Antiga", false), l("Centro", true, true), l("Bairro", true)]).map((x) => x.nome)).toEqual([
      "Centro",
      "Bairro",
      "Zona",
      "Antiga",
    ]);
  });
});
