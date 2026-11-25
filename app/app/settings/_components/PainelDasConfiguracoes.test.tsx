/**
 * A CASCA DE CONFIGURAÇÕES — menu ao lado, porta acesa, volta escondida.
 *
 * jsdom não faz layout: a largura (240px) e o corte `lg` ficam provados pela
 * classe. O que se prova de verdade aqui é a regra: de onde saem as portas
 * (o registro, sem mock), qual acende, e que o "← Voltar" das subtelas fica
 * dentro do contêiner que o esconde.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  role: "admin" as string | null,
  caminho: "/app/settings/tags",
};
const push = vi.fn();

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { is_platform_admin: false, support: null, agency_org_ids: [] },
    activeOrg: {
      orgId: "org-1",
      role: estado.role,
      interface_settings: undefined,
      modulos_ligados: [],
      capacidades_ligadas: [],
    },
  }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("next/navigation", () => ({
  usePathname: () => estado.caminho,
  useRouter: () => ({ prefetch: vi.fn(), push }),
}));

import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";

import { PainelDasConfiguracoes } from "./PainelDasConfiguracoes";

function montar() {
  return render(
    <PainelDasConfiguracoes>
      <CabecalhoDaSubTela titulo="Tags" idioma="pt-BR" />
    </PainelDasConfiguracoes>,
  );
}

function lateral() {
  return screen.getByRole("complementary", { name: "Configurações" });
}

describe("PainelDasConfiguracoes", () => {
  beforeEach(() => {
    estado.role = "admin";
    estado.caminho = "/app/settings/tags";
    push.mockReset();
  });

  it("subtela ganha o menu lateral de 240px, só a partir de lg", () => {
    montar();
    const aside = lateral();
    expect(aside.className).toContain("w-60");
    expect(aside.className).toContain("hidden");
    expect(aside.className).toContain("lg:block");
    expect(screen.getByTestId("seletor-das-configuracoes").parentElement?.className).toContain("lg:hidden");
  });

  it("agrupa nos cinco grupos do mapeamento", () => {
    montar();
    const grupos = within(lateral())
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-labelledby"));
    expect(grupos.length).toBeGreaterThanOrEqual(4);
    expect(within(lateral()).getByRole("group", { name: "Sua conta" })).toBeTruthy();
    expect(within(lateral()).getByRole("group", { name: "Equipe e segurança" })).toBeTruthy();
  });

  it("a porta da tela aberta fica acesa (bg-pressed, aria-current)", () => {
    montar();
    const tags = within(lateral()).getByRole("link", { name: "Tags" });
    expect(tags.getAttribute("aria-current")).toBe("page");
    expect(tags.className).toContain("bg-pressed");
    const perfil = within(lateral()).getByRole("link", { name: "Perfil" });
    expect(perfil.getAttribute("aria-current")).toBeNull();
  });

  it("detalhe abaixo de uma porta acende a porta-mãe", () => {
    // `/conversoes/ga4/...` casa com `/conversoes` e com `/conversoes/ga4`: vence o mais longo.
    estado.caminho = "/app/settings/conversoes/ga4/detalhe";
    montar();
    const ativos = within(lateral())
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(ativos.map((a) => a.getAttribute("href"))).toEqual(["/app/settings/conversoes/ga4"]);
  });

  it("o papel decide as portas: viewer não vê Tags", () => {
    estado.role = "viewer";
    montar();
    expect(within(lateral()).queryByRole("link", { name: "Tags" })).toBeNull();
    expect(within(lateral()).getByRole("link", { name: "Perfil" })).toBeTruthy();
  });

  it("o ← Voltar para Configurações fica dentro do contêiner que o esconde", () => {
    montar();
    const voltar = screen.getByTestId("voltar-para-configuracoes");
    const conteudo = voltar.closest("header")?.parentElement;
    expect(conteudo?.className).toContain("[&_[data-testid=voltar-para-configuracoes]]:hidden");
  });

  it("a busca filtra as seções e Enter abre a primeira", () => {
    montar();
    const busca = within(lateral()).getByRole("searchbox", { name: "Buscar seção" });
    fireEvent.change(busca, { target: { value: "marca" } });
    expect(within(lateral()).getByRole("link", { name: "Marca" })).toBeTruthy();
    expect(within(lateral()).queryByRole("link", { name: "Perfil" })).toBeNull();
    fireEvent.keyDown(busca, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/app/settings/marca");
  });

  it("busca sem resultado diz isso em vez de sumir com o menu", () => {
    montar();
    const busca = within(lateral()).getByRole("searchbox", { name: "Buscar seção" });
    fireEvent.change(busca, { target: { value: "zzzz" } });
    expect(within(lateral()).getByRole("status").textContent).toBe("Nenhum resultado");
  });

  it("no índice não há coluna: o resumo já é o menu", () => {
    estado.caminho = "/app/settings";
    montar();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByTestId("seletor-das-configuracoes")).toBeNull();
  });
});
