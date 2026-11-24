import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { conteudoPrecisaDoEnvio, resolverNoEnvio } from "./no-envio";
import { resolverValoresDaEmpresa } from "./resolvedor";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const BASE = "https://crm.exemplo.com/";

/**
 * Um PostgREST de mentira com as duas tabelas que o envio toca: os valores da
 * empresa (só leitura) e os links de saída (lê e insere, com o índice único).
 */
function banco(valores: Array<{ chave: string; valor: string }>) {
  const links: Array<Record<string, unknown>> = [];
  const leituras: string[] = [];
  const filtros: Array<[string, string, unknown]> = [];
  let codigos = 0;
  const from = (tabela: string) => {
    leituras.push(tabela);
    const eqs: Array<[string, unknown]> = [];
    let rotuloNulo = false;
    let inserir: Record<string, unknown> | null = null;
    const casar = () =>
      links.filter(
        (l) => eqs.every(([c, v]) => l[c] === v) && (!rotuloNulo || l.rotulo === null),
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        eqs.push([c, v]);
        filtros.push([tabela, c, v]);
        return q;
      },
      is: (c: string, v: unknown) => {
        if (c === "rotulo" && v === null) rotuloNulo = true;
        return q;
      },
      limit: () => q,
      insert: (linha: Record<string, unknown>) => {
        inserir = linha;
        return q;
      },
      maybeSingle: async () => ({ data: casar()[0] ?? null, error: null }),
      single: async () => {
        const linha = { ...inserir!, id: `link-${links.length + 1}`, codigo: `Cod${String(++codigos).padStart(7, "0")}` };
        links.push(linha);
        return { data: { id: linha.id, codigo: linha.codigo }, error: null };
      },
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabela === "valores_personalizados" ? valores : [], error: null }).then(ok),
    };
    return q;
  };
  return { admin: { from } as unknown as SupabaseClient, links, leituras, filtros };
}

beforeEach(() => vi.clearAllMocks());

describe("{{empresa.*}} no envio", () => {
  it("troca a chave salva, mantém a reserva e deixa literal o que não existe", () => {
    expect(
      resolverValoresDaEmpresa('PIX: {{empresa.pix}} · {{empresa.horario|"comercial"}} · {{empresa.nada}} · {{nome}}', {
        pix: "pix@loja.exemplo",
      }),
    ).toEqual({
      texto: "PIX: pix@loja.exemplo · comercial · {{empresa.nada}} · {{nome}}",
      faltando: ["empresa.nada"],
    });
  });

  it("o corpo sai com o valor lido da organização do CONTEXTO", async () => {
    const b = banco([{ chave: "pix", valor: "pix@loja.exemplo" }]);
    const r = await resolverNoEnvio(
      b.admin,
      { organizationId: ORG, contactId: CONTATO },
      { body: "Nosso PIX: {{empresa.pix}}" },
      BASE,
    );
    expect(r.body).toBe("Nosso PIX: pix@loja.exemplo");
    expect(b.filtros).toContainEqual(["valores_personalizados", "organization_id", ORG]);
  });

  it("parâmetro de modelo aprovado também é resolvido, numa linha só", async () => {
    const b = banco([{ chave: "endereco", valor: "Rua A, 1\nCentro" }]);
    const r = await resolverNoEnvio(
      b.admin,
      { organizationId: ORG, contactId: CONTATO },
      { body: "x", template_values: { "body.1": "{{empresa.endereco}}", "body.2": "Ana" } },
      BASE,
    );
    expect(r.template_values).toEqual({ "body.1": "Rua A, 1 Centro", "body.2": "Ana" });
  });
});

describe("{{link:…}} no envio", () => {
  it("vira a URL curta do domínio, um link por (contato, destino, rótulo) — o segundo envio reusa", async () => {
    const b = banco([]);
    const destino = { organizationId: ORG, contactId: CONTATO };
    const primeiro = await resolverNoEnvio(b.admin, destino, { body: "Veja {{link:https://loja.exemplo/oferta|bf}}" }, BASE);
    const segundo = await resolverNoEnvio(b.admin, destino, { body: "De novo {{link:https://loja.exemplo/oferta|bf}}" }, BASE);

    expect(primeiro.body).toBe("Veja https://crm.exemplo.com/l/Cod0000001");
    expect(segundo.body).toBe("De novo https://crm.exemplo.com/l/Cod0000001");
    expect(b.links).toHaveLength(1);
    expect(b.links[0]).toMatchObject({
      organization_id: ORG,
      contact_id: CONTATO,
      destino_url: "https://loja.exemplo/oferta",
      rotulo: "bf",
    });
  });

  it("sem contato conhecido (grupo) o link sai como foi escrito, sem rastreio e sem banco", async () => {
    const b = banco([]);
    const r = await resolverNoEnvio(
      b.admin,
      { organizationId: ORG, contactId: null },
      { body: "Veja {{link:https://loja.exemplo/oferta}}" },
      BASE,
    );
    expect(r.body).toBe("Veja https://loja.exemplo/oferta");
    expect(b.leituras).toEqual([]);
  });

  it("um valor da empresa que é ele mesmo um link também é rastreado", async () => {
    const b = banco([{ chave: "site", valor: "{{link:https://loja.exemplo}}" }]);
    const r = await resolverNoEnvio(b.admin, { organizationId: ORG, contactId: CONTATO }, { body: "{{empresa.site}}" }, BASE);
    expect(r.body).toBe("https://crm.exemplo.com/l/Cod0000001");
  });

  it("sem marcação nenhuma devolve o MESMO objeto e não toca no banco", async () => {
    const b = banco([]);
    const entrada = { body: "Oi, tudo bem? https://loja.exemplo", template_values: { "body.1": "Ana" } };
    expect(conteudoPrecisaDoEnvio(entrada)).toBe(false);
    expect(await resolverNoEnvio(b.admin, { organizationId: ORG, contactId: CONTATO }, entrada, BASE)).toBe(entrada);
    expect(b.leituras).toEqual([]);
  });
});
