"use client";

/**
 * A GAVETA "NOVO ORÇAMENTO" DA CONVERSA (fase 2, itens 2.1 e 2.2).
 *
 * Aberta pelo item "Orçamento" do menu ⋯ do cabeçalho. Monta uma proposta sem
 * sair do atendimento: o cliente é o contato da conversa, o negócio é o aberto
 * dele (ou um novo, no funil padrão, criado na hora de salvar), os itens vêm da
 * busca do catálogo ou são avulsos, e o desconto e o frete são da proposta.
 *
 * ─── Nada aqui decide preço ─────────────────────────────────────────────────
 *
 * Tudo passa pelas rotas de proposta que o editor já usa: `POST /proposals`
 * cria, `PATCH /proposals/[id]` edita, `GET …/previa` mostra o PDF e
 * `POST …/send` envia. O preço de item de catálogo que a gaveta mostra é o da
 * busca, só para a conta ao vivo — o servidor o resolve de novo pelo catálogo
 * ao gravar (`resolverItensDaProposta`), e é o total DELE que vale. Por isso o
 * rótulo da conta diz "Prévia".
 *
 * ─── Quem envia ──────────────────────────────────────────────────────────────
 *
 * O atendente envia quando todo item veio do catálogo; com item avulso (preço
 * digitado), o envio é do gestor — a rota responde 403 e a gaveta diz isso.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { chaveDasPropostasDoContato } from "@/hooks/inbox/usePropostasDaConversa";
import { chaveDoResumoDoContato, negociosAbertos, type NegocioDoResumo } from "@/hooks/inbox/useNegocioDaConversa";
import { useDefaultPipeline } from "@/hooks/pipelines/useDefaultPipeline";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { formatCents } from "@/lib/money";
import { calcularSubtotal, calcularTotal } from "@/lib/propostas/total";
import { MagnifyingGlass, Plus, Trash } from "@/lib/ui/icons";
import { precoVigente } from "@/lib/catalogo/preco";

interface ProdutoDaBusca {
  id: string;
  codigo: string;
  nome: string;
  preco_cents: number;
  preco_promocional_cents?: number | null;
  moeda: string;
}

interface ModeloDaLista {
  slug: string;
  nome: string;
  oculto: boolean;
}

export interface ItemDoOrcamento {
  chave: string;
  product_id: string | null;
  descricao: string;
  codigo: string | null;
  quantidade: number;
  preco_unitario_cents: number | null;
}

/** "12,50", "12.50", "1.234,50" → centavos. Vazio ou ilegível → null. */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/\s/g, "").replace(/^R\$/i, "");
  if (limpo === "") return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function deCentavos(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

let contador = 0;
const novaChave = () => `item-${Date.now()}-${(contador += 1)}`;

/** O que vai no corpo das rotas: a linha em branco de "Item avulso" que ninguém preencheu fica de fora. */
function itensParaGravar(itens: ItemDoOrcamento[]) {
  return itens
    .filter((it) => it.descricao.trim().length > 0 || it.preco_unitario_cents !== null)
    .map((it, i) => ({
      product_id: it.product_id,
      descricao: it.descricao.trim(),
      quantidade: it.quantidade,
      preco_unitario_cents: it.preco_unitario_cents,
      desconto_cents: 0,
      position: (i + 1) * 1000,
    }));
}

function mensagemDe(e: unknown, padrao: string): string {
  if (e instanceof ApiError && !e.semEnvelope && e.message) return e.message;
  return padrao;
}

interface Props {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  conversationId: string;
  contactId: string;
  contactName: string;
}

export function OrcamentoDaConversa({ aberto, onAbertoChange, conversationId, contactId, contactName }: Props) {
  const t = useT();
  const qc = useQueryClient();

  // ─── O negócio: o aberto do contato, pela MESMA leitura da faixa do topo ───
  const resumo = useQuery({
    queryKey: chaveDoResumoDoContato(contactId),
    enabled: aberto,
    queryFn: async (): Promise<NegocioDoResumo[]> => {
      const r = await apiClient.get<{ data?: { leads?: NegocioDoResumo[] } }>(`/api/v1/contacts/${contactId}/crm-summary`);
      return r?.data?.leads ?? [];
    },
  });
  const abertos = useMemo(() => negociosAbertos(resumo.data), [resumo.data]);
  const [leadEscolhido, setLeadEscolhido] = useState<string | null>(null);
  const leadId = leadEscolhido ?? abertos[0]?.id ?? null;
  const semNegocio = resumo.isSuccess && abertos.length === 0;
  const funilPadrao = useDefaultPipeline(aberto && semNegocio);

  // ─── O modelo do documento: sem ele não há envio (C1) ───
  const modelos = useQuery({
    queryKey: ["modelos-de-proposta"],
    enabled: aberto,
    staleTime: 60_000,
    queryFn: async (): Promise<ModeloDaLista[]> => {
      const r = await apiClient.get<ApiSuccess<ModeloDaLista[]>>("/api/v1/settings/proposal-templates");
      return (r.data ?? []).filter((m) => !m.oculto);
    },
  });

  // ─── O formulário ───
  const [titulo, setTitulo] = useState(() => `${t("Orçamento")} — ${contactName}`);
  const [modelo, setModelo] = useState("");
  const [itens, setItens] = useState<ItemDoOrcamento[]>([]);
  const [observacoes, setObservacoes] = useState("");
  const [descontoTexto, setDescontoTexto] = useState("");
  const [freteTexto, setFreteTexto] = useState("");
  const desconto = paraCentavos(descontoTexto) ?? 0;
  const frete = paraCentavos(freteTexto) ?? 0;

  // ─── O que já foi gravado ───
  const [propostaId, setPropostaId] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  // O que foi gravado por último (assinatura do formulário). Estado, e não ref:
  // a tela LÊ isto no render para saber se há o que salvar.
  const [ultimaGravacao, setUltimaGravacao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "salvando" | "enviando" | "previa">(null);
  const [erro, setErro] = useState<string | null>(null);
  // O 409 de "este negócio já tem rascunho": a gaveta aponta para ele.
  const [propostaExistente, setPropostaExistente] = useState<string | null>(null);

  // ─── A busca do catálogo (nome ou SKU), a mesma rota do editor ───
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ProdutoDaBusca[]>([]);
  useEffect(() => {
    const termo = busca.trim();
    if (!termo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResultados([]);
      return;
    }
    const controller = new AbortController();
    const espera = setTimeout(() => {
      apiClient
        .get<ApiSuccess<ProdutoDaBusca[]>>(`/api/v1/products?busca=${encodeURIComponent(termo)}`, { signal: controller.signal })
        .then((r) => {
          if (!controller.signal.aborted) setResultados((r.data ?? []).slice(0, 8));
        })
        .catch(() => {
          if (!controller.signal.aborted) setResultados([]);
        });
    }, 250);
    return () => {
      clearTimeout(espera);
      controller.abort();
    };
  }, [busca]);

  const moeda = resultados[0]?.moeda ?? abertos[0]?.currency ?? "BRL";
  const paraConta = itens.map((it, i) => ({ ...it, desconto_cents: 0, position: i }));
  const subtotal = calcularSubtotal(paraConta);
  const total = calcularTotal(paraConta, { desconto_cents: desconto, frete_cents: frete });
  const temAvulso = itens.some((it) => it.product_id === null);

  const assinatura = JSON.stringify({ titulo, observacoes, desconto, frete, itens: itensParaGravar(itens) });
  const sujo = propostaId === null || ultimaGravacao !== assinatura;

  function adicionarDoCatalogo(p: ProdutoDaBusca) {
    setItens((atual) => [
      ...atual,
      { chave: novaChave(), product_id: p.id, descricao: p.nome, codigo: p.codigo, quantidade: 1, preco_unitario_cents: precoVigente(p) },
    ]);
    setBusca("");
    setResultados([]);
  }

  function adicionarAvulso() {
    setItens((atual) => [
      ...atual,
      { chave: novaChave(), product_id: null, descricao: "", codigo: null, quantidade: 1, preco_unitario_cents: null },
    ]);
  }

  function mudarItem(chave: string, patch: Partial<ItemDoOrcamento>) {
    setItens((atual) => atual.map((it) => (it.chave === chave ? { ...it, ...patch } : it)));
  }

  /** Sem negócio aberto: cria um no funil padrão, pela mesma rota do "Novo negócio". */
  async function garantirNegocio(): Promise<string | null> {
    if (leadId) return leadId;
    const funil = funilPadrao.data;
    const etapa = funil?.stages.find((s) => !s.is_won && !s.is_lost && !s.is_archived) ?? null;
    if (!funil || !etapa) {
      setErro(t("Não há funil padrão para criar o negócio. Crie o negócio pelo painel e tente de novo."));
      return null;
    }
    const r = await apiClient.post<{ data: { id: string } }>("/api/v1/leads", {
      pipeline_id: funil.pipeline.id,
      stage_id: etapa.id,
      title: titulo.trim().length >= 2 ? titulo.trim() : `${t("Orçamento")} — ${contactName}`,
      contact_id: contactId,
    });
    void qc.invalidateQueries({ queryKey: chaveDoResumoDoContato(contactId) });
    setLeadEscolhido(r.data.id);
    return r.data.id;
  }

  /** Grava (cria ou edita). Devolve o id quando deu certo. */
  async function salvar(): Promise<string | null> {
    setErro(null);
    const linhas = itensParaGravar(itens);
    const semDescricao = linhas.findIndex((it) => it.descricao.length === 0);
    if (linhas.length === 0) {
      setErro(t("Adicione ao menos um item."));
      return null;
    }
    if (semDescricao >= 0) {
      setErro(t("Preencha a descrição do item {n}.").replace("{n}", String(semDescricao + 1)));
      return null;
    }
    if (!sujo && propostaId) return propostaId;
    setOcupado("salvando");
    try {
      if (propostaId === null) {
        const lead = await garantirNegocio();
        if (!lead) return null;
        const r = await apiClient.post<ApiSuccess<{ id: string }>>("/api/v1/proposals", {
          lead_id: lead,
          titulo: titulo.trim(),
          condicoes: observacoes.trim() || null,
          itens: linhas,
          desconto_cents: desconto,
          frete_cents: frete,
          conversation_id: conversationId,
          ...(modelo ? { template_slug: modelo } : {}),
        });
        setPropostaId(r.data.id);
        setRevision(1);
        setUltimaGravacao(assinatura);
        void qc.invalidateQueries({ queryKey: chaveDasPropostasDoContato(contactId) });
        return r.data.id;
      }
      const r = await apiClient.patch<ApiSuccess<{ id: string; revision: number; total_cents: number }>>(
        `/api/v1/proposals/${propostaId}`,
        {
          revision,
          titulo: titulo.trim(),
          condicoes: observacoes.trim() || null,
          itens: linhas,
          desconto_cents: desconto,
          frete_cents: frete,
        },
      );
      setRevision(r.data.revision);
      setUltimaGravacao(assinatura);
      void qc.invalidateQueries({ queryKey: chaveDasPropostasDoContato(contactId) });
      return propostaId;
    } catch (e) {
      const rascunhoAberto =
        e instanceof ApiError && typeof e.details?.rascunho_aberto_id === "string" ? (e.details.rascunho_aberto_id as string) : null;
      if (rascunhoAberto) setPropostaExistente(rascunhoAberto);
      setErro(mensagemDe(e, t("Não foi possível salvar agora.")));
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function salvarEEnviar() {
    if (!modelo && propostaId === null) {
      setErro(t("Escolha o modelo do documento antes de enviar."));
      return;
    }
    const id = await salvar();
    if (!id) return;
    setOcupado("enviando");
    try {
      const r = await apiClient.post<ApiSuccess<{ status: string; ultima_falha_envio: string | null }>>(
        `/api/v1/proposals/${id}/send`,
        {},
        { timeoutMs: 120_000 },
      );
      void qc.invalidateQueries({ queryKey: chaveDasPropostasDoContato(contactId) });
      if (r.data.status === "enviada") {
        toast.success(t("Proposta enviada."));
        onAbertoChange(false);
      } else if (r.data.status === "enviando") {
        toast.message(t("Na fila do WhatsApp — sai assim que o canal conectar."));
        onAbertoChange(false);
      } else {
        setErro(`${t("O último envio falhou")}: ${r.data.ultima_falha_envio ?? ""}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setErro(t("Com item avulso (preço digitado), quem envia é o gestor. Salve e peça o envio a quem tem esse papel."));
      } else {
        setErro(mensagemDe(e, t("Não foi possível enviar agora.")));
      }
    } finally {
      setOcupado(null);
    }
  }

  async function preVisualizar() {
    const id = await salvar();
    if (!id) return;
    setOcupado("previa");
    try {
      const res = await fetch(`/api/v1/proposals/${id}/previa`, { credentials: "same-origin" });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        window.open(url, "_blank", "noopener");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      const corpo = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setErro(corpo?.error?.message ?? t("Não foi possível gerar a prévia agora."));
    } catch {
      setErro(t("Não foi possível gerar a prévia agora."));
    } finally {
      setOcupado(null);
    }
  }

  const travado = ocupado !== null;

  return (
    <Sheet open={aberto} onOpenChange={onAbertoChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" data-testid="gaveta-orcamento">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle>{t("Novo orçamento")}</SheetTitle>
          <SheetDescription className="text-text-muted">{contactName}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* ─── Cliente e negócio ─── */}
          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="orcamento-titulo">{t("Título")}</Label>
              <Input id="orcamento-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orcamento-negocio">{t("Negócio")}</Label>
              {resumo.isLoading ? (
                <p className="text-sm text-text-muted">{t("Carregando…")}</p>
              ) : abertos.length > 0 ? (
                <select
                  id="orcamento-negocio"
                  className="h-11 w-full rounded-md border border-border bg-surface px-3 text-base lg:h-8 lg:text-sm"
                  value={leadId ?? ""}
                  disabled={propostaId !== null}
                  onChange={(e) => setLeadEscolhido(e.target.value)}
                >
                  {abertos.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                      {l.etapa_nome ? ` · ${l.etapa_nome}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p id="orcamento-negocio" className="text-sm text-text-muted">
                  {t("Sem negócio aberto: um negócio novo é criado no funil padrão ao salvar.")}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orcamento-modelo">{t("Modelo do documento")}</Label>
              {propostaId !== null ? (
                <p className="text-sm text-text-muted">{modelos.data?.find((m) => m.slug === modelo)?.nome ?? (modelo || "—")}</p>
              ) : (
                <select
                  id="orcamento-modelo"
                  className="h-11 w-full rounded-md border border-border bg-surface px-3 text-base lg:h-8 lg:text-sm"
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                >
                  <option value="">{t("Escolha um modelo")}</option>
                  {(modelos.data ?? []).map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </section>

          {/* ─── Itens ─── */}
          <section className="space-y-3" aria-labelledby="orcamento-itens-titulo">
            <h3 id="orcamento-itens-titulo" className="text-sm font-semibold">
              {t("Itens")}
            </h3>
            <div className="relative">
              <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
              <Input
                type="search"
                className="pl-9"
                placeholder={t("Buscar produto no catálogo…")}
                aria-label={t("Buscar produto no catálogo…")}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                data-testid="orcamento-busca"
              />
              {resultados.length > 0 ? (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface-elevated shadow-md" role="listbox">
                  {resultados.map((p) => (
                    <li key={p.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-hover lg:min-h-9"
                        onClick={() => adicionarDoCatalogo(p)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{p.nome}</span>
                          <span className="block font-mono text-xs text-text-muted">{p.codigo}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-text-muted">{formatCents(precoVigente(p), p.moeda)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {itens.length > 0 ? (
              <ul className="divide-y divide-border border-y border-border" data-testid="orcamento-lista-de-itens">
                {itens.map((it, i) => (
                  <li key={it.chave} className="space-y-2 py-3">
                    <div className="flex items-start gap-2">
                      {it.product_id ? (
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{it.descricao}</p>
                          {it.codigo ? <p className="font-mono text-xs text-text-muted">{it.codigo}</p> : null}
                        </div>
                      ) : (
                        <Input
                          className="flex-1"
                          value={it.descricao}
                          placeholder={t("Descrição")}
                          aria-label={`${t("Descrição")} ${i + 1}`}
                          maxLength={500}
                          onChange={(e) => mudarItem(it.chave, { descricao: e.target.value })}
                        />
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t("Remover item")}
                        onClick={() => setItens((atual) => atual.filter((x) => x.chave !== it.chave))}
                      >
                        <Trash size={16} aria-hidden />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`qtd-${it.chave}`} className="sr-only">
                        {t("Quantidade")}
                      </Label>
                      <Input
                        id={`qtd-${it.chave}`}
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="1"
                        className="w-20 text-right"
                        value={it.quantidade}
                        onChange={(e) => mudarItem(it.chave, { quantidade: Math.max(0.01, Number(e.target.value) || 0) })}
                      />
                      <span className="text-xs text-text-muted" aria-hidden>
                        ×
                      </span>
                      {it.product_id ? (
                        <span className="text-sm tabular-nums text-text-muted">
                          {it.preco_unitario_cents === null ? t("A definir") : formatCents(it.preco_unitario_cents, moeda)}
                        </span>
                      ) : (
                        <Input
                          type="text"
                          inputMode="decimal"
                          className="w-28 text-right"
                          placeholder={t("A definir")}
                          aria-label={`${t("Preço unit.")} ${i + 1}`}
                          defaultValue={deCentavos(it.preco_unitario_cents)}
                          onChange={(e) => mudarItem(it.chave, { preco_unitario_cents: paraCentavos(e.target.value) })}
                        />
                      )}
                      <span className="ml-auto text-sm font-medium tabular-nums">
                        {it.preco_unitario_cents === null
                          ? t("A definir")
                          : formatCents(Math.round(it.quantidade * it.preco_unitario_cents), moeda)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">{t("Busque um produto ou adicione um item avulso.")}</p>
            )}

            <Button type="button" variant="ghost" size="sm" onClick={adicionarAvulso} data-testid="orcamento-item-avulso">
              <Plus size={16} aria-hidden />
              {t("Item avulso")}
            </Button>
          </section>

          {/* ─── Ajustes e observações ─── */}
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="orcamento-desconto">{t("Desconto")}</Label>
                <Input
                  id="orcamento-desconto"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="text-right"
                  value={descontoTexto}
                  onChange={(e) => setDescontoTexto(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="orcamento-frete">{t("Frete")}</Label>
                <Input
                  id="orcamento-frete"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="text-right"
                  value={freteTexto}
                  onChange={(e) => setFreteTexto(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orcamento-observacoes">{t("Observações")}</Label>
              <Textarea
                id="orcamento-observacoes"
                rows={3}
                maxLength={4000}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>
          </section>

          {/* ─── A conta ao vivo ─── */}
          <section aria-live="polite" className="space-y-1 border-t border-border pt-4 text-sm" data-testid="orcamento-total">
            {desconto !== 0 || frete !== 0 ? (
              <>
                <div className="flex justify-between text-text-muted">
                  <span>{t("Subtotal")}</span>
                  <span className="tabular-nums">{formatCents(subtotal, moeda)}</span>
                </div>
                {desconto !== 0 ? (
                  <div className="flex justify-between text-text-muted">
                    <span>{t("Desconto")}</span>
                    <span className="tabular-nums">− {formatCents(desconto, moeda)}</span>
                  </div>
                ) : null}
                {frete !== 0 ? (
                  <div className="flex justify-between text-text-muted">
                    <span>{t("Frete")}</span>
                    <span className="tabular-nums">{formatCents(frete, moeda)}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-semibold">{t("Total")}</span>
              <span className="text-lg font-semibold tabular-nums">{formatCents(total, moeda)}</span>
            </div>
            <p className="text-xs text-text-subtle">{t("Prévia — o total oficial é calculado ao salvar")}</p>
            {temAvulso ? (
              <p className="text-xs text-text-muted">{t("Com item avulso, o envio fica com o gestor.")}</p>
            ) : null}
          </section>

          {erro ? (
            <div role="alert" className="space-y-1 rounded-md bg-error-bg px-3 py-2 text-sm text-error-fg">
              <p>{erro}</p>
              {propostaId || propostaExistente ? (
                <Link href={`/app/proposals/${propostaId ?? propostaExistente}`} className="underline underline-offset-4">
                  {t("Abrir proposta")}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:items-center">
          <Button type="button" variant="ghost" onClick={() => void preVisualizar()} disabled={travado} data-testid="orcamento-previa">
            {ocupado === "previa" ? t("Carregando…") : t("Pré-visualizar")}
          </Button>
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row">
            <Button type="button" variant="secondary" onClick={() => void salvar()} disabled={travado} data-testid="orcamento-salvar">
              {ocupado === "salvando" ? t("Salvando…") : t("Salvar")}
            </Button>
            <Button type="button" onClick={() => void salvarEEnviar()} disabled={travado} data-testid="orcamento-salvar-e-enviar">
              {ocupado === "enviando" ? t("Enviando…") : t("Salvar e enviar")}
            </Button>
          </div>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
