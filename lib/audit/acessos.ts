/**
 * REGISTRO DE ACESSOS — o vocabulário da aba "Acessos" de `/app/audit`.
 *
 * Um acesso é uma linha de `api_audit_log` cuja ação diz respeito à ENTRADA na
 * conta: entrar, sair, provar o segundo fator, trocar ou redefinir a senha. As
 * ações já existiam (`lib/audit/actions.ts`); o que faltava era a organização na
 * linha — gravadas com `organization_id` nulo, nenhuma tela de empresa as via.
 * Quem preenche agora é `audit()`, por `orgDaSessaoDoAcesso`.
 *
 * Este módulo é PURO e vai ao navegador: a tela usa os rótulos daqui. Nada de
 * `node:*` nem `next/*`.
 */
import type { AuditAction } from "./actions";

/**
 * Ações que contam como acesso. A ordem não importa; a lista é a fronteira do
 * filtro da rota (`.in("action", ...)`) e de quem ganha organização em `audit()`.
 */
export const ACOES_DE_ACESSO = [
  "auth.login_success",
  "auth.login_failed",
  "auth.login_rate_limited",
  "auth.logout",
  "auth.google_signin_failed",
  "auth.mfa_enrolled",
  "auth.mfa_success",
  "auth.mfa_failed",
  "auth.mfa_device_trusted",
  "auth.mfa_trusted_devices_forgotten",
  "auth.recovery_code_used",
  "auth.password_reset_completed",
  "auth.password_reset_failed",
  "auth.password_change_completed",
  "auth.password_change_failed",
] as const satisfies readonly AuditAction[];

export type AcaoDeAcesso = (typeof ACOES_DE_ACESSO)[number];

const CONJUNTO: ReadonlySet<string> = new Set(ACOES_DE_ACESSO);

export function ehAcaoDeAcesso(action: string): action is AcaoDeAcesso {
  return CONJUNTO.has(action);
}

/** Falha é tudo que não deixou a pessoa entrar ou trocar o que pediu. */
const FALHAS: ReadonlySet<AcaoDeAcesso> = new Set<AcaoDeAcesso>([
  "auth.login_failed",
  "auth.login_rate_limited",
  "auth.google_signin_failed",
  "auth.mfa_failed",
  "auth.password_reset_failed",
  "auth.password_change_failed",
]);

export function acessoFalhou(action: string): boolean {
  return ehAcaoDeAcesso(action) && FALHAS.has(action);
}

/**
 * Rótulo em português (a CHAVE do dicionário). Quem desenha passa por `t()`;
 * a planilha, por `traduzir()`. Ação fora da lista devolve a própria ação.
 */
const ROTULOS: Record<AcaoDeAcesso, string> = {
  "auth.login_success": "Entrou",
  "auth.login_failed": "Senha incorreta",
  "auth.login_rate_limited": "Muitas tentativas",
  "auth.logout": "Saiu",
  "auth.google_signin_failed": "Falha ao entrar com Google",
  "auth.mfa_enrolled": "Verificação em duas etapas ativada",
  "auth.mfa_success": "Código de verificação aceito",
  "auth.mfa_failed": "Código de verificação recusado",
  "auth.mfa_device_trusted": "Aparelho marcado como confiável",
  "auth.mfa_trusted_devices_forgotten": "Aparelhos confiáveis esquecidos",
  "auth.recovery_code_used": "Código de recuperação usado",
  "auth.password_reset_completed": "Senha redefinida",
  "auth.password_reset_failed": "Falha ao redefinir a senha",
  "auth.password_change_completed": "Senha alterada",
  "auth.password_change_failed": "Falha ao alterar a senha",
};

export function rotuloDoAcesso(action: string, metadata?: Record<string, unknown> | null): string {
  if (action === "auth.login_success" && metadata?.provider === "google") return "Entrou com Google";
  return ehAcaoDeAcesso(action) ? ROTULOS[action] : action;
}

/** Todas as chaves que a aba e a planilha podem pedir ao dicionário. */
export const TEXTOS_DOS_ACESSOS: readonly string[] = [
  ...Object.values(ROTULOS),
  "Entrou com Google",
];
