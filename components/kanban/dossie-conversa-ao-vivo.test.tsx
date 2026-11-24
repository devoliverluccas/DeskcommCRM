import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LeadDossier } from "./LeadDossier";
import type { Lead } from "@/lib/types/leads";

/**
 * O DOSSIÊ COM A CONVERSA AO VIVO (item 1.4) — a MOLDURA.
 *
 * O que a conversa faz por dentro tem teste próprio
 * (`ConversaNoDossieAoVivo.test.tsx`, com o fio e a caixa reais). Aqui a peça é
 * uma sonda, e o que se mede é onde o dossiê a põe:
 *
 *  - negócio COM conversa: duas colunas a partir de `lg` — detalhes à esquerda,
 *    conversa à direita — e, abaixo disso, a conversa DEPOIS dos detalhes (a
 *    ordem do DOM é a mesma; só a grade aparece no `lg`);
 *  - negócio SEM conversa: o dossiê de antes, com o bloco antigo no lugar de
 *    sempre (é a ação "Abrir conversa" da #1993) e nenhuma coluna;
 *  - na página inteira, a conversa abre a coluna da direita.
 */

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useUser: () => ({ id: "u1", is_platform_admin: false, support: false }),
  useActiveOrg: () => ({ role: "agent" }),
  usePermission: () => false,
}));
vi.mock("@/hooks/leads/useLeadTimeline", () => ({
  useLeadTimeline: () => ({
    itens: [],
    chegouAoVivo: new Set<string>(),
    isLoading: false,
    isError: false,
    realtimeStatus: "connected",
    seguranca: { divergencias: 0 },
  }),
}));
vi.mock("@/hooks/leads/useContatosRelacionados", () => ({
  chaveDosContatosRelacionados: (leadId: string | null) => ["contatos-relacionados", leadId],
  useContatosRelacionados: () => ({ data: { data: [] }, isLoading: false, isError: false }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>
      {children}
    </a>
  ),
}));

// Peças vindas da main (vendas do negócio, classificação comercial): não são o
// assunto aqui e pedem QueryClient — saem como no `LeadDossier.test.tsx`.
vi.mock("@/components/vendas/VendasDoNegocio", () => ({ VendasDoNegocio: () => null }));
vi.mock("./ClassificacaoComercial", () => ({ ClassificacaoComercial: () => null }));
vi.mock("./ContatoDoNegocio", () => ({ ContatoDoNegocio: () => <div data-peca="contato" /> }));
vi.mock("./LeadFieldsForm", () => ({ LeadFieldsForm: () => <div data-peca="campos" /> }));
vi.mock("./RevisaoDoDocumento", () => ({ RevisaoDoDocumento: () => null }));
vi.mock("./TarefasDoNegocio", () => ({ TarefasDoNegocio: () => <div data-peca="tarefas" /> }));
vi.mock("./PropostasDoNegocio", () => ({ PropostasDoNegocio: () => null }));
vi.mock("./ScoreSlot", () => ({ ScoreSlot: () => null }));
vi.mock("./OwnerBadge", () => ({ OwnerBadge: () => null }));
vi.mock("./AtalhosDoCard", () => ({ AtalhosDoNegocio: () => null }));
vi.mock("./LeadTimeline", () => ({ LeadTimeline: () => <ul data-peca="linha-do-tempo" /> }));
vi.mock("./ConversaNoDossie", () => ({
  ConversaNoDossie: () => <div data-peca="porta-da-conversa" />,
}));
vi.mock("./ConversaNoDossieAoVivo", () => ({
  ConversaNoDossieAoVivo: ({
    conversa,
    ativo,
    className,
  }: {
    conversa: { id: string };
    ativo?: boolean;
    className?: string;
  }) => (
    <section
      data-peca="conversa-ao-vivo"
      data-conversa={conversa.id}
      data-ativo={String(ativo)}
      className={className}
    />
  ),
}));

window.HTMLElement.prototype.scrollIntoView ??= () => undefined;

const CONVERSA = { id: "conv-1", preview: "Oi", last_message_at: null, unread: 0 };

function lead(conversa: Lead["conversa"]): Lead {
  return {
    id: "lead-1",
    title: "Viagem Rio",
    stage_id: "s1",
    contact_id: "contato-1",
    contact_phone: "+5521999999999",
    value_cents: 250000,
    currency: "BRL",
    score: null,
    conversa,
    owner_kind: null,
    owner_user_id: null,
    owner_agent_id: null,
    owner_agent: null,
  } as unknown as Lead;
}

function montar(conversa: Lead["conversa"], variante: "painel" | "pagina" = "painel") {
  return render(
    <LeadDossier
      open
      onOpenChange={() => undefined}
      variante={variante}
      lead={lead(conversa)}
      pipelineId="funil-1"
      stageName="Novo"
    />,
  );
}

const peca = (nome: string) => document.querySelector(`[data-peca="${nome}"]`) as HTMLElement | null;
const classes = (el: Element) => el.className.split(/\s+/).filter(Boolean);

describe("a gaveta, com conversa", () => {
  it("monta a conversa ao vivo com o id do negócio, buscando só com a gaveta aberta", () => {
    montar(CONVERSA);
    const conversa = peca("conversa-ao-vivo");
    expect(conversa).not.toBeNull();
    expect(conversa).toHaveAttribute("data-conversa", "conv-1");
    expect(conversa).toHaveAttribute("data-ativo", "true");
    // O bloco antigo não aparece junto: uma conversa, uma peça.
    expect(peca("porta-da-conversa")).toBeNull();
  });

  it("detalhes à esquerda e conversa à direita — e, sem a grade, a conversa vem DEPOIS", () => {
    montar(CONVERSA);
    const colunas = screen.getByTestId("dossie-colunas");
    const [esquerda, direita] = [...colunas.children] as [HTMLElement, HTMLElement];
    expect(esquerda).toBe(screen.getByTestId("dossie-detalhes"));
    for (const nome of ["contato", "campos", "tarefas", "linha-do-tempo"]) {
      expect(esquerda.contains(peca(nome)), `${nome} fora da coluna dos detalhes`).toBe(true);
    }
    expect(direita.contains(peca("conversa-ao-vivo"))).toBe(true);
    // Ordem do documento: é ela que vale abaixo de `lg`, onde a grade não existe.
    expect(
      peca("linha-do-tempo")!.compareDocumentPosition(peca("conversa-ao-vivo")!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("a grade e a largura extra são SÓ do `lg`: abaixo disso, uma coluna", () => {
    montar(CONVERSA);
    const grade = classes(screen.getByTestId("dossie-colunas"));
    expect(grade).toContain("lg:grid");
    expect(grade.filter((c) => /^(grid|grid-cols-)/.test(c))).toEqual([]);
    const gaveta = screen.getByRole("dialog");
    expect(classes(gaveta).some((c) => c.startsWith("lg:max-w-"))).toBe(true);
    // Na gaveta larga a conversa ocupa a altura da coluna; na estreita, uma janela fixa.
    const conversa = classes(peca("conversa-ao-vivo")!);
    expect(conversa).toContain("lg:h-full");
    expect(conversa.some((c) => c.startsWith("h-["))).toBe(true);
  });
});

describe("a gaveta, sem conversa: a tela de antes", () => {
  it.each([
    ["contato sem conversa (null)", null],
    ["negócio sem contato (ausente)", undefined],
  ])("%s — sem colunas, sem conversa ao vivo, o bloco antigo antes do contato", (_nome, conversa) => {
    montar(conversa);
    expect(screen.queryByTestId("dossie-colunas")).toBeNull();
    expect(peca("conversa-ao-vivo")).toBeNull();
    const porta = peca("porta-da-conversa");
    expect(porta).not.toBeNull();
    expect(
      porta!.compareDocumentPosition(peca("contato")!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(classes(screen.getByRole("dialog")).some((c) => c.startsWith("lg:max-w-"))).toBe(false);
  });
});

describe("a página inteira", () => {
  it("com conversa, ela abre a coluna da direita", () => {
    montar(CONVERSA, "pagina");
    const direita = screen.getByTestId("negocio-colunas").children[1] as HTMLElement;
    expect(direita.firstElementChild).toBe(peca("conversa-ao-vivo"));
    expect(peca("porta-da-conversa")).toBeNull();
  });

  it("sem conversa, o bloco antigo fica fora das colunas, como antes", () => {
    montar(null, "pagina");
    const colunas = screen.getByTestId("negocio-colunas");
    const porta = peca("porta-da-conversa");
    expect(porta).not.toBeNull();
    expect(colunas.contains(porta)).toBe(false);
  });
});
