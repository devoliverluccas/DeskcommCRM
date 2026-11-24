import { describe, expect, it } from "vitest";

import { estadoDoLink, expiraEmDoLink, gerarToken, hashDoToken, tokenTemFormato, urlDoLink } from "./link-publico";

describe("token do link público", () => {
  it("tem 32 bytes em base64url (43 caracteres) e nunca se repete", () => {
    const a = gerarToken();
    const b = gerarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenTemFormato(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("o banco guarda o SHA-256 em hex, nunca o token", () => {
    const token = gerarToken();
    const hash = hashDoToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashDoToken(token)).toBe(hash);
  });

  it("formato errado é recusado antes do banco", () => {
    expect(tokenTemFormato("curto")).toBe(false);
    expect(tokenTemFormato(`${"a".repeat(42)}/`)).toBe(false);
  });

  it("a URL não dobra a barra da base", () => {
    expect(urlDoLink("https://crm.exemplo.com/", "abc")).toBe("https://crm.exemplo.com/o/abc");
    expect(urlDoLink("https://crm.exemplo.com", "abc")).toBe("https://crm.exemplo.com/o/abc");
  });
});

describe("expiraEmDoLink", () => {
  it("com validade: o dia seguinte, 14h UTC — depois do fim do dia em qualquer fuso", () => {
    expect(expiraEmDoLink("2026-12-10")).toBe("2026-12-11T14:00:00.000Z");
  });

  it("sem validade: 30 dias", () => {
    const agora = new Date("2026-11-24T12:00:00.000Z");
    expect(expiraEmDoLink(null, agora)).toBe("2026-12-24T12:00:00.000Z");
  });
});

describe("estadoDoLink", () => {
  const agora = new Date("2026-11-24T12:00:00.000Z");
  const vivo = { expira_em: "2026-12-11T14:00:00.000Z", revogado_em: null };
  const base = { link: vivo, proposta: { status: "enviada", valid_until: "2026-12-10" }, hojeNoFuso: "2026-11-24", agora };

  it("enviada, link vivo, dentro da validade: aberta (o único estado com botões)", () => {
    expect(estadoDoLink(base)).toBe("aberta");
  });

  it("decidida vence tudo: quem aceitou e volta depois do vencimento lê 'aceita'", () => {
    expect(estadoDoLink({ ...base, proposta: { status: "aceita", valid_until: "2026-01-01" }, hojeNoFuso: "2026-11-24" })).toBe("aceita");
    expect(estadoDoLink({ ...base, proposta: { status: "recusada", valid_until: null } })).toBe("recusada");
  });

  it("substituída e cancelada mostram o estado, sem botões", () => {
    expect(estadoDoLink({ ...base, proposta: { status: "substituida", valid_until: null } })).toBe("substituida");
    expect(estadoDoLink({ ...base, proposta: { status: "cancelada", valid_until: null } })).toBe("cancelada");
  });

  it("revogado (anonimização, envio que falhou): revogada", () => {
    expect(estadoDoLink({ ...base, link: { ...vivo, revogado_em: "2026-11-20T00:00:00Z" } })).toBe("revogada");
  });

  it("vencida pelo instante do link, pela validade no fuso, ou pelo status", () => {
    expect(estadoDoLink({ ...base, link: { ...vivo, expira_em: "2026-11-24T11:59:59Z" } })).toBe("vencida");
    expect(estadoDoLink({ ...base, hojeNoFuso: "2026-12-11" })).toBe("vencida");
    expect(estadoDoLink({ ...base, proposta: { status: "vencida", valid_until: null } })).toBe("vencida");
  });

  it("no último dia da validade ainda está aberta", () => {
    expect(estadoDoLink({ ...base, hojeNoFuso: "2026-12-10" })).toBe("aberta");
  });

  it("rascunho/enviando (o envio não saiu): indisponível", () => {
    expect(estadoDoLink({ ...base, proposta: { status: "rascunho", valid_until: null } })).toBe("indisponivel");
    expect(estadoDoLink({ ...base, proposta: { status: "enviando", valid_until: null } })).toBe("indisponivel");
  });
});
