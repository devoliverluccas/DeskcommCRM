"use client";
/**
 * O painel de Perfis de tela (item 5.6): a lista de perfis e quem usa cada um.
 *
 * Duas seções, sem cartão em volta: hierarquia por título e espaço. Editar um
 * perfil abre um diálogo com as áreas do catálogo agrupadas como no menu.
 * Atribuir é um seletor por pessoa — quem administra não recebe perfil.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { NAV_CATALOG, NAV_GROUPS, type NavMetadata } from "@/lib/navigation/catalogo";
import { PORTAS_ESSENCIAIS } from "@/lib/navigation/interface";
import type { PerfilDeTela } from "@/lib/navigation/perfis-de-tela";
import { PencilSimple, Trash } from "@/lib/ui/icons";

export interface MembroDoPainel {
  user_id: string;
  role: string;
  perfil_de_tela_id: string | null;
  nome: string;
}

/**
 * As áreas que um perfil pode escolher: as que algum papel abaixo de admin
 * alcança (perfil não vale para admin), sem as essenciais (aparecem sempre) e
 * sem as de agência.
 */
const OPCOES: readonly NavMetadata[] = (NAV_CATALOG as readonly NavMetadata[]).filter(
  (d) =>
    !d.agenciaOnly &&
    d.minRole !== "admin" &&
    !(PORTAS_ESSENCIAIS as readonly string[]).includes(d.href),
);

const ROTULO_DO_PAPEL: Record<string, string> = {
  viewer: "Leitor",
  agent: "Atendente",
  manager: "Gestor",
  admin: "Administrador",
};

interface Rascunho {
  id: string | null;
  nome: string;
  destinos: string[];
}

export function PainelDePerfis({
  idioma,
  iniciais,
  membros: membrosIniciais,
  euId,
}: {
  idioma: Idioma;
  iniciais: PerfilDeTela[];
  membros: MembroDoPainel[];
  euId: string;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const [perfis, setPerfis] = useState(iniciais);
  const [membros, setMembros] = useState(membrosIniciais);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [apagando, setApagando] = useState<PerfilDeTela | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const grupos = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({ grupo: g, itens: OPCOES.filter((d) => d.group === g.id) })).filter(
        (g) => g.itens.length > 0,
      ),
    [],
  );
  const usoPorPerfil = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of membros) if (x.perfil_de_tela_id) m.set(x.perfil_de_tela_id, (m.get(x.perfil_de_tela_id) ?? 0) + 1);
    return m;
  }, [membros]);

  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    try {
      await acao();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? t(err.message) : t("Não consegui salvar agora."));
    } finally {
      setOcupado(false);
    }
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!rascunho || rascunho.nome.trim() === "" || rascunho.destinos.length === 0) return;
    const r = rascunho;
    void executar(async () => {
      const corpo = { nome: r.nome.trim(), destinos: r.destinos };
      if (r.id) {
        const { data } = await apiClient.patch<{ data: PerfilDeTela }>(`/api/v1/perfis-de-tela/${r.id}`, corpo);
        setPerfis((ps) => ps.map((p) => (p.id === data.id ? data : p)));
      } else {
        const { data } = await apiClient.post<{ data: PerfilDeTela }>("/api/v1/perfis-de-tela", corpo);
        setPerfis((ps) => [...ps, data].sort((a, b) => a.nome.localeCompare(b.nome)));
      }
      setRascunho(null);
      toast.success(t("Perfil salvo."));
    });
  }

  function apagar(perfil: PerfilDeTela) {
    void executar(async () => {
      await apiClient.delete(`/api/v1/perfis-de-tela/${perfil.id}`);
      setPerfis((ps) => ps.filter((p) => p.id !== perfil.id));
      setMembros((ms) => ms.map((m) => (m.perfil_de_tela_id === perfil.id ? { ...m, perfil_de_tela_id: null } : m)));
      setApagando(null);
      toast.success(t("Perfil apagado."));
    });
  }

  function atribuir(membro: MembroDoPainel, perfilId: string | null) {
    void executar(async () => {
      await apiClient.patch(`/api/v1/team/${membro.user_id}/perfil-de-tela`, { perfil_de_tela_id: perfilId });
      setMembros((ms) => ms.map((m) => (m.user_id === membro.user_id ? { ...m, perfil_de_tela_id: perfilId } : m)));
      toast.success(t("Perfil atribuído."));
    });
  }

  function alternar(href: string) {
    setRascunho((r) =>
      r ? { ...r, destinos: r.destinos.includes(href) ? r.destinos.filter((x) => x !== href) : [...r.destinos, href] } : r,
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-10" data-testid="perfis-de-tela">
      <section className="flex flex-col gap-3" aria-labelledby="perfis-titulo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="perfis-titulo" className="text-sm font-semibold text-text">
            {t("Perfis")}
          </h2>
          <Button type="button" size="sm" onClick={() => setRascunho({ id: null, nome: "", destinos: [] })}>
            {t("Novo perfil")}
          </Button>
        </div>
        {perfis.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t("Nenhum perfil ainda. Sem perfil, cada pessoa vê tudo que o papel dela permite.")}
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {perfis.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" data-testid="perfil-linha">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{p.nome}</span>
                <span className="text-xs tabular-nums text-text-muted">
                  {t("{n} áreas").replace("{n}", String(p.destinos.length))} ·{" "}
                  {t("{n} pessoas").replace("{n}", String(usoPorPerfil.get(p.id) ?? 0))}
                </span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Editar perfil")}
                    onClick={() => setRascunho({ id: p.id, nome: p.nome, destinos: [...p.destinos] })}
                  >
                    <PencilSimple />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Apagar perfil")}
                    onClick={() => setApagando(p)}
                  >
                    <Trash />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="membros-titulo">
        <h2 id="membros-titulo" className="text-sm font-semibold text-text">
          {t("Quem usa cada perfil")}
        </h2>
        <ul className="divide-y divide-border border-y border-border">
          {membros.map((m) => {
            const ehAdmin = m.role === "admin";
            const idDoCampo = `perfil-${m.user_id}`;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
                <label htmlFor={idDoCampo} className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium text-text">
                    {m.nome}
                    {m.user_id === euId ? ` (${t("você")})` : ""}
                  </span>
                  <span className="block text-xs text-text-muted">{t(ROTULO_DO_PAPEL[m.role] ?? m.role)}</span>
                </label>
                {ehAdmin ? (
                  <span className="text-xs text-text-subtle">{t("Vê todas as áreas")}</span>
                ) : (
                  <select
                    id={idDoCampo}
                    className="h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-text sm:w-64 lg:h-8"
                    value={m.perfil_de_tela_id ?? ""}
                    disabled={ocupado}
                    onChange={(e) => atribuir(m, e.target.value || null)}
                  >
                    <option value="">{t("Sem perfil (tudo que o papel permite)")}</option>
                    {perfis.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <Dialog open={rascunho !== null} onOpenChange={(aberto) => !aberto && setRascunho(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={salvar} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{rascunho?.id ? t("Editar perfil") : t("Novo perfil")}</DialogTitle>
              <DialogDescription>
                {t("Marque as áreas que aparecem no menu. Perfil, Segurança, Notificações e App no celular aparecem sempre.")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="perfil-nome">{t("Nome")}</Label>
              <Input
                id="perfil-nome"
                value={rascunho?.nome ?? ""}
                maxLength={60}
                onChange={(e) => setRascunho((r) => (r ? { ...r, nome: e.target.value } : r))}
                placeholder={t("Ex.: Vendas")}
                required
              />
            </div>
            {grupos.map(({ grupo, itens }) => (
              <fieldset key={grupo.id} className="flex flex-col gap-1">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
                  {t(grupo.label)}
                </legend>
                {itens.map((d) => (
                  <label key={d.href} className="flex min-h-11 items-center gap-2 text-sm lg:min-h-8">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      checked={rascunho?.destinos.includes(d.href) ?? false}
                      onChange={() => alternar(d.href)}
                    />
                    <span className="text-text">{t(d.label)}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRascunho(null)}>
                {t("Cancelar")}
              </Button>
              <Button
                type="submit"
                disabled={ocupado || !rascunho || rascunho.nome.trim() === "" || rascunho.destinos.length === 0}
              >
                {ocupado ? t("Salvando…") : t("Salvar")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={apagando !== null} onOpenChange={(aberto) => !aberto && setApagando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Apagar perfil")}</DialogTitle>
            <DialogDescription>
              {t("Quem usa este perfil volta a ver tudo que o papel permite.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setApagando(null)}>
              {t("Cancelar")}
            </Button>
            <Button type="button" variant="destructive" disabled={ocupado} onClick={() => apagando && apagar(apagando)}>
              {t("Apagar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
