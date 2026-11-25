/**
 * GET /api/v1/audit/acessos/export — o registro de acessos em planilha `.xlsx`
 * (até 10 mil linhas), com os MESMOS filtros e a MESMA porta da lista
 * (`../route.ts`): manager+, IP inteiro só para quem administra a empresa.
 *
 * Por que XLSX e não CSV como a exportação geral: esta planilha vai para gente
 * de RH e de segurança, que abre no Excel — e o Excel em português abre CSV
 * com vírgula numa coluna só. O arquivo é montado com `fflate`, que já estava
 * instalado (`lib/audit/planilha-xlsx.ts`); nenhuma dependência nova.
 *
 * A planilha sai no idioma de quem pede e na hora da EMPRESA (o fuso dela),
 * com o nome e o e-mail de cada pessoa — é isso que a torna legível fora da
 * tela. O nome vem do `auth.users` pelo cliente de serviço, uma leitura por
 * pessoa distinta (e só de quem é membro da organização), nunca por linha.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { comIdDaRequisicao, fail } from "@/lib/api/wrappers";
import { rotuloDoAcesso } from "@/lib/audit/acessos";
import { descreverAparelho } from "@/lib/audit/aparelho";
import {
  acessosQuerySchema,
  apresentarAcesso,
  consultaDeAcessos,
  podeVerIpInteiro,
  type LinhaDeAcessoNoBanco,
} from "@/lib/audit/consulta-de-acessos";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { gerarXlsx, TIPO_XLSX } from "@/lib/audit/planilha-xlsx";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FUSO_PADRAO, fusoValido } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";

/** `max_rows` do PostgREST: pedir mais devolve 1000 caladas (ver `../../export/route.ts`). */
const TAMANHO_DA_PAGINA = 1000;
const TETO_DO_EXPORT = 10_000;

async function nomesDasPessoas(
  organizationId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  if (ids.length === 0 || !isServiceRoleConfigured()) return nomes;
  try {
    const admin = createAdminClient();
    // Só quem é (ou foi) membro DESTA organização: o cliente de serviço não
    // filtra por RLS, e a lista de ids vem do log — a conferência é aqui.
    const { data: membros } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", organizationId)
      .in("user_id", [...ids]);
    const daOrg = new Set((membros ?? []).map((m: { user_id: string }) => m.user_id));
    await Promise.all(
      [...daOrg].map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        const u = data?.user;
        if (!u) return;
        const nome = (u.user_metadata?.full_name as string | undefined)?.trim();
        nomes.set(id, nome && u.email ? `${nome} <${u.email}>` : (nome ?? u.email ?? id));
      }),
    );
  } catch {
    /* sem os nomes, a planilha sai com o id — melhor que não sair */
  }
  return nomes;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", {
    requestId,
    resource: "audit",
    allowPlatformAdmin: "leitura",
  });
  if (!authz.ok) return authz.response;
  const idioma = authz.user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const parsed = acessosQuerySchema.safeParse({ ...params, limit: undefined, cursor: undefined });
  if (!parsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const q = parsed.data;
  const supabase = await createClient();

  const linhas: LinhaDeAcessoNoBanco[] = [];
  let total: number | null = null;
  let acabou = false;
  for (let pagina = 0; linhas.length < TETO_DO_EXPORT && !acabou; pagina++) {
    const ultima = linhas[linhas.length - 1];
    let query = consultaDeAcessos(supabase, authz.org.orgId, q, { contar: pagina === 0 });
    if (ultima) {
      query = query.or(
        `created_at.lt.${ultima.created_at},and(created_at.eq.${ultima.created_at},id.lt.${ultima.id})`,
      );
    }
    const pedaco = Math.min(TAMANHO_DA_PAGINA, TETO_DO_EXPORT - linhas.length);
    const { data, error, count } = await query.range(0, pedaco - 1);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    if (pagina === 0) total = count;
    const lote = (data ?? []) as unknown as LinhaDeAcessoNoBanco[];
    linhas.push(...lote);
    acabou = lote.length === 0 || (total !== null && linhas.length >= total);
  }

  const ipInteiro = podeVerIpInteiro(authz.org.role, authz.user.is_platform_admin && !authz.user.support);
  const pessoas = [...new Set(linhas.map((l) => l.actor_user_id).filter((v): v is string => !!v))];
  const nomes = await nomesDasPessoas(authz.org.orgId, pessoas);
  const fuso = authz.org.timezone && fusoValido(authz.org.timezone) ? authz.org.timezone : FUSO_PADRAO;
  const quando = new Intl.DateTimeFormat(tagDeIdioma(idioma), {
    timeZone: fuso,
    dateStyle: "short",
    timeStyle: "medium",
  });

  const xlsx = gerarXlsx(
    [t("Quando"), t("Pessoa"), t("Evento"), t("Aparelho"), t("Endereço IP")],
    linhas.map((bruta) => {
      const a = apresentarAcesso(bruta, ipInteiro);
      return [
        quando.format(new Date(a.created_at)),
        a.actor_user_id ? (nomes.get(a.actor_user_id) ?? a.actor_user_id) : "—",
        t(rotuloDoAcesso(a.action, a.metadata)),
        descreverAparelho(a.user_agent, t),
        a.ip,
      ];
    }),
    t("Acessos"),
  );

  // A planilha leva IP e aparelho de colegas: o GESTO fica registrado, como o
  // export de contatos. Nunca a pessoa filtrada — só se houve filtro.
  await audit({
    action: "audit.access_log_exported",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "audit",
    resourceId: null,
    requestId,
    metadata: {
      total: linhas.length,
      truncado: linhas.length >= TETO_DO_EXPORT,
      de: q.from ?? null,
      ate: q.to ?? null,
      filtrou_pessoa: !!q.actor_id,
      ip_inteiro: ipInteiro,
    },
  });

  const corpo = new ArrayBuffer(xlsx.byteLength);
  new Uint8Array(corpo).set(xlsx);
  return comIdDaRequisicao(
    new Response(corpo, {
      status: 200,
      headers: {
        "Content-Type": TIPO_XLSX,
        "Content-Disposition": `attachment; filename="acessos-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "X-Request-Id": requestId,
      },
    }),
    requestId,
  );
}
