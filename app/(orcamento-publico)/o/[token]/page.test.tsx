import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrcamentoPublico } from "@/lib/propostas/orcamento-publico";

const mocks = vi.hoisted(() => ({
  lerOrcamentoPublico: vi.fn(),
  registrarAcesso: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/propostas/orcamento-publico", () => ({
  lerOrcamentoPublico: mocks.lerOrcamentoPublico,
  registrarAcesso: mocks.registrarAcesso,
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/i18n/idiomaAnonimo", () => ({ idiomaDoVisitante: async () => "pt-BR" }));

import OrcamentoPublicoPage from "./page";

const TOKEN = "B".repeat(43);

function orcamento(over: Partial<OrcamentoPublico> = {}): OrcamentoPublico {
  return {
    linkId: "link-1",
    organizationId: "org-1",
    propostaId: "p1",
    estado: "aberta",
    titulo: "Orçamento de peças",
    numero: 12,
    ano: 2026,
    versao: 1,
    cliente: "Joana",
    empresa: { nome: "Oficina do Zé", logoUrl: null, corHex: null },
    itens: [{ descricao: "Pastilha de freio", quantidade: 2, precoUnitarioCents: 5000, descontoCents: 0, subtotalCents: 10000 }],
    subtotalCents: 10000,
    descontoCents: 1000,
    freteCents: 2500,
    totalCents: 11500,
    moeda: "BRL",
    validUntil: "2026-12-10",
    condicoes: "Pagamento na retirada",
    decididaEm: null,
    ...over,
  };
}

async function montar(o: OrcamentoPublico | null, busca: Record<string, string> = {}) {
  mocks.lerOrcamentoPublico.mockResolvedValue(o);
  const ui = await OrcamentoPublicoPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve(busca) });
  return render(ui);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, count: 1, limit: 30 });
  mocks.registrarAcesso.mockResolvedValue(undefined);
});

describe("/o/[token] — o orçamento que o cliente abre", () => {
  it("aberto: mostra empresa, cliente, itens, desconto, frete, total, validade — e os dois botões", async () => {
    await montar(orcamento());
    expect(screen.getByTestId("orcamento-empresa").textContent).toContain("Oficina do Zé");
    expect(screen.getByText("Orçamento de peças")).toBeTruthy();
    expect(screen.getByText(/Joana/)).toBeTruthy();
    expect(screen.getByText("Pastilha de freio")).toBeTruthy();
    const totais = screen.getByTestId("orcamento-totais").textContent ?? "";
    expect(totais).toContain("Desconto");
    expect(totais).toContain("Frete");
    expect(totais).toMatch(/115,00/);
    expect(screen.getByText(/Válido até/)).toBeTruthy();
    expect(screen.getByTestId("orcamento-aceitar")).toBeTruthy();
    expect(screen.getByTestId("orcamento-recusar")).toBeTruthy();
    expect(mocks.registrarAcesso).toHaveBeenCalledWith(expect.anything(), "org-1", "link-1");
  });

  it("sem desconto e sem frete, as linhas não aparecem", async () => {
    await montar(orcamento({ descontoCents: 0, freteCents: 0, totalCents: 10000 }));
    const totais = screen.getByTestId("orcamento-totais").textContent ?? "";
    expect(totais).not.toContain("Desconto");
    expect(totais).not.toContain("Frete");
  });

  it.each([
    ["aceita", "Este orçamento foi aceito."],
    ["recusada", "Este orçamento foi recusado."],
    ["vencida", "Este orçamento venceu."],
    ["revogada", "Este link não está mais disponível."],
    ["substituida", "Este orçamento foi substituído"],
    ["cancelada", "Este orçamento foi cancelado."],
  ] as const)("%s: mostra o estado, SEM botões", async (estado, texto) => {
    await montar(orcamento({ estado }));
    expect(screen.getByTestId("orcamento-estado").textContent).toContain(texto);
    expect(screen.queryByTestId("orcamento-aceitar")).toBeNull();
    expect(screen.queryByTestId("orcamento-recusar")).toBeNull();
  });

  it("token sem link: 'não encontrado', sem dizer por quê", async () => {
    await montar(null);
    expect(screen.getByText("Orçamento não encontrado")).toBeTruthy();
    expect(mocks.registrarAcesso).not.toHaveBeenCalled();
  });

  it("rate limit por IP: barra antes de ler o banco", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, count: 31, limit: 30 });
    await montar(orcamento());
    expect(screen.getByText("Muitas tentativas")).toBeTruthy();
    expect(mocks.lerOrcamentoPublico).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.stringContaining("203.0.113.9"), expect.any(Number), expect.any(Number));
  });

  it("depois de aceitar (?r=aceita): a confirmação, e a faixa repetida não aparece", async () => {
    await montar(orcamento({ estado: "aceita" }), { r: "aceita" });
    expect(screen.getByText("Pronto! Seu aceite foi registrado.")).toBeTruthy();
    expect(screen.queryByTestId("orcamento-estado")).toBeNull();
  });
});

describe("a marca é a DA ORGANIZAÇÃO, nunca a da instalação", () => {
  it("a página e a casca não leem a marca da instalação", () => {
    for (const arquivo of ["app/(orcamento-publico)/o/[token]/page.tsx", "app/(orcamento-publico)/layout.tsx"]) {
      const fonte = readFileSync(arquivo, "utf8");
      // Pelo IMPORT, não pelo texto: o comentário da casca explica por que não usa `marcaDaSaida`.
      expect(fonte, arquivo).not.toMatch(/from "@\/lib\/branding(\/(saida|instalacao|resolve))?"/);
      expect(fonte, arquivo).not.toMatch(/^import[^\n]*(marcaDaSaida|marcaDaInstalacao|resolverMarcaDaOrganizacao)/m);
    }
  });

  it("com logo da organização, o <img> é o dela", async () => {
    await montar(orcamento({ empresa: { nome: "Oficina do Zé", logoUrl: "https://storage/org-1/logo.png", corHex: null } }));
    const img = screen.getByAltText("Oficina do Zé") as HTMLImageElement;
    expect(img.src).toBe("https://storage/org-1/logo.png");
  });
});
