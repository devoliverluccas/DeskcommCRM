import { describe, expect, it } from "vitest";

import { getAdapter } from "@/lib/channels";
import {
  capabilitiesOf,
  modoDeCampanhaDoCanal,
  PROVIDERS_DE_MENSAGEM,
  PROVIDERS_DE_TELEFONE,
  recusaNotaDeVoz,
  transportaMensagem,
} from "@/lib/channels/capabilities";
import { CANAIS_DE_CONVERSA } from "@/lib/channels/canais-de-conversa";
import { acceptsInboundWebhook } from "@/lib/channels/inbound";
import { marcaDoCanal } from "@/lib/channels/marca-do-canal";
import { origemDoNegocioPeloCanal } from "@/lib/channels/origem-do-negocio";
import { channelBrand } from "@/lib/channels/presentation";
import { resolveSessionRef } from "@/lib/channels/session-ref";
import { fonteDeTemplates } from "@/lib/channels/templates-fonte";
import { SCRIPT_DO_CHAT } from "@/lib/channels/webchat/script";
import { hashDoVisitante, identidadeDoVisitante, novoTokenDoVisitante, tokenDoVisitanteValido } from "@/lib/channels/webchat/visitante";

/**
 * O CHAT DO SITE NO SEAM (fase 5, item 5.3). Os módulos do canal podem estar
 * certos e o canal não existir: quem decide se ele ENTRA é a matriz, a lista de
 * canais de mensagem, o adapter registrado e o vocabulário da conversa.
 */
describe("capability do chat do site", () => {
  it("sem janela, sem modelo, sem banimento, sem nota de voz", () => {
    const c = capabilitiesOf("webchat");
    expect(c.freeformOutsideWindow).toBe(true);
    expect(c.requiresTemplates).toBe(false);
    expect(c.banRisk).toBe(false);
    expect(c.costPerMessage).toBe(false);
    expect(c.voiceNote).toBe("none");
    expect(c.groups).toBe("none");
    expect(c.mensagemInterativa).toBe(false);
    expect(c.marcaLidasPorMensagem).toBe(false);
    expect(recusaNotaDeVoz("webchat")).toBe(true);
  });

  it("conversa, mas não alcança telefone e não faz campanha", () => {
    expect(PROVIDERS_DE_MENSAGEM).toContain("webchat");
    expect(PROVIDERS_DE_TELEFONE as readonly string[]).not.toContain("webchat");
    expect(transportaMensagem("webchat")).toBe(true);
    expect(modoDeCampanhaDoCanal("webchat")).toBeNull();
    expect(fonteDeTemplates("webchat")).toBeNull();
  });

  it("não entra pelo webhook genérico — a porta é a rota pública", () => {
    expect(acceptsInboundWebhook("webchat")).toBe(false);
  });

  it("a conversa tem canal próprio, origem própria e marca na tela", () => {
    expect(CANAIS_DE_CONVERSA).toContain("webchat");
    expect(origemDoNegocioPeloCanal("webchat").source).toBe("webchat");
    expect(channelBrand({ provider: "webchat" })).toBe("site");
    expect(marcaDoCanal("site").rotulo).toBe("Chat do site");
    expect(marcaDoCanal("site").Icone).not.toBeNull();
  });

  it("o sessionRef é a chave pública", () => {
    expect(resolveSessionRef({ provider: "webchat", webchat_public_key: "k".repeat(32) })).toBe("k".repeat(32));
  });
});

describe("adapter do chat do site", () => {
  const adapter = getAdapter("webchat");
  const base = { organizationId: "org", sessionRef: "k", to: "visitante-do-site" };

  it("aceita texto e devolve um id próprio", async () => {
    const r = await adapter.send({ ...base, kind: "text", body: "Olá" });
    expect(r.externalId).toMatch(/^wc:[0-9a-f-]{36}$/);
  });

  it("recusa o que a janela não desenha, nomeando o motivo", async () => {
    await expect(adapter.send({ ...base, kind: "location", body: "x" })).rejects.toThrow(/webchat_kind_not_supported/);
    await expect(adapter.send({ ...base, kind: "text", body: "  " })).rejects.toThrow(/webchat_empty_body/);
  });

  it("sem grupo; com destinatário pelo visitante da conversa", () => {
    const r = { phoneNumber: null, waIdentity: null, groupChatId: null };
    expect(adapter.resolveRecipient({ ...r, isGroup: true })).toBeNull();
    expect(adapter.resolveRecipient({ ...r, isGroup: false })).not.toBeNull();
    expect(adapter.isConfigured()).toBe(true);
  });

  it("chama o beforeSend antes de aceitar", async () => {
    let chamou = false;
    await adapter.send({ ...base, kind: "text", body: "x", beforeSend: async () => { chamou = true; } });
    expect(chamou).toBe(true);
  });
});

describe("visitante", () => {
  it("o banco guarda o hash, nunca o token", () => {
    const token = novoTokenDoVisitante();
    expect(tokenDoVisitanteValido(token)).toBe(true);
    const id = identidadeDoVisitante("sessao", token);
    expect(id).toBe(`webchat:sessao:${hashDoVisitante(token)}`);
    expect(id).not.toContain(token);
  });

  it("forma do token é conferida", () => {
    expect(tokenDoVisitanteValido("curto")).toBe(false);
    expect(tokenDoVisitanteValido(null)).toBe(false);
  });
});

describe("script público", () => {
  it("é JavaScript válido, sem marca, sem cookie e sem innerHTML", () => {
    expect(() => new Function(SCRIPT_DO_CHAT)).not.toThrow();
    expect(SCRIPT_DO_CHAT).not.toMatch(/document\.cookie|innerHTML|Deskcomm/i);
    expect(SCRIPT_DO_CHAT).toContain("X-Webchat-Visitante");
    expect(SCRIPT_DO_CHAT).toContain("localStorage");
    expect(SCRIPT_DO_CHAT).toContain('credentials: "omit"');
  });
});
