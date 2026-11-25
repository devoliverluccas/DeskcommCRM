"use client";

/**
 * Aba "Acessos" de `/app/audit` — quem entrou, saiu, provou o segundo fator ou
 * trocou a senha, de qual aparelho e de onde.
 *
 * A tela só DESENHA: a rota (`/api/v1/audit/acessos`) já devolve o IP mascarado
 * para quem não administra a empresa, e o filtro de ações vive no servidor
 * (`ACOES_DE_ACESSO`). O aparelho é resumido aqui, do user agent cru, pela
 * mesma função que a planilha usa (`descreverAparelho`).
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { apiClient } from "@/lib/api/client";
import { acessoFalhou, rotuloDoAcesso } from "@/lib/audit/acessos";
import { descreverAparelho } from "@/lib/audit/aparelho";
import type { Acesso } from "@/lib/audit/consulta-de-acessos";
import { cn } from "@/lib/utils";

const TODAS = "__todas__";

interface Pagina {
  data: Acesso[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

interface Filtros {
  actor_id?: string;
  from?: string;
  to?: string;
}

/** `yyyy-mm-dd` do campo de data → começo (ou fim) daquele dia no fuso do navegador, em ISO. */
function limiteDoDia(dia: string, fim: boolean): string | undefined {
  if (!dia) return undefined;
  const d = new Date(`${dia}T${fim ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function consulta(filtros: Filtros, cursor?: string): string {
  const qs = new URLSearchParams();
  if (filtros.actor_id) qs.set("actor_id", filtros.actor_id);
  if (filtros.from) qs.set("from", filtros.from);
  if (filtros.to) qs.set("to", filtros.to);
  if (cursor) qs.set("cursor", cursor);
  return qs.toString();
}

export function AcessosDaEmpresa() {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [pessoa, setPessoa] = useState(TODAS);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const filtros = useMemo<Filtros>(
    () => ({
      actor_id: pessoa === TODAS ? undefined : pessoa,
      from: limiteDoDia(de, false),
      to: limiteDoDia(ate, true),
    }),
    [pessoa, de, ate],
  );

  const membros = useTeamMembers();
  const nomes = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of membros.data?.data ?? []) m.set(p.user_id, p.full_name || p.email || p.user_id.slice(0, 8));
    return m;
  }, [membros.data]);

  const q = useInfiniteQuery({
    queryKey: ["audit", "acessos", filtros],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      try {
        return await apiClient.get<Pagina>(`/api/v1/audit/acessos?${consulta(filtros, pageParam)}`);
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (ultima) => (ultima.meta?.has_more ? (ultima.meta.cursor ?? undefined) : undefined),
  });
  const linhas = useMemo(() => q.data?.pages.flatMap((p) => p.data) ?? [], [q.data]);
  const algumMascarado = linhas.some((l) => l.ip_mascarado);

  const quando = useMemo(
    () => new Intl.DateTimeFormat(tagDoIdioma, { dateStyle: "short", timeStyle: "short" }),
    [tagDoIdioma],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Barra de filtro sem moldura (redesign v2): campos direto na página. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-64">
          <label htmlFor="acessos-pessoa" className="text-xs text-text-muted">
            {t("Pessoa")}
          </label>
          <Select value={pessoa} onValueChange={setPessoa}>
            <SelectTrigger id="acessos-pessoa">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODAS}>{t("Todas")}</SelectItem>
              {(membros.data?.data ?? []).map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {nomes.get(p.user_id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="acessos-de" className="text-xs text-text-muted">
            {t("De")}
          </label>
          <Input id="acessos-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="acessos-ate" className="text-xs text-text-muted">
            {t("Até")}
          </label>
          <Input id="acessos-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-40" />
        </div>
        <Button
          variant="outline"
          className="sm:ml-auto"
          onClick={() => {
            window.location.href = `/api/v1/audit/acessos/export?${consulta(filtros)}`;
          }}
        >
          {t("Exportar planilha")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Quando")}</TableHead>
            <TableHead>{t("Pessoa")}</TableHead>
            <TableHead>{t("Evento")}</TableHead>
            <TableHead>{t("Aparelho")}</TableHead>
            <TableHead>{t("Endereço IP")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 5 }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : linhas.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-sm text-text-muted">
                {t("Nenhum acesso no período.")}
              </TableCell>
            </TableRow>
          ) : (
            linhas.map((a) => (
              <TableRow key={a.id} data-acao={a.action}>
                <TableCell className="whitespace-nowrap text-text-muted tabular-nums">
                  {quando.format(new Date(a.created_at))}
                </TableCell>
                <TableCell className="font-medium">
                  {a.actor_user_id ? (nomes.get(a.actor_user_id) ?? a.actor_user_id.slice(0, 8)) : "—"}
                </TableCell>
                <TableCell className={cn(acessoFalhou(a.action) && "text-error-fg")}>
                  {t(rotuloDoAcesso(a.action, a.metadata))}
                </TableCell>
                <TableCell className="text-text-muted" title={a.user_agent ?? undefined}>
                  {descreverAparelho(a.user_agent, t)}
                </TableCell>
                <TableCell className="font-mono text-xs text-text-muted">{a.ip ?? "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {algumMascarado && (
        <p className="text-xs text-text-subtle">
          {t("O endereço IP aparece parcial: só quem administra a empresa vê o endereço completo.")}
        </p>
      )}

      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? t("Carregando…") : t("Carregar mais")}
          </Button>
        </div>
      )}
    </div>
  );
}
