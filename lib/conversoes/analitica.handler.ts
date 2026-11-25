/**
 * A venda e o lead novo para as plataformas de ANÁLISE — GA4 e TikTok.
 *
 * ─── Por que um consumidor à parte do envio principal ───────────────────────
 *
 * `envio.handler.ts` escolhe UMA plataforma pela atribuição do contato
 * (`ad_platform` = Meta ou Google) — é o anúncio que trouxe a pessoa, e a venda
 * volta para ele. As de análise não competem com essa escolha:
 *
 *   - o **GA4** é ferramenta de análise: recebe TODA venda (negócio ganho) e
 *     todo lead novo da organização que tem a conexão ligada, venha o contato
 *     de onde vier. O `client_id` é o `_ga` capturado quando existe; senão, o
 *     id estável por contato que o transporte deriva;
 *   - o **TikTok** recebe a venda e o lead de quem tem `ttclid` capturado (o
 *     clique do anúncio do TikTok), mesmo que a atribuição principal seja
 *     outra.
 *
 * Consumidor próprio (`conversoes.analitica`), e não um passo dentro do
 * principal, porque o `event_log` guarda o desfecho POR consumidor
 * (`consumed_by`): a retentativa de um não reprocessa o outro, e a falha da
 * Meta não segura o GA4 — nem o contrário.
 *
 * ─── O mesmo molde do principal ─────────────────────────────────────────────
 *
 *  - os MESMOS eventos: `lead.won` e `lead.stage_changed` (as duas portas do
 *    fechamento — o banco é a verdade, o `status` do payload é ignorado) e
 *    `lead.created` (o lead novo);
 *  - o MESMO livro-razão (`ad_conversion_dispatches`), uma linha por
 *    plataforma com a chave de `analitica.ts`; `sent` nunca é reenviado;
 *  - a MESMA física da falha: transitório → `retry` com `retry_at` (o dreno
 *    reagenda sem contar tentativa) e a linha `nova_tentativa_agendada`;
 *    permanente → `error` com `recusado_pela_plataforma`;
 *  - `event_mapping` da conexão decide o nome no fio; "Não enviar" pula sem
 *    linha — não é pendência, é decisão de quem configurou.
 *
 * ─── Quando uma linha vai para o livro-razão ────────────────────────────────
 *
 * Só quando a organização TEM a conexão daquela plataforma. Sem conexão, uma
 * linha por venda de toda organização que nunca ligou o GA4 seria só ruído. Com
 * a conexão pausada ou incompleta, a linha entra — é a pendência que a tela da
 * plataforma mostra ("as vendas continuam sendo registradas aqui").
 */
import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { lerCredencial } from "@/lib/plataformas-de-anuncio/credenciais";
import { identidadeDaLinha } from "@/lib/plataformas-de-anuncio/identidade-do-contato";
import {
  nomeNoFio,
  type PlataformaComMapeamento,
} from "@/lib/plataformas-de-anuncio/mapeamento-de-eventos";
import { transporteDe } from "@/lib/plataformas-de-anuncio/registry";
import type {
  ConversaoOffline,
  IdentidadeDoContato,
  ResultadoDeEnvio,
} from "@/lib/plataformas-de-anuncio/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { PLATAFORMAS_ANALITICAS, chaveAnalitica, type EventoAnalitico } from "./analitica";
import { lerRegistro, registraEnvio } from "./registro-de-envio";

const CONSUMER_KEY = "conversoes.analitica";

/** Backoff do transitório — o mesmo do envio principal. */
const ESPERA_PADRAO_MS = 5 * 60 * 1000;

type Admin = ReturnType<typeof createAdminClient>;

/** O desfecho de UMA plataforma, antes de virar o resultado do consumidor. */
type Desfecho =
  | { tipo: "ok"; detalhe: string }
  | { tipo: "skipped"; detalhe: string }
  | { tipo: "retry"; detalhe: string; emMs: number };

interface LeadLido {
  id: string;
  status: string;
  value_cents: number | null;
  currency: string | null;
  closed_at: string | null;
  created_at: string | null;
  contact_id: string | null;
  source_metadata: unknown;
}

interface ContatoLido {
  email: string | null;
  phone_number: string | null;
  source_metadata: unknown;
}

function eventoDaLinha(row: EventRow): EventoAnalitico | null {
  if (row.event_type === "lead.created") return "LeadSubmitted";
  if (row.event_type === "lead.won" || row.event_type === "lead.stage_changed") return "Purchase";
  return null;
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * A identidade do contato, completada pelo que o NEGÓCIO trouxe. O formulário
 * grava `ttclid`/`_ga` no `source_metadata` do contato só quando o cria; quem
 * já era contato recebe as chaves no card que o envio abriu — é o mesmo
 * envio, e perdê-las ali deixaria de fora justamente quem voltou por anúncio.
 */
export function identidadeParaAnalise(
  lead: Pick<LeadLido, "id" | "contact_id" | "source_metadata">,
  contato: ContatoLido | null,
): IdentidadeDoContato {
  const contatoId = lead.contact_id ?? lead.id;
  const doContato = identidadeDaLinha(contatoId, contato ?? {});
  const doNegocio = identidadeDaLinha(contatoId, { source_metadata: lead.source_metadata });
  return {
    contatoId,
    email: doContato.email,
    gaClientId: doContato.gaClientId ?? doNegocio.gaClientId,
    ttclid: doContato.ttclid ?? doNegocio.ttclid,
  };
}

/** Uma plataforma, do livro-razão ao fio. Nunca lança por desfecho de envio. */
async function enviarPara(
  admin: Admin,
  row: EventRow,
  plataforma: PlataformaComMapeamento,
  evento: EventoAnalitico,
  lead: LeadLido,
  contato: ContatoLido | null,
): Promise<Desfecho> {
  const identidade = identidadeParaAnalise(lead, contato);
  if (plataforma === "tiktok" && !identidade.ttclid) {
    return { tipo: "skipped", detalhe: `${plataforma}: sem_ttclid` };
  }
  // Atribuição principal JÁ é desta plataforma: o envio principal a reporta,
  // e mandar de novo por aqui contaria a mesma venda duas vezes.
  if (objeto(contato?.source_metadata).ad_platform === plataforma) {
    return { tipo: "skipped", detalhe: `${plataforma}: coberto_pelo_envio_principal` };
  }

  // A conexão ANTES do livro-razão: a organização que não usa a plataforma
  // (o padrão) sai aqui com uma leitura só, sem tocar no livro.
  const credencial = await lerCredencial(admin, row.organization_id, plataforma, {
    exigirAcaoDeVenda: false,
  });
  if (!credencial.ok && credencial.motivo === "sem_conexao") {
    return { tipo: "skipped", detalhe: `${plataforma}: sem_conexao` };
  }

  const chave = chaveAnalitica(plataforma, evento);
  const registro = await lerRegistro(admin, row.organization_id, lead.id, chave);
  if (registro?.status === "sent") return { tipo: "skipped", detalhe: `${plataforma}: ja_enviada` };

  const valorCentavos =
    evento === "Purchase" && lead.value_cents !== null && lead.value_cents > 0
      ? lead.value_cents
      : null;
  const moeda = lead.currency ?? "BRL";
  const ocorridoEm =
    evento === "Purchase"
      ? (lead.closed_at ?? row.created_at ?? new Date().toISOString())
      : (lead.created_at ?? row.created_at ?? new Date().toISOString());
  const eventoId = `${lead.id}:${evento}`;

  const registra = (status: "sent" | "skipped" | "error", motivo: string | null, detalhe?: string) =>
    registraEnvio(admin, {
      organizationId: row.organization_id,
      leadId: lead.id,
      plataforma,
      evento: chave,
      status,
      motivo,
      eventoId,
      valorCentavos,
      moeda: valorCentavos !== null ? moeda : null,
      detalhe: detalhe ?? null,
      ocorridoEm: new Date(ocorridoEm).toISOString(),
    });

  if (!credencial.ok) {
    if (credencial.motivo === "leitura_indisponivel") {
      return {
        tipo: "retry",
        detalhe: `${plataforma}: leitura da conexão indisponível`,
        emMs: ESPERA_PADRAO_MS,
      };
    }
    await registra("skipped", credencial.motivo);
    return { tipo: "skipped", detalhe: `${plataforma}: ${credencial.motivo}` };
  }

  // "Não enviar" no mapeamento: decisão de quem configurou, não pendência.
  if (!nomeNoFio(plataforma, credencial.credencial.mapeamento, evento)) {
    return { tipo: "skipped", detalhe: `${plataforma}: evento_desligado` };
  }

  const transporte = transporteDe(plataforma);
  if (!transporte) {
    await registra("skipped", "plataforma_sem_transporte");
    return { tipo: "skipped", detalhe: `${plataforma}: plataforma_sem_transporte` };
  }

  const telefone = contato?.phone_number ? contato.phone_number.replace(/\D/g, "") || null : null;
  const conversao: ConversaoOffline = {
    organizationId: row.organization_id,
    leadId: lead.id,
    evento,
    eventoId,
    ocorridoEm: new Date(ocorridoEm),
    // Vazio: quem diz o clique aqui é a identidade (o `ttclid` dela).
    cliqueDeOrigem: "",
    telefone,
    moeda,
    valorCentavos,
    eventoNaPlataforma: null,
    identidadeDoContato: identidade,
  };

  let resultado: ResultadoDeEnvio;
  try {
    resultado = await transporte.enviar(credencial.credencial, conversao);
  } catch (err) {
    resultado = {
      tipo: "transitorio",
      detalhe: err instanceof Error ? err.message : "falha no envio",
    };
  }

  if (resultado.tipo === "ok") {
    if (credencial.credencial.testEventCode) {
      await registra(
        "skipped",
        "evento_de_teste",
        "Evento recebido em modo de teste. Desative o teste antes de reportar conversões reais.",
      );
      return { tipo: "skipped", detalhe: `${plataforma}: evento_de_teste` };
    }
    await registra("sent", null, resultado.detalhe);
    return { tipo: "ok", detalhe: `${plataforma}: conversão reportada` };
  }
  // Nenhum dos dois transportes devolve protocolo: "processando" aqui é tratado
  // como o transitório que é — esperar e perguntar de novo.
  if (resultado.tipo === "transitorio" || resultado.tipo === "processando") {
    await registra("skipped", "nova_tentativa_agendada", resultado.detalhe);
    return {
      tipo: "retry",
      detalhe: `${plataforma}: ${resultado.detalhe}`,
      emMs:
        (resultado.tipo === "transitorio" ? resultado.tentarEmMs : undefined) ?? ESPERA_PADRAO_MS,
    };
  }
  await registra("error", "recusado_pela_plataforma", resultado.detalhe);
  return { tipo: "skipped", detalhe: `${plataforma}: recusado_pela_plataforma` };
}

export async function processarConversaoAnalitica(row: EventRow): Promise<HandlerResult> {
  const evento = eventoDaLinha(row);
  if (!evento) return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "outro_evento" };
  if (!row.entity_id) return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "sem_entidade" };

  const admin = createAdminClient();
  const retry = (detail: string, emMs = ESPERA_PADRAO_MS): HandlerResult => ({
    consumer_key: CONSUMER_KEY,
    status: "retry",
    retry_at: new Date(Date.now() + emMs).toISOString(),
    detail,
  });

  // ⚠️ Filtro de organização junto do id: o client é service-role.
  const { data, error } = await admin
    .from("crm_leads")
    .select("id, status, value_cents, currency, closed_at, created_at, contact_id, source_metadata")
    .eq("id", row.entity_id)
    .eq("organization_id", row.organization_id)
    .maybeSingle();
  if (error) return retry(`leitura do lead falhou: ${error.message}`);
  if (!data) return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "lead_inexistente" };
  const lead = data as LeadLido;

  // O banco é a verdade, não o payload (ver `envio.handler.ts`).
  if (evento === "Purchase" && lead.status !== "won") {
    return { consumer_key: CONSUMER_KEY, status: "skipped", detail: "nao_e_ganho" };
  }

  let contato: ContatoLido | null = null;
  if (lead.contact_id) {
    const lido = await admin
      .from("contacts")
      .select("email, phone_number, source_metadata")
      .eq("id", lead.contact_id)
      .eq("organization_id", row.organization_id)
      .maybeSingle();
    if (lido.error) return retry(`leitura do contato falhou: ${lido.error.message}`);
    contato = (lido.data as ContatoLido | null) ?? null;
  }

  // Cada plataforma isolada: a falha de uma não muda o desfecho da outra, e
  // a que já foi entregue é pulada pelo livro-razão na retentativa.
  const desfechos: Desfecho[] = [];
  for (const plataforma of PLATAFORMAS_ANALITICAS) {
    try {
      desfechos.push(await enviarPara(admin, row, plataforma, evento, lead, contato));
    } catch (err) {
      desfechos.push({
        tipo: "retry",
        detalhe: `${plataforma}: ${err instanceof Error ? err.message : "falha ao registrar"}`,
        emMs: ESPERA_PADRAO_MS,
      });
    }
  }

  const detail = desfechos.map((d) => d.detalhe).join("; ");
  const retentar = desfechos.filter((d): d is Extract<Desfecho, { tipo: "retry" }> => d.tipo === "retry");
  if (retentar.length > 0) return retry(detail, Math.min(...retentar.map((d) => d.emMs)));
  if (desfechos.some((d) => d.tipo === "ok")) {
    return { consumer_key: CONSUMER_KEY, status: "ok", detail };
  }
  return { consumer_key: CONSUMER_KEY, status: "skipped", detail };
}

async function handle(row: EventRow): Promise<HandlerResult> {
  try {
    return await processarConversaoAnalitica(row);
  } catch {
    return {
      consumer_key: CONSUMER_KEY,
      status: "retry",
      retry_at: new Date(Date.now() + ESPERA_PADRAO_MS).toISOString(),
      detail: "Falha ao ler ou registrar a conversão de análise. Nova tentativa agendada.",
    };
  }
}

export const conversaoAnaliticaHandler: EventHandler = {
  key: CONSUMER_KEY,
  // Sai para fora (rede de terceiro): organização parada não fala.
  naOrgParada: "pula",
  events: ["lead.won", "lead.stage_changed", "lead.created"],
  handle,
};
