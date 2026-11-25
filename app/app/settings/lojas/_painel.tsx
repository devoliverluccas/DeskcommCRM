"use client";

/**
 * O painel de Configurações › Lojas e filiais (item 5.4): a chave da empresa,
 * a lista de lojas com a padrão, o formulário de cadastrar e a loja de cada
 * número.
 *
 * ── Excluir ou desativar ────────────────────────────────────────────────────
 *
 * A loja fica gravada nos orçamentos que saíram dela. Excluir é só para a loja
 * que nunca orçou (a rota responde 409 nas outras); desativar tira a loja dos
 * seletores e preserva o histórico. A padrão não se desativa: escolha outra
 * antes.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { ordenarLojas, type Loja } from "@/lib/lojas/schemas";
import { cn } from "@/lib/utils";

const CAMPO =
  "min-h-11 rounded-md border border-border bg-surface px-2.5 text-sm text-text lg:min-h-8 hover:border-border-strong focus:border-accent-500 focus:outline-hidden focus:ring-[3px] focus:ring-accent-500/15";

interface Numero {
  channel_session_id: string;
  nome: string | null;
  telefone: string | null;
  provider: string;
  loja_id: string | null;
}

interface Rascunho {
  nome: string;
  codigo: string;
  endereco: string;
  telefone: string;
}

const VAZIO: Rascunho = { nome: "", codigo: "", endereco: "", telefone: "" };

function rascunhoDe(l: Loja): Rascunho {
  return { nome: l.nome, codigo: l.codigo ?? "", endereco: l.endereco ?? "", telefone: l.telefone ?? "" };
}

function CamposDaLoja({
  valor,
  mudar,
  t,
  prefixo,
}: {
  valor: Rascunho;
  mudar: (r: Rascunho) => void;
  t: (texto: string) => string;
  prefixo: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${prefixo}-nome`}>{t("Nome")}</Label>
        <Input
          id={`${prefixo}-nome`}
          value={valor.nome}
          maxLength={120}
          onChange={(e) => mudar({ ...valor, nome: e.target.value })}
          className="min-h-11 lg:min-h-0"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefixo}-codigo`}>{t("Código")}</Label>
        <Input
          id={`${prefixo}-codigo`}
          value={valor.codigo}
          maxLength={40}
          onChange={(e) => mudar({ ...valor, codigo: e.target.value })}
          className="min-h-11 lg:min-h-0"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefixo}-endereco`}>{t("Endereço")}</Label>
        <Input
          id={`${prefixo}-endereco`}
          value={valor.endereco}
          maxLength={300}
          onChange={(e) => mudar({ ...valor, endereco: e.target.value })}
          className="min-h-11 lg:min-h-0"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefixo}-telefone`}>{t("Telefone")}</Label>
        <Input
          id={`${prefixo}-telefone`}
          value={valor.telefone}
          maxLength={40}
          inputMode="tel"
          onChange={(e) => mudar({ ...valor, telefone: e.target.value })}
          className="min-h-11 lg:min-h-0"
        />
      </div>
    </div>
  );
}

export function PainelDeLojas({
  idioma,
  ligadoInicial,
  lojasIniciais,
}: {
  idioma: Idioma;
  ligadoInicial: boolean;
  lojasIniciais: Loja[];
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [ligado, setLigado] = useState(ligadoInicial);
  const [lojas, setLojas] = useState(lojasIniciais);
  const [ocupado, setOcupado] = useState(false);
  const [nova, setNova] = useState<Rascunho>(VAZIO);
  const [editando, setEditando] = useState<{ id: string; valor: Rascunho } | null>(null);
  const [numeros, setNumeros] = useState<Numero[] | null>(null);
  const [numerosFalharam, setNumerosFalharam] = useState(false);

  useEffect(() => {
    if (!ligado) return;
    const controller = new AbortController();
    apiClient
      .get<ApiSuccess<Numero[]>>("/api/v1/lojas/numeros", { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setNumeros(res.data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNumerosFalharam(true);
      });
    return () => controller.abort();
  }, [ligado]);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    try {
      await acao();
    } catch (err) {
      showApiError(err);
    } finally {
      setOcupado(false);
    }
  }

  function trocarLoja(loja: Loja) {
    setLojas((lista) => ordenarLojas(lista.map((l) => (l.id === loja.id ? loja : l))));
  }

  function mudarChave(novo: boolean) {
    setLigado(novo);
    void executar(async () => {
      try {
        await apiClient.patch("/api/v1/lojas/configuracao", { enabled: novo });
        toast.success(t("Configuração salva."));
        router.refresh();
      } catch (err) {
        setLigado(!novo);
        throw err;
      }
    });
  }

  function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nova.nome.trim()) return;
    void executar(async () => {
      const r = await apiClient.post<ApiSuccess<Loja>>("/api/v1/lojas", nova);
      // A primeira nasce padrão; as outras entram como estão.
      setLojas((lista) => ordenarLojas([...lista, r.data]));
      setNova(VAZIO);
      toast.success(t("Loja cadastrada."));
    });
  }

  function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando || !editando.valor.nome.trim()) return;
    void executar(async () => {
      const r = await apiClient.patch<ApiSuccess<Loja>>(`/api/v1/lojas/${editando.id}`, editando.valor);
      trocarLoja(r.data);
      setEditando(null);
      toast.success(t("Loja salva."));
    });
  }

  function alterar(loja: Loja, patch: { ativa?: boolean; padrao?: boolean }) {
    void executar(async () => {
      const r = await apiClient.patch<ApiSuccess<Loja>>(`/api/v1/lojas/${loja.id}`, patch);
      if (patch.padrao) {
        // A antiga padrão deixa de ser na mesma transação (`fn_lojas_definir_padrao`).
        setLojas((lista) => ordenarLojas(lista.map((l) => (l.id === loja.id ? r.data : { ...l, padrao: false }))));
      } else {
        trocarLoja(r.data);
      }
      toast.success(t("Loja salva."));
    });
  }

  function excluir(loja: Loja) {
    if (!window.confirm(t("Excluir esta loja? O estoque e os números ligados a ela deixam de ter loja."))) return;
    void executar(async () => {
      await apiClient.delete(`/api/v1/lojas/${loja.id}`);
      setLojas((lista) => lista.filter((l) => l.id !== loja.id));
      setNumeros((lista) => lista?.map((n) => (n.loja_id === loja.id ? { ...n, loja_id: null } : n)) ?? null);
      toast.success(t("Loja excluída."));
    });
  }

  function vincularNumero(numero: Numero, valor: string) {
    const loja_id = valor === "" ? null : valor;
    const antes = numeros;
    setNumeros((lista) => lista?.map((n) => (n.channel_session_id === numero.channel_session_id ? { ...n, loja_id } : n)) ?? null);
    void executar(async () => {
      try {
        await apiClient.put("/api/v1/lojas/numeros", { channel_session_id: numero.channel_session_id, loja_id });
        toast.success(t("Configuração salva."));
      } catch (err) {
        setNumeros(antes);
        throw err;
      }
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section className="flex items-start justify-between gap-6" data-testid="lojas-chave">
        <div className="space-y-1">
          <Label htmlFor="lojas_enabled" className="text-sm font-medium text-text">
            {t("Usar lojas nesta empresa")}
          </Label>
          <p className="text-sm text-text-muted">
            {t("Ligado, o estoque por loja aparece no produto, cada orçamento registra a loja e os relatórios ganham o filtro por loja. Desligar preserva o que foi cadastrado.")}
          </p>
        </div>
        <Switch id="lojas_enabled" checked={ligado} disabled={ocupado} onCheckedChange={mudarChave} />
      </section>

      {ligado ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text">{t("Lojas")}</h2>
            {lojas.length === 0 ? (
              <p className="border-y border-border py-6 text-sm text-text-muted" data-testid="lojas-vazio">
                {t("Nenhuma loja cadastrada ainda. A primeira que você cadastrar vira a padrão.")}
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border" data-testid="lojas-lista">
                {lojas.map((l) =>
                  editando?.id === l.id ? (
                    <li key={l.id} className="py-4">
                      <form onSubmit={salvarEdicao} className="space-y-3">
                        <CamposDaLoja
                          valor={editando.valor}
                          mudar={(valor) => setEditando({ id: l.id, valor })}
                          t={t}
                          prefixo={`loja-${l.id}`}
                        />
                        <div className="flex gap-2">
                          <Button type="submit" disabled={ocupado} className="min-h-11 lg:min-h-0">
                            {t("Salvar")}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setEditando(null)} className="min-h-11 lg:min-h-0">
                            {t("Cancelar")}
                          </Button>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid={`loja-${l.id}`}>
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-medium", l.ativa ? "text-text" : "text-text-subtle")}>
                          {l.nome}
                          {l.codigo ? <span className="ml-2 text-xs font-normal text-text-muted">{l.codigo}</span> : null}
                          {l.padrao ? (
                            <span className="ml-2 rounded-sm bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                              {t("Padrão")}
                            </span>
                          ) : null}
                          {!l.ativa ? <span className="ml-2 text-xs font-normal text-text-muted">{t("Inativa")}</span> : null}
                        </p>
                        {l.endereco || l.telefone ? (
                          <p className="truncate text-xs text-text-muted">
                            {[l.endereco, l.telefone].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {!l.padrao && l.ativa ? (
                          <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => alterar(l, { padrao: true })} className="min-h-11 lg:min-h-0">
                            {t("Tornar padrão")}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={ocupado}
                          onClick={() => setEditando({ id: l.id, valor: rascunhoDe(l) })}
                          className="min-h-11 lg:min-h-0"
                        >
                          {t("Editar")}
                        </Button>
                        {!l.padrao ? (
                          <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => alterar(l, { ativa: !l.ativa })} className="min-h-11 lg:min-h-0">
                            {t(l.ativa ? "Desativar" : "Ativar")}
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => excluir(l)} className="min-h-11 text-error-fg lg:min-h-0">
                          {t("Excluir")}
                        </Button>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>

          <form onSubmit={criar} className="space-y-3" data-testid="lojas-criar">
            <h2 className="text-sm font-semibold text-text">{t("Nova loja")}</h2>
            <CamposDaLoja valor={nova} mudar={setNova} t={t} prefixo="nova-loja" />
            <Button type="submit" disabled={ocupado || !nova.nome.trim()} className="min-h-11 lg:min-h-0">
              {t("Cadastrar loja")}
            </Button>
          </form>

          <section className="space-y-3" data-testid="lojas-numeros">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-text">{t("Loja de cada número")}</h2>
              <p className="text-sm text-text-muted">
                {t("O orçamento que sai de uma conversa registra a loja do número. Número sem loja usa a padrão.")}
              </p>
            </div>
            {numerosFalharam ? (
              <p className="text-sm text-error-fg">{t("Não consegui carregar os números.")}</p>
            ) : numeros === null ? (
              <p role="status" className="text-sm text-text-muted">
                {t("Carregando…")}
              </p>
            ) : numeros.length === 0 ? (
              <p className="text-sm text-text-muted">{t("Nenhum número conectado.")}</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {numeros.map((n) => (
                  <li key={n.channel_session_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {n.nome ?? n.telefone ?? n.provider}
                      {n.nome && n.telefone ? <span className="ml-2 text-xs text-text-muted">{n.telefone}</span> : null}
                    </span>
                    <select
                      value={n.loja_id ?? ""}
                      disabled={ocupado}
                      onChange={(e) => vincularNumero(n, e.target.value)}
                      aria-label={`${t("Loja")} — ${n.nome ?? n.telefone ?? n.provider}`}
                      className={cn(CAMPO, "w-56")}
                      data-testid={`numero-loja-${n.channel_session_id}`}
                    >
                      <option value="">{t("Loja padrão")}</option>
                      {lojas.map((l) => (
                        <option key={l.id} value={l.id} disabled={!l.ativa && l.id !== n.loja_id}>
                          {l.nome}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
