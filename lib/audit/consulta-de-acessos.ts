/**
 * A CONSULTA do registro de acessos — compartilhada pela lista
 * (`GET /api/v1/audit/acessos`) e pela planilha (`.../acessos/export`), para que
 * as duas nunca mostrem conjuntos diferentes com o mesmo filtro.
 *
 * O que sai daqui para a tela é DECIDIDO aqui, não na tela:
 *
 * - **IP inteiro só para quem administra a empresa** (`admin`, ou o administrador
 *   da plataforma fora de suporte). Gerente vê a auditoria — é o piso de
 *   `/app/audit` desde sempre — mas vê o IP mascarado: a pergunta dele é "foi
 *   esta pessoa, deste aparelho, neste horário?", e o endereço de casa de um
 *   colega não faz parte da resposta. Mascarar na TELA não bastaria: o JSON da
 *   rota iria inteiro para o navegador.
 * - **Metadados só os que dizem COMO entrou** (`provider`, `mfa`, `scope`,
 *   `motivo`). O resto da linha (hash de e-mail, texto cru de erro do provedor)
 *   é para investigação da plataforma, não para a lista da empresa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { ROLE_RANK, type Role } from "@/lib/auth/types";

import { ACOES_DE_ACESSO } from "./acessos";
import { mascararIp } from "./aparelho";

export const acessosQuerySchema = z.object({
  actor_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AcessosQuery = z.infer<typeof acessosQuerySchema>;

export const COLUNAS_DE_ACESSO =
  "id, created_at, actor_user_id, action, metadata, actor_ip, actor_user_agent";

export interface LinhaDeAcessoNoBanco {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
}

/** O que a rota devolve — `ip` já mascarado quando é o caso. */
export interface Acesso {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  ip_mascarado: boolean;
  user_agent: string | null;
}

const METADADOS_VISIVEIS = ["provider", "mfa", "scope", "motivo"] as const;

export function podeVerIpInteiro(papel: Role, ehAdminDaPlataforma: boolean): boolean {
  return ehAdminDaPlataforma || ROLE_RANK[papel] >= ROLE_RANK.admin;
}

export function apresentarAcesso(linha: LinhaDeAcessoNoBanco, ipInteiro: boolean): Acesso {
  const metadata: Record<string, unknown> = {};
  for (const chave of METADADOS_VISIVEIS) {
    const v = linha.metadata?.[chave];
    if (typeof v === "string" || typeof v === "boolean") metadata[chave] = v;
  }
  return {
    id: linha.id,
    created_at: linha.created_at,
    actor_user_id: linha.actor_user_id,
    action: linha.action,
    metadata,
    ip: ipInteiro ? linha.actor_ip : mascararIp(linha.actor_ip),
    ip_mascarado: !ipInteiro && !!linha.actor_ip,
    user_agent: linha.actor_user_agent,
  };
}

/**
 * O filtro comum: só ações de acesso, só da organização da sessão, pessoa e
 * período opcionais, mais novo primeiro (com `id` de desempate). Quem chama
 * acrescenta cursor/limite.
 */
export function consultaDeAcessos(
  supabase: SupabaseClient,
  organizationId: string,
  q: Pick<AcessosQuery, "actor_id" | "from" | "to">,
  opcoes?: { contar?: boolean },
) {
  let query = supabase
    .from("api_audit_log")
    .select(COLUNAS_DE_ACESSO, opcoes?.contar ? { count: "exact" } : undefined)
    .eq("organization_id", organizationId)
    .in("action", [...ACOES_DE_ACESSO])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (q.actor_id) query = query.eq("actor_user_id", q.actor_id);
  if (q.from) query = query.gte("created_at", q.from);
  if (q.to) query = query.lte("created_at", q.to);
  return query;
}
