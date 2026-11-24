"use client";

/**
 * O painel de Motivos de encerramento: a exigência, a lista e o formulário de
 * criar (fase 3, item 3.2).
 *
 * ── Por que não há "excluir" ────────────────────────────────────────────────
 *
 * O motivo fica gravado nas demandas que ele encerrou. Apagá-lo deixaria esses
 * atendimentos sem o porquê; "Desativar" tira o motivo do Inbox e preserva o
 * histórico. Reativar devolve.
 *
 * ── Por que a ordem é por setas, e não por arrastar ────────────────────────
 *
 * A lista é curta (é o que cabe num seletor) e a seta funciona no teclado, no
 * leitor de tela e no toque sem gesto escondido.
 */
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import {
  CATEGORIAS_DE_MOTIVO,
  ROTULO_DA_CATEGORIA,
  SUGESTOES_DE_MOTIVO,
  ordenarMotivos,
  type CategoriaDeMotivo,
  type MotivoDeEncerramento,
} from "@/lib/atendimento/motivos-de-encerramento";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { cn } from "@/lib/utils";

const CAMPO =
  "min-h-11 rounded-md border border-border bg-surface px-2.5 text-sm text-text lg:min-h-8 hover:border-border-strong focus:border-accent-500 focus:outline-hidden focus:ring-[3px] focus:ring-accent-500/15";

function mensagemDoErro(err: unknown, t: (texto: string) => string): string {
  return err instanceof Error && err.message ? t(err.message) : t("Não consegui salvar agora.");
}

export function PainelDeMotivos({
  idioma,
  motivosIniciais,
  exigidoInicial,
}: {
  idioma: Idioma;
  motivosIniciais: MotivoDeEncerramento[];
  exigidoInicial: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [motivos, setMotivos] = useState(motivosIniciais);
  const [exigido, setExigido] = useState(exigidoInicial);
  const [ocupado, setOcupado] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novaCategoria, setNovaCategoria] = useState<CategoriaDeMotivo>("resolvida");
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);

  const ativos = motivos.filter((m) => m.ativo);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    try {
      await acao();
    } catch (err) {
      toast.error(mensagemDoErro(err, t));
    } finally {
      setOcupado(false);
    }
  }

  function trocar(motivo: MotivoDeEncerramento) {
    setMotivos((lista) => ordenarMotivos(lista.map((m) => (m.id === motivo.id ? motivo : m))));
  }

  async function alterar(id: string, patch: Partial<Pick<MotivoDeEncerramento, "nome" | "categoria" | "ativo" | "ordem">>) {
    const r = await apiClient.patch<{ data: MotivoDeEncerramento }>(`/api/v1/motivos-de-encerramento/${id}`, patch);
    trocar(r.data);
  }

  function mudarExigencia(novo: boolean) {
    setExigido(novo);
    void executar(async () => {
      try {
        await apiClient.patch("/api/v1/motivos-de-encerramento/config", { motivo_obrigatorio_ao_encerrar: novo });
        toast.success(t("Opção salva."));
      } catch (err) {
        setExigido(!novo);
        throw err;
      }
    });
  }

  function criar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) return;
    void executar(async () => {
      const r = await apiClient.post<{ data: MotivoDeEncerramento }>("/api/v1/motivos-de-encerramento", {
        nome,
        categoria: novaCategoria,
      });
      setMotivos((lista) => ordenarMotivos([...lista, r.data]));
      setNovoNome("");
      toast.success(t("Motivo criado."));
    });
  }

  function usarSugestoes() {
    void executar(async () => {
      const r = await apiClient.post<{ data: { motivos: MotivoDeEncerramento[] } }>(
        "/api/v1/motivos-de-encerramento/sugestoes",
        {},
      );
      setMotivos(ordenarMotivos(r.data.motivos));
    });
  }

  /** Troca de lugar com o vizinho e renumera o que mudou (a ordem pode ter empate). */
  function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao;
    if (destino < 0 || destino >= motivos.length) return;
    const nova = [...motivos];
    [nova[indice], nova[destino]] = [nova[destino]!, nova[indice]!];
    const mudancas = nova
      .map((m, ordem) => ({ m, ordem }))
      .filter(({ m, ordem }) => m.ordem !== ordem);
    setMotivos(nova.map((m, ordem) => ({ ...m, ordem })));
    void executar(async () => {
      try {
        for (const { m, ordem } of mudancas) await alterar(m.id, { ordem });
      } catch (err) {
        setMotivos(motivos);
        throw err;
      }
    });
  }

  function salvarNome(e: React.FormEvent) {
    e.preventDefault();
    if (!renomeando) return;
    const nome = renomeando.nome.trim();
    if (!nome) return;
    void executar(async () => {
      await alterar(renomeando.id, { nome });
      setRenomeando(null);
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {/* A EXIGÊNCIA */}
      <section className="flex items-start justify-between gap-6" data-testid="motivos-exigencia">
        <div className="space-y-1">
          <Label htmlFor="motivo_obrigatorio_ao_encerrar" className="text-sm font-medium text-text">
            {t("Exigir motivo ao encerrar")}
          </Label>
          <p className="text-sm text-text-muted">
            {t("Ligada, a conversa só fecha com um motivo escolhido. Desligada, o motivo é opcional.")}
          </p>
          {exigido && ativos.length === 0 ? (
            <p className="text-sm text-warning-fg" data-testid="motivos-exigencia-sem-lista">
              {t("Sem motivo ativo, a exigência não vale: a equipe continua fechando sem escolher.")}
            </p>
          ) : null}
        </div>
        <Switch
          id="motivo_obrigatorio_ao_encerrar"
          checked={exigido}
          disabled={ocupado}
          onCheckedChange={mudarExigencia}
        />
      </section>

      {/* A LISTA */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text">{t("Motivos")}</h2>
        {motivos.length === 0 ? (
          <div className="space-y-3 border-y border-border py-6" data-testid="motivos-vazio">
            <p className="text-sm text-text-muted">
              {t("Nenhum motivo cadastrado. Comece pelas sugestões ou crie os seus abaixo.")}
            </p>
            <p className="text-sm text-text-subtle">
              {SUGESTOES_DE_MOTIVO.map((s) => t(s.nome)).join(" · ")}
            </p>
            <Button type="button" variant="secondary" disabled={ocupado} onClick={usarSugestoes}>
              {t("Usar sugestões")}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border" data-testid="motivos-lista">
            {motivos.map((m, i) => (
              <li
                key={m.id}
                data-testid="motivo-item"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
              >
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Mover para cima")}
                    disabled={ocupado || i === 0}
                    onClick={() => mover(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Mover para baixo")}
                    disabled={ocupado || i === motivos.length - 1}
                    onClick={() => mover(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </div>

                {renomeando?.id === m.id ? (
                  <form onSubmit={salvarNome} className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      autoFocus
                      aria-label={t("Nome do motivo")}
                      value={renomeando.nome}
                      maxLength={80}
                      onChange={(e) => setRenomeando({ id: m.id, nome: e.target.value })}
                    />
                    <Button type="submit" size="sm" disabled={ocupado}>
                      {t("Salvar")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenomeando(null)}>
                      {t("Cancelar")}
                    </Button>
                  </form>
                ) : (
                  <span
                    className={cn("min-w-0 flex-1 truncate text-sm font-medium", m.ativo ? "text-text" : "text-text-subtle")}
                  >
                    {m.nome}
                    {m.ativo ? null : (
                      <span className="ml-2 text-xs font-normal text-text-muted">{t("Desativado")}</span>
                    )}
                  </span>
                )}

                <select
                  aria-label={t("Categoria do motivo")}
                  className={cn(CAMPO, "w-48")}
                  value={m.categoria}
                  disabled={ocupado}
                  onChange={(e) => {
                    const categoria = e.target.value as CategoriaDeMotivo;
                    void executar(() => alterar(m.id, { categoria }));
                  }}
                >
                  {CATEGORIAS_DE_MOTIVO.map((c) => (
                    <option key={c} value={c}>
                      {t(ROTULO_DA_CATEGORIA[c])}
                    </option>
                  ))}
                </select>

                {renomeando?.id === m.id ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => setRenomeando({ id: m.id, nome: m.nome })}
                  >
                    {t("Renomear")}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={ocupado}
                  onClick={() => void executar(() => alterar(m.id, { ativo: !m.ativo }))}
                >
                  {m.ativo ? t("Desativar") : t("Reativar")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* CRIAR */}
      <form onSubmit={criar} className="space-y-3" data-testid="motivos-criar">
        <h2 className="text-sm font-semibold text-text">{t("Novo motivo")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="novo-motivo-nome">{t("Nome do motivo")}</Label>
            <Input
              id="novo-motivo-nome"
              value={novoNome}
              maxLength={80}
              placeholder={t("Ex.: Cliente desistiu")}
              onChange={(e) => setNovoNome(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="novo-motivo-categoria">{t("Categoria do motivo")}</Label>
            <select
              id="novo-motivo-categoria"
              className={cn(CAMPO, "w-48")}
              value={novaCategoria}
              onChange={(e) => setNovaCategoria(e.target.value as CategoriaDeMotivo)}
            >
              {CATEGORIAS_DE_MOTIVO.map((c) => (
                <option key={c} value={c}>
                  {t(ROTULO_DA_CATEGORIA[c])}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={ocupado || !novoNome.trim()}>
            {t("Adicionar motivo")}
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          {t("A categoria é o desfecho que o motivo dá à demanda que ainda estava aberta.")}
        </p>
      </form>
    </div>
  );
}
