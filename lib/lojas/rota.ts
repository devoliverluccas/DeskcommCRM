/**
 * O PORTÃO DAS ROTAS DE LOJAS (`app/api/v1/lojas/**`).
 *
 * Papel pela sessão, organização do cookie (nunca do corpo) e as duas chaves do
 * módulo: sem o módulo instalado toda rota responde 404; sem a empresa ter
 * ligado, só a configuração responde (é por ela que se liga). Escrita pelo
 * cliente de serviço, com `organization_id` sempre filtrado à mão: a sessão só
 * LÊ as tabelas do módulo (migration 9495).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

import { lojasLigadas, moduloDeLojasInstalado } from "./modulo";

type Autorizado = Extract<Awaited<ReturnType<typeof requireRole>>, { ok: true }>;

export type Portao =
  | { ok: false; response: Response }
  | {
      ok: true;
      authz: Autorizado;
      orgId: string;
      admin: SupabaseClient;
      t: (texto: string) => string;
    };

export async function portaoDasLojas(
  minimo: Role,
  requestId: string,
  { soInstalado = false }: { soInstalado?: boolean } = {},
): Promise<Portao> {
  const authz = await requireRole(minimo, { requestId, resource: "lojas" });
  if (!authz.ok) return { ok: false, response: authz.response };
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  const aberto = soInstalado ? await moduloDeLojasInstalado(admin, orgId) : await lojasLigadas(admin, orgId);
  if (!aberto) return { ok: false, response: fail("not_found", t("Módulo indisponível."), 404, { requestId }) };
  return { ok: true, authz, orgId, admin, t };
}
