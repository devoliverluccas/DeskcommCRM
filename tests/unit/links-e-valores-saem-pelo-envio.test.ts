/**
 * `{{empresa.*}}` E `{{link:…}}` SAEM RESOLVIDOS PELA CADEIA DE ENVIO (fase 4,
 * itens 4.4 e 4.6) — não num teste de unidade à parte.
 *
 * As regras moram em `lib/variaveis/no-envio.ts` e têm os próprios casos. O
 * que este arquivo prende é a FIAÇÃO dentro do `sendMessageHandler`, a porta de
 * saída de Inbox, campanha, automação, follow-up, MCP e agente:
 *
 *   1. o canal recebe o valor da empresa e a URL curta — e `messages.body`
 *      guarda o MESMO texto (o histórico mostra o que o cliente recebeu);
 *   2. o link é do CONTATO da conversa e da organização do CONTEXTO;
 *   3. texto sem marcação passa sem tocar no service role (o caminho de
 *      sempre não muda).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

const banco = vi.hoisted(() => ({
  links: [] as Array<Record<string, unknown>>,
  tabelas: [] as string[],
}));

/** O service role: os valores da empresa e os links de saída (lê e insere). */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      banco.tabelas.push(tabela);
      const eqs: Array<[string, unknown]> = [];
      let linha: Record<string, unknown> | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (eqs.push([c, v]), q),
        is: () => q,
        limit: () => q,
        insert: (l: Record<string, unknown>) => ((linha = l), q),
        maybeSingle: async () => ({
          data: banco.links.find((l) => eqs.every(([c, v]) => l[c] === v)) ?? null,
          error: null,
        }),
        single: async () => {
          const nova = { ...linha!, id: "link-1", codigo: "AbCdE12345" };
          banco.links.push(nova);
          return { data: { id: nova.id, codigo: nova.codigo }, error: null };
        },
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({
            data:
              tabela === "valores_personalizados" && eqs.some(([c, v]) => c === "organization_id" && v === ORG)
                ? [{ chave: "pix", valor: "pix@loja.exemplo" }]
                : [],
            error: null,
          }).then(ok),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}), isServiceRoleConfigured: () => true }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: vi.fn(async () => new Map()) }));

function conversa(isGroup = false): Record<string, unknown> {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: isGroup,
    group_chat_id: isGroup ? "120363000000000000@g.us" : null,
    provider_conversation_id: null,
    contacts: { phone_number: "+5511999998888", wa_identity: null, wa_lid: null, is_blocked: false },
    channel_sessions: {
      provider: "waha",
      waha_session_name: "default",
      meta_phone_number_id: null,
      zernio_account_id: null,
      status: "WORKING",
      archived_at: null,
    },
  };
}

const ctx: HandlerCtx = { organization_id: ORG, actor: { type: "user", id: USER }, requestId: "req-1" };
const texto = (body: string): SendMessageInput => ({ conversation_id: CONV, type: "text", body }) as SendMessageInput;

function wahaQueResponde() {
  vi.stubEnv("WAHA_API_BASE_URL", "http://waha.teste");
  vi.stubEnv("WAHA_API_KEY", "chave-de-teste");
  const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "true_5511999998888@c.us_3EB0AAAA" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function textoNaRede(fetchMock: ReturnType<typeof wahaQueResponde>): string | undefined {
  const envio = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/sendText"));
  return (JSON.parse(envio?.[1]?.body ?? "{}") as { text?: string }).text;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  banco.links.length = 0;
  banco.tabelas.length = 0;
});

describe("o envio resolve o que só ele sabe", () => {
  it("valor da empresa e link curto chegam ao canal E ficam em messages.body", async () => {
    const fetchMock = wahaQueResponde();
    const { supabase, capturas } = criarDubleDoHandler({
      conversation: conversa(),
      organizacao: { settings: {}, status: "active" },
    });

    await sendMessageHandler(
      supabase,
      ctx,
      texto("PIX: {{empresa.pix}} · oferta: {{link:https://loja.exemplo/oferta|bf}}"),
    );

    // A origem é a `NEXT_PUBLIC_APP_URL` da instalação; o caminho é o da rota pública.
    const enviado = textoNaRede(fetchMock);
    expect(enviado).toMatch(/^PIX: pix@loja\.exemplo · oferta: https?:\/\/\S+\/l\/AbCdE12345$/);
    expect(capturas.inserts.messages!.at(-1)?.["body"]).toBe(enviado);
    expect(banco.links[0]).toMatchObject({
      organization_id: ORG,
      contact_id: CONTACT,
      destino_url: "https://loja.exemplo/oferta",
      rotulo: "bf",
    });
  });

  it("em grupo o link sai como foi escrito, sem rastreio", async () => {
    const fetchMock = wahaQueResponde();
    const { supabase } = criarDubleDoHandler({
      conversation: conversa(true),
      organizacao: { settings: {}, status: "active" },
    });
    await sendMessageHandler(supabase, ctx, texto("Veja {{link:https://loja.exemplo/oferta}}"));
    expect(banco.links).toHaveLength(0);
    // O texto do grupo é o mesmo, sem a marcação.
    expect(JSON.stringify(fetchMock.mock.calls)).toContain("Veja https://loja.exemplo/oferta");
  });

  it("texto sem marcação não toca no service role de variáveis", async () => {
    const fetchMock = wahaQueResponde();
    const { supabase } = criarDubleDoHandler({
      conversation: conversa(),
      organizacao: { settings: {}, status: "active" },
    });
    await sendMessageHandler(supabase, ctx, texto("oi, tudo bem? https://loja.exemplo"));
    expect(textoNaRede(fetchMock)).toBe("oi, tudo bem? https://loja.exemplo");
    expect(banco.tabelas.filter((t) => t === "valores_personalizados" || t === "links_de_saida")).toEqual([]);
  });
});
