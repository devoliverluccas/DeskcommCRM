import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * /api/v1/conversations/[id]/media
 *
 * POST — upload outbound (multipart).
 * Storage-first: sobe pro bucket whatsapp-media; o envio da mensagem
 * referencia o storage_path (o WAHA recebe signed URL, nunca base64).
 *
 * GET — a GALERIA da conversa: as mensagens com mídia, mais novas primeiro,
 * paginadas por cursor (ver `GET` abaixo).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { lerCorpoComTeto } from "@/lib/api/corpo-com-teto";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { requireRole } from "@/lib/auth/require-role";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { extFromMime, MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { nomeDeArquivoLimpo, nomeOriginalDaMensagem } from "@/lib/messaging/media/nome-de-arquivo";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";
import { transcodificarNotaDeVoz } from "@/lib/messaging/media/voice-transcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET — galeria de mídias da conversa
// ---------------------------------------------------------------------------

/**
 * O filtro da tela → o `messages.type` do banco. Figurinha fica de fora de
 * propósito: é reação, não arquivo que alguém volta para procurar.
 */
const TIPO_DO_FILTRO = {
  imagem: "image",
  video: "video",
  documento: "document",
  audio: "audio",
} as const;

const consultaDaGaleria = z.object({
  tipo: z.enum(["imagem", "video", "documento", "audio"]).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

/**
 * O item da galeria. A mídia em si é servida por `GET /api/v1/messages/[id]/media`.
 * Espelho no cliente: `MidiaDaConversa` em `hooks/inbox/useMidiasDaConversa.ts`.
 */
interface MidiaDaConversa {
  id: string;
  type: string;
  direction: "inbound" | "outbound";
  media_mime: string | null;
  media_size_bytes: number | null;
  /** Só para a extensão do documento (`DocumentCard`); nunca é URL. */
  media_storage_path: string | null;
  /** Nome original do arquivo, quando a ingestão o guardou (#2613). */
  nome: string | null;
  sent_at: string;
}

const COLUNAS_DA_GALERIA =
  "id, type, direction, media_mime, media_size_bytes, media_storage_path, metadata, sent_at, created_at";

/**
 * O cursor tem a MESMA forma do de `GET .../messages` (sent_at, created_at,
 * id) — o desempate pela chegada vale aqui pelo mesmo motivo: três fotos no
 * mesmo segundo. Os valores entram por interpolação no `.or()`, então só passa
 * o formato que o servidor emite (UUID e instante ISO-8601).
 */
const UUID_DO_CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANTE_DO_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

interface CursorDaGaleria {
  sent_at: string;
  created_at: string;
  id: string;
}

function codificarCursor(c: CursorDaGaleria): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodificarCursor(cru: string): CursorDaGaleria | null {
  try {
    const c = JSON.parse(Buffer.from(cru, "base64url").toString("utf8")) as Partial<CursorDaGaleria>;
    if (typeof c.id !== "string" || !UUID_DO_CURSOR.test(c.id)) return null;
    if (typeof c.sent_at !== "string" || !INSTANTE_DO_CURSOR.test(c.sent_at)) return null;
    if (typeof c.created_at !== "string" || !INSTANTE_DO_CURSOR.test(c.created_at)) return null;
    return { id: c.id, sent_at: c.sent_at, created_at: c.created_at };
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/conversations/[id]/media?tipo=imagem|video|documento|audio&cursor=&limit=
 *
 * QUEM VÊ: `viewer`+ (quem lê a conversa lê os anexos dela). A rota está em
 * `PUBLIC_PATHS` por causa do upload por token, então o proxy NÃO decide aqui:
 * quem decide é o `requireRole` abaixo, que só reconhece sessão.
 *
 * A CONVERSA PRECISA SER VISÍVEL A ESTA PESSOA: a leitura é com o client da
 * SESSÃO (a RLS de `conversations` e de `messages` decide) e ainda filtra a
 * organização ATIVA explicitamente. Conversa de contato PESSOAL dá o mesmo 404
 * mudo do histórico (`listMessagesHandler`) — a galeria não pode ser a porta
 * lateral para o que o histórico recusa.
 *
 * O QUE ENTRA: mensagem do tipo pedido com arquivo (guardado ou ainda no canal
 * — o mesmo `hasMedia` do balão), fora a apagada pelo autor e a oculta no CRM,
 * que o balão também não oferece para baixar. Sem URL assinada: o arquivo sai
 * por `GET /api/v1/messages/[id]/media`, que confere o acesso de novo.
 *
 * Só leitura ⇒ sem auditoria.
 */
export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversation_media" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const { id: conversationId } = await ctx.params;
  if (!z.uuid().safeParse(conversationId).success) {
    return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
  }

  const params = new URL(req.url).searchParams;
  const consulta = consultaDaGaleria.safeParse({
    tipo: params.get("tipo") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!consulta.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      details: consulta.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const { tipo, cursor, limit } = consulta.data;
  const cursorLido = cursor ? decodificarCursor(cursor) : null;
  if (cursor && !cursorLido) {
    return fail("invalid_cursor", t("Cursor inválido."), 400, { requestId });
  }

  const supabase = await createClient();

  const { data: conversa, error: erroDaConversa } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroDaConversa) return fail("internal_error", t("Erro ao validar conversa."), 500, { requestId });
  if (!conversa) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const contatoId = (conversa as { contact_id?: string | null }).contact_id ?? null;
  if (contatoId) {
    const { data: contato } = await supabase
      .from("contacts")
      .select("is_personal")
      .eq("id", contatoId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if ((contato as { is_personal?: boolean } | null)?.is_personal === true) {
      return fail("not_found", t("Conversa não encontrada."), 404, { requestId });
    }
  }

  const tipos = tipo ? [TIPO_DO_FILTRO[tipo]] : Object.values(TIPO_DO_FILTRO);
  let query = supabase
    .from("messages")
    .select(COLUNAS_DA_GALERIA)
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId)
    .in("type", tipos)
    .or("media_storage_path.not.is.null,media_url.not.is.null")
    .is("revoked_at", null)
    .is("metadata->crm_hidden_at", null)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursorLido) {
    const c = cursorLido;
    query = query.or(
      `sent_at.lt.${c.sent_at},` +
        `and(sent_at.eq.${c.sent_at},created_at.lt.${c.created_at}),` +
        `and(sent_at.eq.${c.sent_at},created_at.eq.${c.created_at},id.lt.${c.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    return fail("internal_error", t("Não foi possível carregar as mídias."), 500, { requestId });
  }

  type Linha = MidiaDaConversa & { metadata: unknown; created_at: string };
  const linhas = (data ?? []) as unknown as Linha[];
  const temMais = linhas.length > limit;
  const pagina = temMais ? linhas.slice(0, limit) : linhas;
  const ultima = pagina[pagina.length - 1];
  const proximo =
    temMais && ultima
      ? codificarCursor({ sent_at: ultima.sent_at, created_at: ultima.created_at, id: ultima.id })
      : null;

  const itens: MidiaDaConversa[] = pagina.map((m) => ({
    id: m.id,
    type: m.type,
    direction: m.direction,
    media_mime: m.media_mime,
    media_size_bytes: m.media_size_bytes,
    media_storage_path: m.media_storage_path,
    nome: nomeOriginalDaMensagem(m.metadata),
    sent_at: m.sent_at,
  }));

  return ok(itens, { requestId, meta: { cursor: proximo, has_more: temMais } });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: conversationId } = await ctx.params;

  // spec 13 §4: escrita é agent+ (viewer é read-only). Esta rota era a ÚNICA de
  // escrita em conversations/[id]/* sem o gate — e como a policy de SELECT deixa
  // o viewer enxergar toda conversa da org, o papel mais fraco do tenant tinha
  // escrita irrestrita no bucket (50 MB por arquivo, com service_role). A irmã
  // claim/route.ts:35 é o modelo literal.
  // Sessão de navegador OU token de servidor: é o primeiro passo do envio de
  // mídia, e quem envia por token precisa subir o arquivo antes de mandar.
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "conversation_media",
    role: "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  // Rota que aceita Bearer (PUBLIC_PATHS): o que não for contado aqui não é
  // contado em lugar nenhum — mesmo teto das irmãs que já aplicam sobre
  // resolveAuthDual. Upstream de mídia é exatamente o tipo de escrita em laço
  // que o teto existe para conter (cada upload sobe arquivo de até 50 MB).
  const teto = await tetoDeEscritaDoToken(authz, "conversation_media", requestId);
  if (teto) return teto;
  // O ramo do token não carrega idioma de usuário: cai no padrão do produto.
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);
  const activeOrg = { orgId: authz.organizationId };
  // O client vem de `authz`, não de `createClient()`: no ramo do token NÃO HÁ
  // cookie de sessão, então um client de sessão seria anônimo e a RLS devolveria
  // zero linha — a conversa existente viraria 404 e o upload por token, que é a
  // capacidade que este PR entrega, nunca funcionaria. Quem protege aqui é o
  // filtro explícito de `organization_id` logo abaixo, que vale nos dois ramos.
  const supabase = authz.supabase;

  // RLS (no ramo da sessão) + filtro explícito: a conversa precisa ser da org ativa.
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  if (convErr) return fail("internal_error", t("Erro ao validar conversa."), 500, { requestId });
  if (!conv) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  // Guard de DoS: o corpo nunca passa do teto, nem sem Content-Length. 1MB de
  // slack pro overhead de multipart; o check autoritativo continua o file.size.
  const corpo = await lerCorpoComTeto(req, MAX_MEDIA_BYTES + 1_048_576, {
    requestId,
    idioma: authz.idioma ?? IDIOMA_PADRAO,
    acimaDoTeto: t("Arquivo acima de 50MB."),
  });
  if (!corpo.ok) return corpo.response;
  const form = await corpo.corpo.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return fail("validation_failed", t("Campo 'file' (multipart) obrigatório."), 422, { requestId });
  }

  const mime = file.type || "application/octet-stream";
  const verdict = validateOutboundMedia(mime, file.size);
  if (!verdict.ok) {
    const status = verdict.code === "payload_too_large" ? 413 : verdict.code === "unsupported_media_type" ? 415 : 422;
    return fail(verdict.code, verdict.message, status, { requestId });
  }

  // A marca do gravador do composer (F2): "isto é nota de voz". Só com ela o
  // AAC do iPhone vira opus — sem ela, um m4a enviado por token segue intacto.
  const marca = z.literal("1").nullable().safeParse(form?.get("nota_de_voz") ?? null);
  if (!marca.success) {
    return fail("validation_failed", t("Campo 'nota_de_voz' inválido."), 422, { requestId });
  }
  const notaDeVoz = marca.data === "1";

  const bruto = Buffer.from(await file.arrayBuffer());

  // Nota de voz gravada no browser sai em `webm` (o Chrome não grava ogg), e o
  // canal oficial recusa depois de aceitar — `131053 Media upload error`, que
  // culpa a URL quando o problema é o container. Converter AQUI faz todo canal
  // receber um arquivo válido, e o mesmo áudio poder ser reenviado depois sem
  // repetir o trabalho. Falha devolve o original: o canal que converte sozinho
  // continua funcionando como sempre.
  const audio = await transcodificarNotaDeVoz({ buffer: bruto, mime, notaDeVoz });
  const mimeFinal = audio.mime;
  const buffer = audio.buffer;

  const storagePath = `${activeOrg.orgId}/${conversationId}/out-${randomUUID()}.${extFromMime(mimeFinal)}`;
  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from("whatsapp-media")
    .upload(storagePath, buffer, { contentType: mimeFinal, upsert: false });
  if (upErr) {
    console.error("[conversations.media] upload failed", upErr.message);
    return fail("internal_error", t("Erro ao subir o arquivo."), 500, { requestId });
  }

  return ok(
    {
      storage_path: storagePath,
      // O nome como a pessoa o escolheu (#4457). O caminho acima é aleatório de
      // propósito; sem devolver o original aqui, o envio só tinha o basename
      // para mandar ao WhatsApp — e o cliente recebia `out-3f9a2b.pdf`. Lido do
      // `File`, que é a última ponta que ainda o conhece, e passado pela mesma
      // guarda da ingestão (`nomeDeArquivoLimpo`: sem invisíveis, com teto).
      media_filename: nomeDeArquivoLimpo(file.name),
      // O mime e o tamanho do arquivo QUE FOI GUARDADO, não os que chegaram.
      // Devolver o original seria mandar o canal buscar um `webm` que já não
      // existe — o mesmo defeito, um passo adiante.
      media_mime: mimeFinal,
      media_size_bytes: buffer.length,
      kind: verdict.kind,
    },
    { requestId },
  );
}
