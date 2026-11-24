/**
 * A ABA "IMPORTANTES" DO TOPO DO INBOX — "precisa de alguém agora", calculada.
 *
 * Pedido do dono: o topo do Inbox fica com três abas só — Não lidas | Abertas |
 * Importantes. "Importantes" não tem coluna própria: é a UNIÃO de duas réguas que
 * já existem, a da Fila (`comandosDaFila`) e a marca de pendente (`pendente_em`).
 *
 * A cadeia tem os mesmos elos que todo filtro do Inbox (schema → rota → handler
 * → hook), e a rotura em qualquer um deles é silenciosa: a lista volta inteira.
 * Aqui se prende cada elo, e a régua do `or=` (a escrita que a lista e o badge
 * compartilham). A rota de contagens é medida em
 * `app/api/v1/conversations/counts/route.test.ts`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ automatico: true as boolean | undefined }));
vi.mock("@/lib/ai/agents/org-tem-automatico", () => ({
  orgTemAutomatico: async () => h.automatico,
}));

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";
import { parseFilterParam, tabToFilter } from "@/components/inbox/InboxLayout";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { comandosDaFila, filtroDeImportantes } from "@/lib/inbox/comando-da-conversa";
import { listConversationsQuerySchema } from "@/lib/schemas";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "55555555-5555-4555-8555-555555555555";

describe("a régua: filtroDeImportantes", () => {
  it("fila OU pendente, na gramática do `or=` do PostgREST", () => {
    expect(filtroDeImportantes(["aguardando", "ninguem"])).toBe(
      "comando_da_conversa.in.(aguardando,ninguem),pendente_em.not.is.null",
    );
  });

  it("usa o MESMO conjunto da aba Fila, com e sem automático na organização", () => {
    expect(filtroDeImportantes(comandosDaFila(true))).toContain("in.(aguardando,ninguem)");
    expect(filtroDeImportantes(comandosDaFila(false))).toContain("in.(aguardando,ninguem,automatico)");
  });

  it("recusa valor fora do vocabulário em vez de escapá-lo (a gramática não tem escape)", () => {
    expect(() => filtroDeImportantes(["aguardando),id.not.is.null"])).toThrow(/vocabulário/);
    expect(() => filtroDeImportantes([])).toThrow(/vazia/);
  });
});

describe("o schema e a rota", () => {
  it("o schema aceita `importantes=true` e recusa valor inventado", () => {
    const r = listConversationsQuerySchema.safeParse({ importantes: "true" });
    expect(r.success && r.data.importantes).toBe(true);
    expect(listConversationsQuerySchema.safeParse({ importantes: "sim" }).success).toBe(false);
    const ausente = listConversationsQuerySchema.safeParse({});
    expect(ausente.success && ausente.data.importantes).toBeUndefined();
  });

  it("a rota LÊ `importantes` da URL", () => {
    const rota = readFileSync("app/api/v1/conversations/route.ts", "utf8");
    expect(rota).toMatch(/importantes:\s*url\.searchParams\.get\("importantes"\)/);
  });

  it("o hook serializa `importantes` no GET da lista", () => {
    const hook = readFileSync("hooks/inbox/useConversationsRealtime.ts", "utf8");
    expect(hook).toMatch(/if \(filters\.importantes\) qs\.set\("importantes", "true"\);/);
  });
});

/** Um dublê mínimo do builder: registra cada predicado e devolve lista vazia. */
function supabaseQueRegistra() {
  const ors: string[] = [];
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["select", "order", "limit", "eq", "in", "is", "gt", "lt", "not", "ilike"]) {
    cadeia[metodo] = () => cadeia;
  }
  cadeia.or = (expr: string) => {
    ors.push(expr);
    return cadeia;
  };
  cadeia.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(resolve);
  const supabase = { from: () => cadeia, rpc: async () => ({ data: [], error: null }) };
  return { supabase, ors };
}

const ctx: HandlerCtx = {
  organization_id: ORG,
  actor: { type: "user", id: USER },
  requestId: "req-1",
} as HandlerCtx;

async function listar(query: Record<string, unknown>) {
  const { supabase, ors } = supabaseQueRegistra();
  const q = listConversationsQuerySchema.parse(query);
  await listConversationsHandler(supabase as never, ctx, q);
  return ors;
}

describe("o handler aplica a régua no banco", () => {
  it("com `importantes`, a consulta leva o `or=` da régua — org COM automático", async () => {
    h.automatico = true;
    expect(await listar({ importantes: "true" })).toContain(filtroDeImportantes(comandosDaFila(true)));
  });

  it("org SEM automático: a parte da Fila inclui `automatico`, como a aba Fila", async () => {
    h.automatico = false;
    expect(await listar({ importantes: "true" })).toContain(filtroDeImportantes(comandosDaFila(false)));
  });

  it("CONTROLE: sem o parâmetro, nenhum `or=` de importantes", async () => {
    h.automatico = true;
    const ors = await listar({});
    expect(ors.some((o) => o.includes("pendente_em"))).toBe(false);
  });
});

describe("a tela: as três abas do topo e os links antigos", () => {
  it("Não lidas pede `unread`, Importantes pede `importantes`, Abertas esconde fechadas e arquivadas", () => {
    expect(tabToFilter("nao_lidas")).toEqual({ unread: true });
    expect(tabToFilter("importantes")).toEqual({ importantes: true });
    expect(tabToFilter("abertas")).toEqual({ exclude_finished: true });
    // "Todas" (`all`, no modal) continua sendo tudo, histórico incluso.
    expect(tabToFilter("all")).toEqual({});
  });

  it("sem ?filter a aba padrão é Abertas; os links antigos seguem abrindo a visão deles", () => {
    expect(parseFilterParam(null)).toBe("abertas");
    expect(parseFilterParam("inventado")).toBe("abertas");
    for (const antigo of ["unassigned", "mine", "all", "closed", "archived", "ai", "pessoal"] as const) {
      expect(parseFilterParam(antigo)).toBe(antigo);
    }
    expect(parseFilterParam("importantes")).toBe("importantes");
    expect(parseFilterParam("nao_lidas")).toBe("nao_lidas");
  });
});
