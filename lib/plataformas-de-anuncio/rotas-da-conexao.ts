/**
 * O corpo das rotas `/api/v1/plataformas-de-anuncio/{ga4,tiktok}` (9488).
 *
 * As duas plataformas têm a mesma forma de conexão, então o handler é um só e
 * as rotas são cascas que fixam o slug. A guarda de suporte
 * (`requireSupportWrite`) fica NA ROTA, antes de chamar daqui: é lá que o gate
 * `tests/unit/suporte-cobertura-de-efeitos.test.ts` a procura.
 *
 * Papel: `admin` (com super-admin), o mesmo piso da tela de Conversões e da
 * conexão da Meta — o segredo escreve na conta de mídia/análise da empresa.
 * MFA é cobrado pelo próprio `requireRole`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import {
  lerEstadoDaConexaoDireta,
  schemaDaConexao,
} from "./conexao-direta";
import { lerMapeamento, type PlataformaComMapeamento } from "./mapeamento-de-eventos";
import { transporteDe } from "./registry";

const OPCOES = { resource: "ad_platform_connections", allowPlatformAdmin: true } as const;

export async function lerConexao(plataforma: PlataformaComMapeamento): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, ...OPCOES });
  if (!authz.ok) return authz.response;
  try {
    const estado = await lerEstadoDaConexaoDireta(createAdminClient(), authz.org.orgId, plataforma);
    return ok(estado, { requestId });
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : "leitura falhou", 500, {
      requestId,
    });
  }
}

export async function gravarConexao(
  req: NextRequest,
  plataforma: PlataformaComMapeamento,
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, ...OPCOES });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const corpo = await req.json().catch(() => undefined);
  if (corpo === undefined) return fail("validation_failed", t("Corpo inválido."), 422, { requestId });
  const parsed = schemaDaConexao(plataforma).safeParse(corpo);
  if (!parsed.success) {
    return fail("validation_failed", t("Configuração inválida."), 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const entrada = parsed.data;
  const admin = createAdminClient();
  const orgId = authz.org.orgId;

  let anterior;
  try {
    anterior = await lerEstadoDaConexaoDireta(admin, orgId, plataforma);
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : "leitura falhou", 500, {
      requestId,
    });
  }
  // Ligar sem nunca ter gravado o segredo deixaria a conexão "ativa" e o
  // livro-razão acumulando `credencial_incompleta`.
  if (!entrada.segredo && !anterior.temSegredo) {
    return fail("validation_failed", t("Preencha o identificador e o token para poder salvar."), 422, {
      details: { segredo: ["obrigatorio"] },
      requestId,
    });
  }

  const valores: Record<string, unknown> = {
    organization_id: orgId,
    platform: plataforma,
    dataset_id: entrada.identificador,
    test_event_code: plataforma === "tiktok" ? entrada.test_event_code?.trim() || null : null,
    enabled: entrada.enabled,
    event_mapping: entrada.eventos,
    updated_by: authz.user.id,
  };
  if (entrada.segredo) {
    // NUNCA em claro: sem a cifra, recusa (mesma decisão da Meta).
    const cifrado = await encryptWebhookSecret(admin, entrada.segredo);
    if (!cifrado) {
      return fail(
        "cifra_indisponivel",
        t(
          "Esta instalação está sem a chave mestra de criptografia, e o token não foi gravado. Quem instalou o sistema precisa configurá-la — refazer o cadastro aqui não resolve.",
        ),
        503,
        { requestId },
      );
    }
    valores.access_token_encrypted = cifrado;
  }

  // `upsert` e não `update`: quem nunca conectou não tem linha, e um `update`
  // casaria zero linhas devolvendo sucesso.
  const { error } = await admin
    .from("ad_platform_connections")
    .upsert(valores, { onConflict: "organization_id,platform" });
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: "ad_platform_connection.updated",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "ad_platform_connections",
    resourceId: null,
    requestId,
    metadata: {
      platform: plataforma,
      enabled: entrada.enabled,
      // O identificador é público (vai no HTML do site); o segredo, nem aqui.
      dataset_id: entrada.identificador,
      token_trocado: Boolean(entrada.segredo),
      em_teste: Boolean(valores.test_event_code),
      eventos: entrada.eventos,
    },
  });

  return ok(
    {
      ...anterior,
      conectada: true,
      identificador: entrada.identificador,
      temSegredo: true,
      habilitada: entrada.enabled,
      testEventCode: (valores.test_event_code as string | null) ?? null,
      mapeamento: lerMapeamento(plataforma, entrada.eventos),
    },
    { requestId },
  );
}

/**
 * "Testar conexão": fala com a plataforma pelo caminho que NÃO conta conversão
 * (ver `testarConexao` de cada transporte). Funciona com o envio pausado — é
 * justamente antes de ligar que se quer saber se a credencial vale.
 */
export async function testarConexao(plataforma: PlataformaComMapeamento): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, ...OPCOES });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const admin = createAdminClient();
  const orgId = authz.org.orgId;

  const { data, error } = await admin
    .from("ad_platform_connections")
    .select("dataset_id, access_token_encrypted, test_event_code")
    .eq("organization_id", orgId)
    .eq("platform", plataforma)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const linha = data as {
    dataset_id: string | null;
    access_token_encrypted: string | null;
    test_event_code: string | null;
  } | null;
  if (!linha?.dataset_id || !linha.access_token_encrypted) {
    return fail("state_conflict", t("Preencha o identificador e o token para poder salvar."), 409, {
      requestId,
    });
  }
  const segredo = await decryptWebhookSecret(admin, linha.access_token_encrypted);
  if (!segredo) {
    return fail(
      "cifra_indisponivel",
      t(
        "Esta instalação está sem a chave mestra de criptografia, e o token não foi gravado. Quem instalou o sistema precisa configurá-la — refazer o cadastro aqui não resolve.",
      ),
      503,
      { requestId },
    );
  }

  const transporte = transporteDe(plataforma);
  if (!transporte?.testarConexao) {
    // Inalcançável hoje (GA4 e TikTok têm teste); o código basta para depurar.
    return fail("not_found", "testarConexao ausente no transporte", 404, { requestId });
  }
  const resultado = await transporte.testarConexao({
    datasetId: linha.dataset_id,
    accessToken: segredo,
    testEventCode: plataforma === "tiktok" ? linha.test_event_code : null,
  });
  const passou = resultado.tipo === "ok";

  void audit({
    action: "ad_platform_connection.tested",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "ad_platform_connections",
    resourceId: null,
    requestId,
    metadata: { platform: plataforma, resultado: resultado.tipo },
  });

  return ok(
    {
      passou,
      // O GA4 só valida o formato; a tela precisa saber disso para não
      // prometer que o segredo foi conferido.
      apenasFormato: passou && resultado.detalhe === "validacao_de_formato",
      detalhe: passou ? null : "detalhe" in resultado ? resultado.detalhe : null,
    },
    { requestId },
  );
}
