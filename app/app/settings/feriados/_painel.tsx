"use client";

/**
 * O painel de Feriados: adicionar, a lista e "importar nacionais do ano"
 * (fase 3, item 3.8). Sem cartão em volta de tudo: o formulário é uma linha, a
 * lista é uma tabela simples, e a hierarquia vem de peso e espaço.
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
import { Trash } from "@/lib/ui/icons";

export interface FeriadoNaTela {
  id: string;
  data: string;
  nome: string;
  recorrente_anual: boolean;
}

const ordenar = (lista: FeriadoNaTela[]) => [...lista].sort((a, b) => a.data.localeCompare(b.data));

function dataLegivel(dataIso: string, idioma: Idioma): string {
  // Meio-dia UTC: a data civil não escorrega de dia em fuso nenhum.
  return new Date(`${dataIso}T12:00:00Z`).toLocaleDateString(idioma, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
}

export function PainelDeFeriados({
  idioma,
  iniciais,
  anoAtual,
}: {
  idioma: Idioma;
  iniciais: FeriadoNaTela[];
  anoAtual: number;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [feriados, setFeriados] = useState(() => ordenar(iniciais));
  const [data, setData] = useState("");
  const [nome, setNome] = useState("");
  const [recorrente, setRecorrente] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [ano, setAno] = useState(anoAtual);

  const falha = (err: unknown) =>
    toast.error(err instanceof Error && err.message ? t(err.message) : t("Não consegui salvar agora."));

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !nome.trim()) return;
    setOcupado(true);
    try {
      const r = await apiClient.post<{ data: FeriadoNaTela }>("/api/v1/feriados", {
        data,
        nome: nome.trim(),
        recorrente_anual: recorrente,
      });
      setFeriados((atual) => ordenar([...atual, r.data]));
      setData("");
      setNome("");
      setRecorrente(false);
      toast.success(t("Feriado adicionado."));
    } catch (err) {
      falha(err);
    } finally {
      setOcupado(false);
    }
  }

  async function remover(f: FeriadoNaTela) {
    setOcupado(true);
    try {
      await apiClient.delete(`/api/v1/feriados/${f.id}`);
      setFeriados((atual) => atual.filter((x) => x.id !== f.id));
      toast.success(t("Feriado removido."));
    } catch (err) {
      falha(err);
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setOcupado(true);
    try {
      await apiClient.post("/api/v1/feriados/importar-nacionais", { ano });
      const lista = await apiClient.get<{ data: FeriadoNaTela[] }>("/api/v1/feriados");
      setFeriados(ordenar(lista.data));
      toast.success(t("Feriados nacionais importados."));
    } catch (err) {
      falha(err);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <form onSubmit={adicionar} className="flex flex-col gap-3" data-testid="form-feriado">
        <h2 className="text-sm font-semibold">{t("Adicionar feriado")}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feriado-data">{t("Data")}</Label>
            <Input
              id="feriado-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-44"
              required
            />
          </div>
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
            <Label htmlFor="feriado-nome">{t("Nome")}</Label>
            <Input
              id="feriado-nome"
              value={nome}
              maxLength={80}
              onChange={(e) => setNome(e.target.value)}
              placeholder={t("Ex.: Aniversário da cidade")}
              required
            />
          </div>
          <Button type="submit" disabled={ocupado || !data || !nome.trim()} data-testid="adicionar-feriado">
            {t("Adicionar")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="feriado-recorrente" checked={recorrente} onCheckedChange={setRecorrente} />
          <Label htmlFor="feriado-recorrente" className="font-normal">
            {t("Repete todo ano no mesmo dia")}
          </Label>
        </div>
      </form>

      <section className="flex flex-col gap-3" aria-labelledby="feriados-nacionais">
        <h2 id="feriados-nacionais" className="text-sm font-semibold">
          {t("Feriados nacionais")}
        </h2>
        <p className="text-xs text-text-muted">
          {t("Os feriados nacionais só fecham o expediente depois de importados. Importar de novo não duplica nem troca o nome que você deu a um dia.")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feriado-ano">{t("Ano")}</Label>
            <Input
              id="feriado-ano"
              type="number"
              value={ano}
              min={2000}
              max={2100}
              onChange={(e) => setAno(Number(e.target.value))}
              className="w-28"
            />
          </div>
          <Button type="button" variant="outline" disabled={ocupado} onClick={importar} data-testid="importar-nacionais">
            {t("Importar feriados nacionais")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="feriados-cadastrados">
        <h2 id="feriados-cadastrados" className="text-sm font-semibold">
          {t("Feriados cadastrados")}
        </h2>
        {feriados.length === 0 ? (
          <p className="text-sm text-text-muted" data-testid="feriados-vazio">
            {t("Nenhum feriado cadastrado. Sem feriados, o expediente segue só o horário de cada atendente e fila.")}
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border" data-testid="lista-de-feriados">
            {feriados.map((f) => (
              <li key={f.id} className="flex min-h-11 items-center gap-3 py-1.5">
                <span className="w-40 shrink-0 text-sm tabular-nums text-text-muted">{dataLegivel(f.data, idioma)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{f.nome}</span>
                {f.recorrente_anual && <span className="text-xs text-text-subtle">{t("Todo ano")}</span>}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-11 px-0 lg:w-8"
                  disabled={ocupado}
                  aria-label={`${t("Remover")} ${f.nome}`}
                  title={t("Remover")}
                  onClick={() => remover(f)}
                >
                  <Trash size={16} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
