/**
 * Qual organização está ativa, dado o cookie `active_org` — a regra ÚNICA.
 *
 * Mora fora de `lib/auth/server.ts` porque TRÊS coisas precisam da mesma
 * resposta e não podem divergir: `resolveActiveOrg`, que decide o escopo dos
 * dados; a resolução do idioma dentro de `loadAuthUser`; e o registro de acessos
 * (`lib/audit/org-do-acesso.ts`), que grava em qual empresa a sessão abriu. Se o
 * registro escolhesse por conta, o login apareceria na auditoria de uma empresa
 * e a pessoa trabalharia em outra.
 *
 * Sem `next/*`: é função pura, testável sem requisição.
 *
 * ⚠️ O `memberships[0]` do fim só é uma ESCOLHA porque quem monta `memberships`
 * ordena a consulta (`accepted_at`, depois `organization_id`). Sem aquele
 * `ORDER BY`, isto aqui é um sorteio.
 */
import { ehOperante } from "@/lib/organizacao/operante";

export interface VinculoParaEscolha {
  organization_id: string;
  org_status?: string | null;
}

export function escolherMembroAtivo<T extends VinculoParaEscolha>(
  memberships: readonly T[],
  cookieOrg: string | undefined,
): T | null {
  if (memberships.length === 0) return null;
  if (cookieOrg) {
    // Com cookie, MANTÉM mesmo a suspensa: é por ela que a pessoa chega ao hub
    // `/account-suspended` para pagar, pedir LGPD ou trocar de empresa.
    const achado = memberships.find((o) => o.organization_id === cookieOrg);
    if (achado) return achado;
  }
  // Sem cookie, a primeira OPERANTE na mesma ordem (`accepted_at`,
  // `organization_id`); a primeira de todas só quando nenhuma opera.
  return memberships.find((o) => ehOperante(o.org_status)) ?? memberships[0] ?? null;
}
