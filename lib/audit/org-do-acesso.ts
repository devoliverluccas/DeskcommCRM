/**
 * EM QUAL EMPRESA UM ACESSO FICA REGISTRADO.
 *
 * Login, saída, segundo fator e troca de senha são gravados por `audit()` sem
 * organização — o emissor não tem uma em mãos (no login a sessão nem terminou de
 * nascer). Gravados assim, nenhuma tela de empresa os via. Esta função responde
 * "qual empresa esta sessão abre?" com a MESMA regra de `resolveActiveOrg`
 * (`lib/auth/membro-ativo.ts`): o cookie `active_org`, se a pessoa ainda é
 * membro daquela empresa; senão a primeira operante, na ordem de `accepted_at`.
 *
 * ─── Decisões ────────────────────────────────────────────────────────────────
 *
 * - **Uma empresa só, a ativa — não replica.** Quem é membro de duas empresas
 *   entra numa delas. Copiar a linha para todas mostraria à empresa B o IP, o
 *   aparelho e o horário de quem estava trabalhando para a empresa A — o
 *   vínculo com A não é da conta de B. A conta tem uma sessão, mas o trabalho
 *   acontece numa empresa por vez, e é essa que responde pelo acesso.
 * - **O cookie nunca é confiado cru.** Ele só escolhe entre os vínculos VIVOS
 *   lidos do banco (`revoked_at` nulo); um cookie de empresa alheia é ignorado.
 * - **Falha devolve `null`, nunca lança.** A auditoria não bloqueia a mutação, e
 *   a linha sem empresa ainda é vista pela plataforma — o comportamento de antes.
 *
 * Usa o cliente de serviço (o mesmo de `audit()`): no login o cookie de sessão
 * acabou de ser escrito e a leitura com RLS não garante enxergá-lo.
 */
import { escolherMembroAtivo } from "@/lib/auth/membro-ativo";
import { createAdminClient } from "@/lib/supabase/admin";

interface LinhaDoVinculo {
  organization_id: string;
  organizations: { status?: string | null } | Array<{ status?: string | null }> | null;
}

async function cookieDaOrgAtiva(): Promise<string | undefined> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get("active_org")?.value;
  } catch {
    // Fora de requisição (worker, script) não há cookie: vale a primeira operante.
    return undefined;
  }
}

export async function orgDaSessaoDoAcesso(userId: string): Promise<string | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("user_organizations")
      .select("organization_id, organizations!user_organizations_organization_id_fkey(status)")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("accepted_at", { ascending: true, nullsFirst: true })
      .order("organization_id", { ascending: true });
    if (error || !data) return null;
    const vinculos = (data as unknown as LinhaDoVinculo[]).map((v) => {
      const org = Array.isArray(v.organizations) ? v.organizations[0] : v.organizations;
      return { organization_id: v.organization_id, org_status: org?.status ?? null };
    });
    return escolherMembroAtivo(vinculos, await cookieDaOrgAtiva())?.organization_id ?? null;
  } catch {
    return null;
  }
}
