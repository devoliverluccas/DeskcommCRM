// lib/propostas/orcamento-publico.ts
//
// O ORÇAMENTO COMO O CLIENTE O VÊ PELO LINK (`/o/<token>`, migration 9480).
//
// Quem chega aqui não tem sessão: a ÚNICA autoridade é o token. A organização,
// a proposta e o contato saem da LINHA do link (achada pelo hash), nunca da URL
// nem do corpo — e toda leitura seguinte filtra `organization_id` com o valor
// dessa linha, porque o cliente de serviço não passa pela RLS.
//
// O que a página mostra é o mínimo do documento: quem envia (a marca DA
// ORGANIZAÇÃO — nunca a da instalação, mesma régua do PDF), para quem, os
// itens, os ajustes, o total e a validade. Nada de briefing, seções do modelo,
// anotação interna ou dado de outro contato.
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import { dataIsoNoFuso, fusoDaOrganizacao } from "./data-no-fuso";
import { registrarDecisao } from "./decisao";
import { estadoDoLink, hashDoToken, tokenTemFormato, type EstadoDoLink } from "./link-publico";
import { marcaDaOrganizacaoParaPdf } from "./marca-da-organizacao-para-pdf";
import { calcularSubtotal } from "./total";

export interface ItemDoOrcamentoPublico {
  descricao: string;
  quantidade: number;
  precoUnitarioCents: number | null;
  descontoCents: number;
  subtotalCents: number | null;
}

export interface OrcamentoPublico {
  linkId: string;
  organizationId: string;
  propostaId: string;
  estado: EstadoDoLink;
  titulo: string;
  numero: number | null;
  ano: number | null;
  versao: number;
  cliente: string | null;
  empresa: { nome: string | null; logoUrl: string | null; corHex: string | null };
  itens: ItemDoOrcamentoPublico[];
  subtotalCents: number;
  descontoCents: number;
  freteCents: number;
  totalCents: number;
  moeda: string;
  validUntil: string | null;
  condicoes: string | null;
  decididaEm: string | null;
}

interface LinhaDoLink {
  id: string;
  organization_id: string;
  proposal_id: string;
  expira_em: string;
  revogado_em: string | null;
}

interface LinhaDaProposta {
  id: string;
  organization_id: string;
  contact_id: string | null;
  status: string;
  titulo: string;
  numero: number | null;
  ano: number | null;
  versao: number;
  total_cents: number;
  desconto_cents: number | null;
  frete_cents: number | null;
  moeda: string;
  valid_until: string | null;
  condicoes: string | null;
  decided_at: string | null;
}

interface LinhaDoItem {
  descricao: string;
  quantidade: number;
  preco_unitario_cents: number | null;
  desconto_cents: number;
  position: number;
}

/** A linha do link pelo token. Formato errado nem chega ao banco. */
export async function linkPeloToken(admin: SupabaseClient, token: string): Promise<LinhaDoLink | null> {
  if (!tokenTemFormato(token)) return null;
  const { data } = await admin
    .from("crm_proposal_links")
    .select("id, organization_id, proposal_id, expira_em, revogado_em")
    .eq("token_hash", hashDoToken(token))
    .maybeSingle();
  return (data as LinhaDoLink | null) ?? null;
}

/**
 * Lê o orçamento pelo token. `null` = não há link com esse token (ou a
 * proposta sumiu) — a página responde "não encontrado" sem dizer qual dos dois.
 */
export async function lerOrcamentoPublico(
  admin: SupabaseClient,
  token: string,
  agora: Date = new Date(),
): Promise<OrcamentoPublico | null> {
  const link = await linkPeloToken(admin, token);
  if (!link) return null;
  const orgId = link.organization_id;

  const { data: propostaBruta } = await admin
    .from("crm_proposals")
    .select(
      "id, organization_id, contact_id, status, titulo, numero, ano, versao, total_cents, desconto_cents, frete_cents, moeda, valid_until, condicoes, decided_at",
    )
    .eq("organization_id", orgId)
    .eq("id", link.proposal_id)
    .maybeSingle();
  const proposta = propostaBruta as LinhaDaProposta | null;
  if (!proposta) return null;

  const fuso = await fusoDaOrganizacao(admin, orgId);
  const estado = estadoDoLink({
    link: { expira_em: link.expira_em, revogado_em: link.revogado_em },
    proposta: { status: proposta.status, valid_until: proposta.valid_until },
    hojeNoFuso: dataIsoNoFuso(agora, fuso),
    agora,
  });

  const { data: itensBrutos } = await admin
    .from("crm_proposal_items")
    .select("descricao, quantidade, preco_unitario_cents, desconto_cents, position")
    .eq("organization_id", orgId)
    .eq("proposal_id", proposta.id)
    .order("position", { ascending: true });
  const linhas = (itensBrutos ?? []) as LinhaDoItem[];

  const { data: contato } = proposta.contact_id
    ? await admin
        .from("contacts")
        .select("name, display_name, is_anonymized")
        .eq("organization_id", orgId)
        .eq("id", proposta.contact_id)
        .maybeSingle()
    : { data: null };
  const contatoLido = contato as { name: string | null; display_name: string | null; is_anonymized?: boolean } | null;

  const marca = await marcaDaOrganizacaoParaPdf(admin, orgId);
  const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  const nomeDaEmpresa = marca.appName ?? ((org as { name?: string | null } | null)?.name ?? null);

  // A RE-CONFERÊNCIA do link revogado: o gatilho da 9480 revoga ao anonimizar,
  // e a página não mostra o nome de quem pediu para sumir mesmo que alguém
  // apague o `revogado_em` à mão.
  const anonimizado = contatoLido?.is_anonymized === true;

  const itensParaSoma = linhas.map((it, i) => ({
    product_id: null,
    descricao: it.descricao,
    quantidade: Number(it.quantidade),
    preco_unitario_cents: it.preco_unitario_cents === null ? null : Number(it.preco_unitario_cents),
    desconto_cents: Number(it.desconto_cents),
    position: i,
  }));

  return {
    linkId: link.id,
    organizationId: orgId,
    propostaId: proposta.id,
    estado: anonimizado ? "revogada" : estado,
    titulo: proposta.titulo,
    numero: proposta.numero,
    ano: proposta.ano,
    versao: proposta.versao,
    cliente: anonimizado ? null : nomeDoContato(contatoLido),
    empresa: { nome: nomeDaEmpresa, logoUrl: marca.logoUrl, corHex: marca.accentHex },
    itens: itensParaSoma.map((it) => ({
      descricao: it.descricao,
      quantidade: it.quantidade,
      precoUnitarioCents: it.preco_unitario_cents,
      descontoCents: it.desconto_cents,
      subtotalCents:
        it.preco_unitario_cents === null
          ? null
          : Math.max(0, Math.round(it.quantidade * it.preco_unitario_cents) - it.desconto_cents),
    })),
    subtotalCents: calcularSubtotal(itensParaSoma),
    descontoCents: Number(proposta.desconto_cents ?? 0),
    freteCents: Number(proposta.frete_cents ?? 0),
    // O total GRAVADO é o oficial (o que foi enviado e o que o negócio vale);
    // a página não recalcula o que o cliente vai aceitar.
    totalCents: Number(proposta.total_cents),
    moeda: proposta.moeda,
    validUntil: proposta.valid_until,
    condicoes: proposta.condicoes,
    decididaEm: proposta.decided_at,
  };
}

/** Marca o último acesso — best-effort, nunca derruba a página. */
export async function registrarAcesso(admin: SupabaseClient, orgId: string, linkId: string): Promise<void> {
  try {
    await admin
      .from("crm_proposal_links")
      .update({ ultimo_acesso_em: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", linkId);
  } catch {
    // leitura não pode falhar por causa de um carimbo
  }
}

export type ResultadoDaDecisaoPeloLink =
  | { ok: true; decisao: "aceita" | "recusada" }
  | { ok: false; motivo: "nao_encontrado" | "fechado" | "erro" };

/**
 * A decisão do cliente. Só decide quem está num link ABERTO (vivo, dentro da
 * validade, proposta enviada) — e decide pelo MESMO `registrarDecisao` da
 * equipe, com `decided_via = 'cliente'` e sem usuário. A trava de status
 * (`enviada`) dentro dele resolve a corrida com a equipe e o duplo clique: a
 * segunda decisão recebe `fechado`, e a página mostra a que valeu.
 */
export async function decidirPeloLink(
  admin: SupabaseClient,
  input: { token: string; decisao: "aceita" | "recusada"; motivo: string | null; requestId: string },
): Promise<ResultadoDaDecisaoPeloLink> {
  const orcamento = await lerOrcamentoPublico(admin, input.token);
  if (!orcamento) return { ok: false, motivo: "nao_encontrado" };
  if (orcamento.estado !== "aberta") return { ok: false, motivo: "fechado" };

  const r = await registrarDecisao(admin, {
    orgId: orcamento.organizationId,
    propostaId: orcamento.propostaId,
    decisao: input.decisao,
    motivo: input.decisao === "recusada" ? input.motivo : null,
    quem: { via: "cliente", linkId: orcamento.linkId },
    requestId: input.requestId,
  });
  if (r.ok) return { ok: true, decisao: r.status };
  return { ok: false, motivo: r.motivo === "erro" ? "erro" : "fechado" };
}
