import { describe, expect, it } from "vitest";

import { INTERFACE_COMPLETA, PORTAS_ESSENCIAIS, destinosDaInterface } from "./interface";
import {
  aplicarPerfilDeTela,
  criarPerfilSchema,
  destinosDoEmbed,
  destinosDoPerfil,
} from "./perfis-de-tela";

const hrefs = (s: Parameters<typeof destinosDaInterface>[0], role: "agent" | "admin" | "manager") =>
  destinosDaInterface(s, false, role).map((d) => d.href);

describe("aplicarPerfilDeTela — o perfil só estreita", () => {
  it("sem perfil: a interface de sempre, intocada", () => {
    expect(aplicarPerfilDeTela(INTERFACE_COMPLETA, null, "agent")).toBe(INTERFACE_COMPLETA);
  });

  it("com perfil: o menu mostra só as áreas do perfil, mais as essenciais", () => {
    const s = aplicarPerfilDeTela(INTERFACE_COMPLETA, ["/app/inbox", "/app/kanban"], "agent");
    const visiveis = hrefs(s, "agent");
    expect(visiveis).toContain("/app/inbox");
    expect(visiveis).toContain("/app/kanban");
    expect(visiveis).not.toContain("/app/contacts");
    expect(visiveis).toContain("/app/settings/profile");
  });

  it("nunca concede: área que o papel não alcança continua fora", () => {
    const s = aplicarPerfilDeTela(INTERFACE_COMPLETA, ["/app/inbox", "/app/audit"], "agent");
    expect(hrefs(s, "agent")).not.toContain("/app/audit");
  });

  it("nunca abre o que a empresa escondeu: é interseção", () => {
    const daEmpresa = { preset: "completa" as const, destinos: ["/app/inbox" as const] };
    const s = aplicarPerfilDeTela(daEmpresa, ["/app/inbox", "/app/kanban"], "agent");
    expect(hrefs(s, "agent")).not.toContain("/app/kanban");
    expect(hrefs(s, "agent")).toContain("/app/inbox");
  });

  it("admin não recebe perfil (não se tranca fora da tela que desfaz o perfil)", () => {
    expect(aplicarPerfilDeTela(INTERFACE_COMPLETA, ["/app/inbox"], "admin")).toBe(INTERFACE_COMPLETA);
  });

  it("perfil cujas áreas sumiram do catálogo: só as essenciais, nunca a interface completa", () => {
    const s = aplicarPerfilDeTela(INTERFACE_COMPLETA, ["/app/porta-que-nao-existe"], "agent");
    const visiveis = hrefs(s, "agent");
    expect(visiveis).not.toContain("/app/inbox");
    for (const h of visiveis) expect(PORTAS_ESSENCIAIS as readonly string[]).toContain(h);
  });

  it("a trava de assumir e a tela inicial da empresa atravessam o perfil", () => {
    const s = aplicarPerfilDeTela(
      { preset: "completa", bloquearAteAssumir: true, inicio: "/app/kanban" },
      ["/app/kanban"],
      "agent",
    );
    expect(s.bloquearAteAssumir).toBe(true);
    expect(s.inicio).toBe("/app/kanban");
  });
});

describe("leitura e validação", () => {
  it("o banco pode ter href velho: a leitura descarta o que o catálogo não conhece", () => {
    expect(destinosDoPerfil(["/app/inbox", "/app/sumiu"])).toEqual(["/app/inbox"]);
    expect(destinosDoPerfil("lixo")).toBeNull();
    expect(destinosDoEmbed([{ destinos: ["/app/kanban"] }])).toEqual(["/app/kanban"]);
    expect(destinosDoEmbed(null)).toBeNull();
  });

  it("a rota recusa área fora do catálogo e lista vazia", () => {
    expect(criarPerfilSchema.safeParse({ nome: "Vendas", destinos: ["/app/inventada"] }).success).toBe(false);
    expect(criarPerfilSchema.safeParse({ nome: "Vendas", destinos: [] }).success).toBe(false);
    expect(criarPerfilSchema.safeParse({ nome: "Vendas", destinos: ["/app/inbox"], organization_id: "x" }).success).toBe(false);
    expect(criarPerfilSchema.parse({ nome: " Vendas ", destinos: ["/app/kanban", "/app/inbox", "/app/inbox"] })).toEqual({
      nome: "Vendas",
      destinos: ["/app/inbox", "/app/kanban"],
    });
  });
});
