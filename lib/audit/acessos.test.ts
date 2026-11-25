import { describe, expect, it } from "vitest";

import { ACOES_DE_ACESSO, acessoFalhou, ehAcaoDeAcesso, rotuloDoAcesso } from "./acessos";
import { AUDIT_ACTIONS } from "./actions";

describe("vocabulário do registro de acessos", () => {
  it("toda ação de acesso existe no vocabulário de auditoria", () => {
    const vocabulario = new Set<string>(AUDIT_ACTIONS);
    for (const acao of ACOES_DE_ACESSO) expect(vocabulario.has(acao)).toBe(true);
  });

  it("toda ação auth.* de entrada/saída/senha/MFA emitida hoje é acesso", () => {
    for (const acao of [
      "auth.login_success",
      "auth.logout",
      "auth.mfa_success",
      "auth.password_reset_completed",
      "auth.password_change_completed",
      "auth.google_signin_failed",
    ]) {
      expect(ehAcaoDeAcesso(acao)).toBe(true);
    }
    // Cadastro e mutação de negócio NÃO são acesso.
    expect(ehAcaoDeAcesso("auth.signup_confirmed")).toBe(false);
    expect(ehAcaoDeAcesso("lead.created")).toBe(false);
  });

  it("rótulo legível, com o Google nomeado quando a entrada veio de lá", () => {
    expect(rotuloDoAcesso("auth.login_success")).toBe("Entrou");
    expect(rotuloDoAcesso("auth.login_success", { provider: "google" })).toBe("Entrou com Google");
    expect(rotuloDoAcesso("auth.logout")).toBe("Saiu");
    expect(rotuloDoAcesso("lead.created")).toBe("lead.created");
  });

  it("falha é o que não deixou entrar ou trocar", () => {
    expect(acessoFalhou("auth.mfa_failed")).toBe(true);
    expect(acessoFalhou("auth.login_success")).toBe(false);
    expect(acessoFalhou("lead.created")).toBe(false);
  });
});
