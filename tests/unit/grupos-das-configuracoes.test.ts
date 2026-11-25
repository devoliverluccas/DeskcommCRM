import { describe, expect, it } from "vitest";

import { NAV_DESTINATIONS } from "@/lib/navigation/registry";
import {
  GRUPOS_DAS_CONFIGURACOES,
  GRUPO_POR_HREF,
  GRUPO_POR_SECAO,
  ehPortaDasConfiguracoes,
  filtrarMenu,
  grupoDaConfiguracao,
  menuDasConfiguracoes,
  portaAtiva,
  primeiroResultado,
} from "@/lib/navigation/grupos-das-configuracoes";

/**
 * O MENU DE CONFIGURAÇÕES NÃO PERDE PORTA.
 *
 * O menu agrupa por assunto (cinco grupos) o que o catálogo agrupa por jornada.
 * O defeito que esta cerca existe para pegar: tela nova no catálogo com uma
 * seção que o mapeamento não conhece — ela sumiria do menu de Configurações
 * sem nenhum erro, e o índice era a única porta de várias delas.
 */

const PORTAS = NAV_DESTINATIONS.filter(ehPortaDasConfiguracoes);
const hrefs = (g: ReturnType<typeof menuDasConfiguracoes>) => g.flatMap((x) => x.itens.map((d) => d.href));

describe("grupos das Configurações", () => {
  it("controle positivo: a varredura acha as portas de Configurações", () => {
    expect(PORTAS.length).toBeGreaterThan(20);
    expect(PORTAS.map((d) => d.href)).toContain("/app/settings/tags");
    expect(PORTAS.map((d) => d.href)).toContain("/app/team");
  });

  it("toda seção de porta de Configurações tem grupo", () => {
    const semGrupo = [
      ...new Set(
        PORTAS.filter((d) => !GRUPO_POR_HREF[d.href] && d.group !== "canais")
          .map((d) => d.section ?? "(sem seção)")
          .filter((s) => !(s in GRUPO_POR_SECAO)),
      ),
    ];
    expect(
      semGrupo,
      `Seção sem grupo no menu de Configurações. Declare em GRUPO_POR_SECAO ` +
        `(lib/navigation/grupos-das-configuracoes.ts):\n  ${semGrupo.join("\n  ")}`,
    ).toEqual([]);
  });

  it("toda porta cai num dos cinco grupos", () => {
    const ids = new Set(GRUPOS_DAS_CONFIGURACOES.map((g) => g.id));
    const orfas = PORTAS.filter((d) => {
      const g = grupoDaConfiguracao(d);
      return !g || !ids.has(g);
    }).map((d) => d.href);
    expect(orfas).toEqual([]);
  });

  it("o refinamento por href só aponta para porta que existe", () => {
    const existentes = new Set(PORTAS.map((d) => d.href));
    const mortos = Object.keys(GRUPO_POR_HREF).filter((h) => !existentes.has(h));
    expect(mortos).toEqual([]);
  });

  it("são exatamente os cinco grupos, na ordem do menu", () => {
    expect(GRUPOS_DAS_CONFIGURACOES.map((g) => g.label)).toEqual([
      "Sua conta",
      "Atendimento",
      "Canais",
      "Empresa",
      "Equipe e segurança",
    ]);
  });

  it("o admin vê todas as portas visíveis no ⌘K, sem repetir nenhuma", () => {
    const menu = menuDasConfiguracoes({ isPlatformAdmin: false, role: "admin", modulos: [] });
    const lista = hrefs(menu);
    expect(new Set(lista).size).toBe(lista.length);
    expect(lista).toContain("/app/settings/tags");
    expect(lista).toContain("/app/settings/marca");
    expect(lista).toContain("/app/team");
    expect(menu.every((g) => g.itens.length > 0)).toBe(true);
  });

  it("respeita o papel: viewer não vê porta de manager nem de admin", () => {
    const lista = hrefs(menuDasConfiguracoes({ isPlatformAdmin: false, role: "viewer", modulos: [] }));
    expect(lista).toContain("/app/settings/profile");
    expect(lista).not.toContain("/app/settings/tags");
    expect(lista).not.toContain("/app/settings/marca");
    const manager = hrefs(menuDasConfiguracoes({ isPlatformAdmin: false, role: "manager", modulos: [] }));
    expect(manager).toContain("/app/settings/tags");
    expect(manager).not.toContain("/app/settings/marca");
  });

  it("respeita os módulos: porta de módulo desligado não aparece", () => {
    const sem = hrefs(menuDasConfiguracoes({ isPlatformAdmin: false, role: "admin", modulos: [] }));
    expect(sem).not.toContain("/app/settings/cadencias");
    const com = hrefs(menuDasConfiguracoes({ isPlatformAdmin: false, role: "admin", modulos: ["cadencias"] }));
    expect(com).toContain("/app/settings/cadencias");
  });

  it("Organizações clientes só para a agência", () => {
    const base = { isPlatformAdmin: false, role: "admin" as const, modulos: [] };
    expect(hrefs(menuDasConfiguracoes(base))).not.toContain("/app/settings/organizacoes");
    expect(hrefs(menuDasConfiguracoes({ ...base, agencia: true }))).toContain("/app/settings/organizacoes");
  });

  it("a porta ativa é o prefixo mais longo", () => {
    const itens = PORTAS;
    expect(portaAtiva("/app/settings/tenant/agenda", itens)).toBe("/app/settings/tenant/agenda");
    expect(portaAtiva("/app/settings/tenant", itens)).toBe("/app/settings/tenant");
    expect(portaAtiva("/app/settings/tenant/proposals/modelos/abc", itens)).toBe(
      "/app/settings/tenant/proposals/modelos",
    );
    // Prefixo de TEXTO não é prefixo de caminho.
    expect(portaAtiva("/app/settings/tagsx", itens)).toBeNull();
    expect(portaAtiva("/app/settings", itens)).toBeNull();
  });

  it("a busca ignora acento e caixa, e o nome do grupo traz o grupo inteiro", () => {
    const menu = menuDasConfiguracoes({ isPlatformAdmin: false, role: "admin", modulos: [] });
    const id = (s: string) => s;
    expect(hrefs(filtrarMenu(menu, "SEGURANCA", id))).toContain("/app/settings/security");
    const canais = filtrarMenu(menu, "canais", id);
    expect(canais.map((g) => g.grupo.id)).toEqual(["canais"]);
    expect(filtrarMenu(menu, "zzzz-nada", id)).toEqual([]);
    expect(filtrarMenu(menu, "   ", id)).toHaveLength(menu.length);
  });

  it("o Enter da busca prefere o rótulo à descrição", () => {
    const menu = menuDasConfiguracoes({ isPlatformAdmin: false, role: "admin", modulos: [] });
    const id = (s: string) => s;
    expect(primeiroResultado(menu, "marca", id)?.href).toBe("/app/settings/marca");
    expect(primeiroResultado(menu, "", id)).toBeUndefined();
  });
});
