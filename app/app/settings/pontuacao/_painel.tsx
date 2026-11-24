"use client";

/**
 * O painel de Pontuação do lead: a lista de regras e o formulário de criar
 * (fase 4, item 4.5).
 *
 * ── Por que não há "excluir" ────────────────────────────────────────────────
 *
 * Cada ponto do extrato aponta para a regra que o deu. Apagá-la deixaria o total
 * do contato sem explicação; "Desativar" para de pontuar e preserva o extrato.
 *
 * ── Por que o evento não muda na edição ────────────────────────────────────
 *
 * O extrato diz de que fato veio cada ponto. A mesma regra passar a ouvir outro
 * fato faria as linhas antigas mentirem — quem quer outro evento cria outra
 * regra. A condição, os pontos, o teto e o nome, esses mudam.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import {
  EVENTOS_DE_PONTUACAO,
  ROTULO_DO_EVENTO,
  comSinal,
  ordenarRegras,
  type EventoDePontuacao,
  type RegraDePontuacao,
} from "@/lib/leads/pontuacao-por-regra";
import { cn } from "@/lib/utils";

/** Uma etapa que a regra "etapa alcançada" pode escolher, com o funil no rótulo. */
export interface EtapaParaRegra {
  id: string;
  rotulo: string;
}

const CAMPO =
  "min-h-11 rounded-md border border-border bg-surface px-2.5 text-sm text-text lg:min-h-8 hover:border-border-strong focus:border-accent-500 focus:outline-hidden focus:ring-[3px] focus:ring-accent-500/15";

function mensagemDoErro(err: unknown, t: (texto: string) => string): string {
  return err instanceof Error && err.message ? t(err.message) : t("Não consegui salvar agora.");
}

/** O rascunho de uma regra — o mesmo formato para criar e editar. */
interface Rascunho {
  nome: string;
  evento: EventoDePontuacao;
  stageId: string;
  tag: string;
  pontos: string;
  teto: string;
}

const RASCUNHO_VAZIO: Rascunho = {
  nome: "",
  evento: "respondeu_followup",
  stageId: "",
  tag: "",
  pontos: "10",
  teto: "",
};

function condicaoDo(r: Rascunho): Record<string, string> {
  if (r.evento === "etapa_alcancada") return { stage_id: r.stageId };
  if (r.evento === "tag_aplicada") return { tag: r.tag.trim() };
  return {};
}

function rascunhoDa(regra: RegraDePontuacao): Rascunho {
  return {
    nome: regra.nome,
    evento: regra.evento,
    stageId: typeof regra.condicao.stage_id === "string" ? regra.condicao.stage_id : "",
    tag: typeof regra.condicao.tag === "string" ? regra.condicao.tag : "",
    pontos: String(regra.pontos),
    teto: regra.teto_por_contato === null ? "" : String(regra.teto_por_contato),
  };
}

/** O rascunho serve para gravar? A tela não oferece o que a rota recusaria. */
function rascunhoServe(r: Rascunho): boolean {
  const pontos = Number(r.pontos);
  if (!r.nome.trim() || !Number.isInteger(pontos) || pontos === 0 || Math.abs(pontos) > 1000) return false;
  if (r.teto !== "" && !(Number.isInteger(Number(r.teto)) && Number(r.teto) >= 1)) return false;
  if (r.evento === "etapa_alcancada" && !r.stageId) return false;
  if (r.evento === "tag_aplicada" && !r.tag.trim()) return false;
  return true;
}

export function PainelDePontuacao({
  idioma,
  regrasIniciais,
  etapas,
}: {
  idioma: Idioma;
  regrasIniciais: RegraDePontuacao[];
  etapas: EtapaParaRegra[];
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [regras, setRegras] = useState(regrasIniciais);
  const [ocupado, setOcupado] = useState(false);
  const [novo, setNovo] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [editando, setEditando] = useState<{ id: string; rascunho: Rascunho } | null>(null);

  const rotuloDaEtapa = new Map(etapas.map((e) => [e.id, e.rotulo]));

  function descreverCondicao(regra: RegraDePontuacao): string | null {
    if (regra.evento === "etapa_alcancada") {
      const id = typeof regra.condicao.stage_id === "string" ? regra.condicao.stage_id : "";
      return rotuloDaEtapa.get(id) ?? t("etapa arquivada");
    }
    if (regra.evento === "tag_aplicada") {
      return typeof regra.condicao.tag === "string" ? regra.condicao.tag : null;
    }
    return null;
  }

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

  function trocar(regra: RegraDePontuacao) {
    setRegras((lista) => ordenarRegras(lista.map((r) => (r.id === regra.id ? regra : r))));
  }

  async function alterar(id: string, patch: Record<string, unknown>) {
    const r = await apiClient.patch<{ data: RegraDePontuacao }>(`/api/v1/pontuacao/regras/${id}`, patch);
    trocar(r.data);
  }

  function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!rascunhoServe(novo)) return;
    void executar(async () => {
      const r = await apiClient.post<{ data: RegraDePontuacao }>("/api/v1/pontuacao/regras", {
        nome: novo.nome.trim(),
        evento: novo.evento,
        condicao: condicaoDo(novo),
        pontos: Number(novo.pontos),
        teto_por_contato: novo.teto === "" ? null : Number(novo.teto),
      });
      setRegras((lista) => ordenarRegras([...lista, r.data]));
      setNovo(RASCUNHO_VAZIO);
      toast.success(t("Regra criada."));
    });
  }

  function salvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!editando || !rascunhoServe(editando.rascunho)) return;
    const r = editando.rascunho;
    void executar(async () => {
      await alterar(editando.id, {
        nome: r.nome.trim(),
        pontos: Number(r.pontos),
        teto_por_contato: r.teto === "" ? null : Number(r.teto),
        ...(r.evento === "etapa_alcancada" || r.evento === "tag_aplicada" ? { condicao: condicaoDo(r) } : {}),
      });
      setEditando(null);
      toast.success(t("Regra salva."));
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {/* A LISTA */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text">{t("Regras")}</h2>
        {regras.length === 0 ? (
          <p className="border-y border-border py-6 text-sm text-text-muted" data-testid="pontuacao-vazio">
            {t("Nenhuma regra ainda. Sem regra, ninguém ganha pontos — crie a primeira abaixo.")}
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border" data-testid="pontuacao-lista">
            {regras.map((regra) =>
              editando?.id === regra.id ? (
                <li key={regra.id} className="py-3" data-testid="pontuacao-regra">
                  <form onSubmit={salvarEdicao} className="space-y-3">
                    <CamposDaRegra
                      idPrefixo={`editar-${regra.id}`}
                      rascunho={editando.rascunho}
                      onChange={(rascunho) => setEditando({ id: regra.id, rascunho })}
                      etapas={etapas}
                      eventoFixo
                      t={t}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm" disabled={ocupado || !rascunhoServe(editando.rascunho)}>
                        {t("Salvar")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>
                        {t("Cancelar")}
                      </Button>
                    </div>
                  </form>
                </li>
              ) : (
                <li
                  key={regra.id}
                  data-testid="pontuacao-regra"
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                >
                  <span
                    className={cn(
                      "w-14 shrink-0 text-right text-base font-semibold tabular-nums",
                      !regra.ativo ? "text-text-subtle" : regra.pontos > 0 ? "text-success-fg" : "text-warning-fg",
                    )}
                  >
                    {comSinal(regra.pontos)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", regra.ativo ? "text-text" : "text-text-subtle")}>
                      {regra.nome}
                      {regra.ativo ? null : (
                        <span className="ml-2 text-xs font-normal text-text-muted">{t("Desativada")}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {t(ROTULO_DO_EVENTO[regra.evento])}
                      {descreverCondicao(regra) ? ` · ${descreverCondicao(regra)}` : ""}
                      {regra.teto_por_contato !== null
                        ? ` · ${t("teto de {n} por contato").replace("{n}", String(regra.teto_por_contato))}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={ocupado}
                    onClick={() => setEditando({ id: regra.id, rascunho: rascunhoDa(regra) })}
                  >
                    {t("Editar")}
                  </Button>
                  <Switch
                    aria-label={regra.ativo ? t("Desativar a regra") : t("Ativar a regra")}
                    checked={regra.ativo}
                    disabled={ocupado}
                    onCheckedChange={(ativo) => void executar(() => alterar(regra.id, { ativo }))}
                  />
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      {/* CRIAR */}
      <form onSubmit={criar} className="space-y-3" data-testid="pontuacao-criar">
        <h2 className="text-sm font-semibold text-text">{t("Nova regra")}</h2>
        <CamposDaRegra idPrefixo="nova-regra" rascunho={novo} onChange={setNovo} etapas={etapas} t={t} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={ocupado || !rascunhoServe(novo)}>
            {t("Adicionar regra")}
          </Button>
          <p className="text-xs text-text-muted">
            {t(
              "Cada fato pontua uma vez: a mesma etapa por negócio, a mesma tag por contato, o mesmo orçamento por proposta. Pontos negativos tiram.",
            )}
          </p>
        </div>
      </form>
    </div>
  );
}

function CamposDaRegra({
  idPrefixo,
  rascunho,
  onChange,
  etapas,
  eventoFixo = false,
  t,
}: {
  idPrefixo: string;
  rascunho: Rascunho;
  onChange: (r: Rascunho) => void;
  etapas: EtapaParaRegra[];
  eventoFixo?: boolean;
  t: (texto: string) => string;
}) {
  const mudar = (patch: Partial<Rascunho>) => onChange({ ...rascunho, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefixo}-nome`}>{t("Nome da regra")}</Label>
        <Input
          id={`${idPrefixo}-nome`}
          value={rascunho.nome}
          maxLength={80}
          placeholder={t("Ex.: Respondeu o follow-up")}
          onChange={(e) => mudar({ nome: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefixo}-evento`}>{t("Quando")}</Label>
        <select
          id={`${idPrefixo}-evento`}
          className={cn(CAMPO, "w-full")}
          value={rascunho.evento}
          disabled={eventoFixo}
          onChange={(e) => mudar({ evento: e.target.value as EventoDePontuacao })}
        >
          {EVENTOS_DE_PONTUACAO.map((ev) => (
            <option key={ev} value={ev}>
              {t(ROTULO_DO_EVENTO[ev])}
            </option>
          ))}
        </select>
      </div>
      {rascunho.evento === "etapa_alcancada" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefixo}-etapa`}>{t("Etapa")}</Label>
          <select
            id={`${idPrefixo}-etapa`}
            className={cn(CAMPO, "w-full")}
            value={rascunho.stageId}
            onChange={(e) => mudar({ stageId: e.target.value })}
          >
            <option value="">{t("Escolha a etapa")}</option>
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.rotulo}
              </option>
            ))}
          </select>
        </div>
      ) : rascunho.evento === "tag_aplicada" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefixo}-tag`}>{t("Tag")}</Label>
          <Input
            id={`${idPrefixo}-tag`}
            value={rascunho.tag}
            maxLength={60}
            placeholder={t("Ex.: vip")}
            onChange={(e) => mudar({ tag: e.target.value })}
          />
        </div>
      ) : (
        <div aria-hidden className="hidden sm:block" />
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefixo}-pontos`}>{t("Pontos")}</Label>
        <Input
          id={`${idPrefixo}-pontos`}
          type="number"
          inputMode="numeric"
          min={-1000}
          max={1000}
          step={1}
          value={rascunho.pontos}
          onChange={(e) => mudar({ pontos: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefixo}-teto`}>{t("Teto por contato (opcional)")}</Label>
        <Input
          id={`${idPrefixo}-teto`}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={rascunho.teto}
          placeholder={t("Sem teto")}
          onChange={(e) => mudar({ teto: e.target.value })}
        />
      </div>
    </div>
  );
}
