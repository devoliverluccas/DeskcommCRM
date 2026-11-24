/**
 * Nó "Webhook" do fluxo de mensagens (4.3) — avisa um sistema de fora e segue.
 *
 * ─── As quatro regras ─────────────────────────────────────────────────────────
 *
 * 1. NUNCA SEGURA O FLUXO. Prazo curto (5 s, teto 10 s) e qualquer falha —
 *    rede, status não-2xx, prazo, URL recusada, segredo indisponível — vira o
 *    desfecho `erro`, e o fluxo segue pela saída "Erro". Nenhum retry aqui: o
 *    tick do motor não pode esperar backoff, e quem recebe deduplica pelo id da
 *    entrega (que é estável por passo).
 * 2. NUNCA CHAMA REDE INTERNA. A URL passa pelas MESMAS duas cercas do webhook
 *    das automações: a textual (`assertSafeOutboundUrl`) e a que resolve o DNS
 *    e julga o IP (`assertDestinoResolvidoSeguro`). Redirecionamento não é
 *    seguido (`redirect: "manual"`): um 302 para `169.254.169.254` contornaria
 *    as duas.
 * 3. SEMPRE ASSINADO. HMAC SHA-256 com o SEGREDO DO FLUXO, no mesmo formato do
 *    webhook das automações (`t=<ts>,v1=<hex>` sobre `<ts>.<entrega>.<corpo>`),
 *    para que quem já confere um confira o outro com o mesmo código. Sem
 *    segredo, não sai — mandar sem assinatura ensinaria o receptor a aceitar
 *    qualquer coisa.
 * 4. O SEGREDO NÃO MORA NO GRAFO. O grafo é exportável (arquivo de fluxo) e
 *    legível por quem só vê; segredo ali vazaria na primeira exportação. Ele é
 *    DERIVADO: HMAC(`INTERNAL_SECRET`, organização + fluxo). Não ocupa coluna,
 *    não precisa de migration, é o mesmo em todas as versões do fluxo e muda
 *    junto quando a instalação troca o `INTERNAL_SECRET`. Quem administra o
 *    fluxo o vê na tela (`GET /api/v1/ai/followup-flows/:id/webhook-secret`).
 */
import { createHmac } from "node:crypto";

import { assertDestinoResolvidoSeguro } from "@/lib/automation/outbound-ip";
import { assertSafeOutboundUrl } from "@/lib/automation/outbound-url";
import { uuidV5 } from "@/lib/automation/actions/call-webhook";
import { WEBHOOK_TIMEOUT_PADRAO_MS } from "./graph-schema";

/** O tipo do evento no cabeçalho e no corpo. Contrato de fio: não renomear. */
export const EVENTO_DO_WEBHOOK_DO_FLUXO = "flow.webhook";

/** Namespace do id da entrega. NUNCA TROCAR (o receptor deduplica por ele). */
const NAMESPACE_DA_ENTREGA_DO_FLUXO = "5b7f3c0e-2d1a-4c8e-9f60-1a2b3c4d5e6f";

/** Nomes neutros (instalação de marca própria não manda a marca de origem). */
export const CABECALHOS_DO_WEBHOOK_DO_FLUXO = {
  evento: "X-Webhook-Event",
  entrega: "X-Webhook-Delivery",
  carimbo: "X-Webhook-Timestamp",
  assinatura: "X-Webhook-Signature",
} as const;

/**
 * O segredo do fluxo. Lança quando a instalação não tem `INTERNAL_SECRET` —
 * quem chama transforma isso em `erro` (regra 3: sem segredo, não sai).
 */
export function segredoDoWebhookDoFluxo(
  organizationId: string,
  pointerId: string,
  raiz: string | undefined = process.env.INTERNAL_SECRET,
): string {
  if (!raiz || raiz.trim() === "") throw new Error("segredo_do_fluxo_indisponivel");
  return createHmac("sha256", raiz).update(`fluxo-webhook:v1:${organizationId}:${pointerId}`).digest("hex");
}

/** `t=<ts>,v1=<hex>` — HMAC SHA-256 de `<ts>.<entrega>.<corpo>`. */
export function assinarWebhookDoFluxo(segredo: string, carimbo: number, entrega: string, corpo: string): string {
  const v1 = createHmac("sha256", segredo).update(`${carimbo}.${entrega}.${corpo}`).digest("hex");
  return `t=${carimbo},v1=${v1}`;
}

/** Id da ENTREGA: estável por (inscrição, nó, passo) — o replay do tick repete o id. */
export function idDaEntregaDoFluxo(enrollmentId: string, nodeId: string, passo: number): string {
  return uuidV5(`${enrollmentId}:${nodeId}:${passo}`, NAMESPACE_DA_ENTREGA_DO_FLUXO);
}

export interface ContextoDoWebhookDoFluxo {
  organization_id: string;
  flow: { pointer_id: string; version_id: string; node_id: string; enrollment_id: string };
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    tags: string[];
  } | null;
  conversation: { id: string } | null;
  lead: { id: string; title: string | null; stage_id: string | null; pipeline_id: string | null } | null;
}

export type DesfechoDoWebhook = { resultado: "ok"; status: number } | { resultado: "erro"; motivo: string };

export interface ChamadaDoWebhook {
  url: string;
  timeoutMs?: number;
  segredo: string;
  entrega: string;
  contexto: ContextoDoWebhookDoFluxo;
  agora?: () => Date;
  /** Injetável nos testes; a produção usa o `fetch` global. */
  fetchImpl?: typeof fetch;
  /** Só os testes pulam as cercas de rede (o servidor de teste é local). */
  pularCercaDeRede?: boolean;
}

/**
 * Faz a chamada e devolve o desfecho. NUNCA lança: o motor decide a saída pelo
 * desfecho, e uma exceção aqui viraria backoff do tick — o fluxo parado que a
 * regra 1 proíbe.
 */
export async function chamarWebhookDoFluxo(c: ChamadaDoWebhook): Promise<DesfechoDoWebhook> {
  const url = c.url.trim();
  try {
    if (!c.pularCercaDeRede) {
      assertSafeOutboundUrl(url);
      await assertDestinoResolvidoSeguro(new URL(url).hostname);
    }
  } catch (err) {
    return { resultado: "erro", motivo: (err instanceof Error ? err.message : String(err)).slice(0, 120) };
  }
  const agora = (c.agora ?? (() => new Date()))();
  const carimbo = Math.floor(agora.getTime() / 1000);
  const corpo = JSON.stringify({
    event: EVENTO_DO_WEBHOOK_DO_FLUXO,
    delivery_id: c.entrega,
    occurred_at: agora.toISOString(),
    data: c.contexto,
  });
  const prazo = Math.min(c.timeoutMs ?? WEBHOOK_TIMEOUT_PADRAO_MS, 10_000);
  try {
    const res = await (c.fetchImpl ?? fetch)(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        [CABECALHOS_DO_WEBHOOK_DO_FLUXO.evento]: EVENTO_DO_WEBHOOK_DO_FLUXO,
        [CABECALHOS_DO_WEBHOOK_DO_FLUXO.entrega]: c.entrega,
        [CABECALHOS_DO_WEBHOOK_DO_FLUXO.carimbo]: String(carimbo),
        [CABECALHOS_DO_WEBHOOK_DO_FLUXO.assinatura]: assinarWebhookDoFluxo(c.segredo, carimbo, c.entrega, corpo),
      },
      body: corpo,
      signal: AbortSignal.timeout(prazo),
    });
    if (res.status >= 200 && res.status < 300) return { resultado: "ok", status: res.status };
    return { resultado: "erro", motivo: `http_${res.status}` };
  } catch (err) {
    const nome = err instanceof Error ? err.name : "";
    return {
      resultado: "erro",
      motivo: nome === "TimeoutError" || nome === "AbortError" ? "timeout" : "falha_de_rede",
    };
  }
}
