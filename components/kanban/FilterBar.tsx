"use client";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { useT } from "@/hooks/i18n/useT";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PontoDaEtiqueta } from "@/components/tags/PontoDaEtiqueta";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useAssignableAgents } from "@/hooks/kanban/useAssignableAgents";
import type { Lead, OwnerKind } from "@/lib/types/leads";
import { marcadoresDoCard } from "@/lib/kanban/marcadores-do-card";
import { OwnerBadge } from "./OwnerBadge";
import {
  agentOwnerFilter,
  marcadoresDoFiltro,
  parseAgentOwnerFilter,
  type LeadFilters,
} from "@/lib/kanban/filters";
import {
  SEM_CATEGORIA,
  categoriaDoMotivo,
  categoriasDoFunil,
} from "@/lib/leads/motivos-de-perda-do-funil";
import { rotuloDoMotivoDePerda } from "@/lib/schemas/leads";
import {
  CHAVE_DOS_FILTROS_SALVOS,
  TAMANHO_MAXIMO_DO_NOME,
  apagarFiltroSalvo,
  filtrosDoSalvo,
  lerFiltrosSalvos,
  salvarFiltro,
  type FiltroSalvo,
} from "@/lib/kanban/filtros-salvos";
import { X } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { rotuloDoMembro } from "@/lib/users/rotulo-do-atendente";

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  leads: Lead[];
  /**
   * O `settings` do funil do quadro (issue #1537) — é dele que sai a categoria
   * de cada motivo, que não é coluna do lead nem está no card. Sem isto o filtro
   * de categoria não teria o que oferecer.
   */
  settings?: Record<string, unknown>;
  /**
   * O funil dos filtros salvos (fase 1, item 1.6). Ausente, a barra não oferece
   * salvar: filtro salvo é por funil, e sem o funil não há onde guardá-lo.
   */
  pipelineId?: string;
}

/** O `localStorage` quando ele existe e não está bloqueado; `null` no resto. */
function armazenamentoLocal(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * A loja externa dos filtros salvos para `useSyncExternalStore`: o retrato é o
 * texto cru da chave (string compara por valor, então o React só re-renderiza
 * quando ela muda), e o aviso vem desta aba (`avisarSalvos`, depois de gravar)
 * ou de outra (evento `storage`).
 */
const ouvintesDosSalvos = new Set<() => void>();
function assinarSalvos(aviso: () => void): () => void {
  ouvintesDosSalvos.add(aviso);
  window.addEventListener("storage", aviso);
  return () => {
    ouvintesDosSalvos.delete(aviso);
    window.removeEventListener("storage", aviso);
  };
}
function avisarSalvos(): void {
  for (const aviso of ouvintesDosSalvos) aviso();
}
function lerCruDosSalvos(): string {
  try {
    return armazenamentoLocal()?.getItem(CHAVE_DOS_FILTROS_SALVOS) ?? "";
  } catch {
    return "";
  }
}

const STATUS_OPTIONS: Array<{ value: NonNullable<LeadFilters["status"]>; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "open", label: "Abertos" },
  { value: "won", label: "Ganhos" },
  { value: "lost", label: "Perdidos" },
];

/**
 * Filtro como chip: a mesma altura dos controles do cabeçalho (44px no toque,
 * 32px no cursor) e, quando restringe o quadro, a cor de seleção — é o que
 * deixa ver de relance POR QUE o quadro está mostrando menos do que tem.
 */
function chip(ativo: boolean): string {
  return cn(
    "bg-surface lg:h-8",
    ativo
      ? "border-accent/40 bg-accent-soft text-accent hover:border-accent/60 hover:bg-accent-soft"
      : "text-text-muted hover:text-text",
  );
}

export function FilterBar({ filters, onChange, leads, settings, pipelineId }: FilterBarProps) {
  const t = useT();
  const user = useUser();
  const { data: members } = useAssignableMembers(true);
  const { data: agents } = useAssignableAgents(true);
  const [searchInput, setSearchInput] = useState(filters.search ?? "");

  // Debounce search 250ms
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.search ?? "") !== searchInput) {
        onChange({ ...filters, search: searchInput });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  /**
   * Quem OFERECE lê a MESMA regra de quem FILTRA (`applyFilters`) — ver
   * lib/kanban/marcadores-do-card.ts. Antes eram só `l.tags`, a caixa do
   * negócio: o marcador escrito no CONTATO não aparecia aqui nem casava lá.
   *
   * A varredura alcança o funil inteiro: a rota do quadro devolve todos os
   * cards de uma vez, sem paginar.
   */
  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) for (const t of marcadoresDoCard(l)) set.add(t);
    return Array.from(set).sort();
  }, [leads]);

  const filteredAgentId = parseAgentOwnerFilter(filters.owner);

  /**
   * OS FILTROS SALVOS (fase 1, item 1.6) — por aparelho e por funil, ver
   * `lib/kanban/filtros-salvos.ts`. Lidos por `useSyncExternalStore`, e não no
   * inicializador de um `useState`: o primeiro render é o do servidor, onde
   * `localStorage` não existe, e o retrato do servidor (`""`) mantém a
   * hidratação igual. De brinde, outra aba que salve ou apague atualiza esta.
   */
  const cruDosSalvos = useSyncExternalStore(assinarSalvos, lerCruDosSalvos, () => "");
  const salvos = useMemo<FiltroSalvo[]>(
    () => (pipelineId && cruDosSalvos ? lerFiltrosSalvos(armazenamentoLocal(), pipelineId) : []),
    [pipelineId, cruDosSalvos],
  );
  const [salvarAberto, setSalvarAberto] = useState(false);
  const [nomeDoFiltro, setNomeDoFiltro] = useState("");
  const aplicarSalvo = (salvo: FiltroSalvo) => {
    const proximos = filtrosDoSalvo(salvo);
    // A busca tem estado próprio (o debounce): sem isto o campo mostraria a
    // busca velha e, na próxima tecla, devolveria o filtro antigo ao quadro.
    setSearchInput(proximos.search ?? "");
    onChange(proximos);
  };
  const confirmarSalvar = (e: FormEvent) => {
    e.preventDefault();
    if (!pipelineId || !nomeDoFiltro.trim()) return;
    salvarFiltro(armazenamentoLocal(), pipelineId, nomeDoFiltro, filters);
    avisarSalvos();
    setSalvarAberto(false);
    setNomeDoFiltro("");
  };

  /**
   * Responsáveis atribuíveis numa lista única — humanos e agentes ordenados
   * juntos. O dono de um lead é UM campo; quem pode ser dono aparece numa lista
   * só. A distinção é geométrica (avatar), nunca posicional.
   */
  const assignees = useMemo(() => {
    type Row = {
      key: string;
      owner: string;
      name: string;
      kind: OwnerKind;
      version: number | null;
    };
    const rows: Row[] = [
      ...(members ?? [])
        .filter((m) => m.user_id !== user.id)
        .map((m) => ({
          key: `u:${m.user_id}`,
          owner: m.user_id,
          name: rotuloDoMembro(m, t),
          kind: "user" as OwnerKind,
          version: null,
        })),
      ...(agents ?? []).map((a) => ({
        key: `a:${a.agent_id}`,
        owner: agentOwnerFilter(a.agent_id),
        name: a.name,
        kind: "ai" as OwnerKind,
        version: a.version_number,
      })),
    ];
    return rows.sort((x, y) => x.name.localeCompare(y.name, "pt-BR"));
  }, [members, agents, user.id, t]);
  const ownerLabel =
    filters.owner === "unassigned"
      ? t("Sem responsável")
      : !filters.owner || filters.owner === "any"
        ? t("Todos")
        : filteredAgentId
          ? (agents?.find((a) => a.agent_id === filteredAgentId)?.name ?? t("Agente"))
          : filters.owner === user.id
            ? t("Eu")
            : (members?.find((m) => m.user_id === filters.owner)?.full_name ?? t("Responsável"));

  const statusLabel = t(
    STATUS_OPTIONS.find((o) => o.value === (filters.status ?? "all"))?.label ?? "Todos",
  );

  // ⚠️ O RÓTULO DO GATILHO RESUME, E NÃO CORTA O FILTRO (#1274). O nome da
  // primeira etiqueta e o resto viram contagem: o que importa na tela é que há
  // filtro com DUAS etiquetas, e não qual é a segunda — ela está no menu, com a
  // caixa marcada. Uma etiqueta só mostra o nome dela, como sempre.
  const marcadoresEscolhidos = marcadoresDoFiltro(filters.tag);
  const tagLabel =
    marcadoresEscolhidos.length === 0
      ? t("Tag: todas")
      : marcadoresEscolhidos.length === 1
        ? `${t("Tag")}: ${marcadoresEscolhidos[0]}`
        : `${t("Tag")}: ${marcadoresEscolhidos[0]} +${marcadoresEscolhidos.length - 1}`;
  const alternaEtiqueta = (tag: string) => {
    const escolhida = marcadoresEscolhidos.includes(tag);
    const proximas = escolhida
      ? marcadoresEscolhidos.filter((m) => m !== tag)
      : [...marcadoresEscolhidos, tag];
    onChange({
      ...filters,
      tag: proximas.length === 0 ? undefined : proximas,
      // O modo só faz sentido com DUAS: `?tag=vip&modo=ou` é um link que não
      // significa nada, e a chave de cache/url mudaria à toa.
      tagMode: proximas.length > 1 ? filters.tagMode : undefined,
    });
  };

  /**
   * Motivo e categoria da perda (issue #1537). As opções vêm do que ESTÁ no
   * quadro, não do cadastro: um motivo que nenhum card tem nunca acharia nada.
   * A categoria resolve pela MESMA régua de quem filtra (`applyFilters` →
   * `categoriaDoMotivo`), porque filtrar por uma regra e mostrar por outra é o
   * defeito que o filtro de marcador já teve.
   */
  const motivosPerdidos = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) if (l.status === "lost" && l.lost_reason) set.add(l.lost_reason);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [leads]);
  const categoriasPerdidas = useMemo(() => {
    /**
     * AS CATEGORIAS DO FUNIL ENTRAM AQUI (#4437). A conta antiga era só o que
     * está no quadro, e isso tem dois buracos: a categoria que o funil declara
     * mas nenhum card perdido usa ainda não aparece (ninguém consegue filtrar
     * por ela depois de cadastrá-la), e o motivo SEM categoria não aparecia de
     * jeito nenhum — perdido, e inalcançável por qualquer recorte de categoria.
     * `categoriasDoFunil` é a régua do funil (declaradas + em uso); o sentinela
     * entra só quando existe card nesse estado, e é o MESMO texto do relatório.
     */
    const set = new Set<string>(categoriasDoFunil(settings));
    let temSemCategoria = false;
    for (const motivo of motivosPerdidos) {
      const categoria = categoriaDoMotivo(motivo, settings);
      if (categoria) set.add(categoria);
      else temSemCategoria = true;
    }
    if (temSemCategoria) set.add(SEM_CATEGORIA);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [motivosPerdidos, settings]);
  /** Só com a aba em Perdidos: fora dela os dois filtros esconderiam tudo. */
  const mostraPerda = (filters.status ?? "all") === "lost" && motivosPerdidos.length > 0;
  // Canônico vira o rótulo traduzido; motivo próprio do funil é dado e sai como está.
  const rotuloDoMotivo = (motivo: string) => {
    const rotulo = rotuloDoMotivoDePerda(motivo);
    return rotulo === motivo ? motivo : t(rotulo);
  };
  const motivoLabel = filters.lostReason ? rotuloDoMotivo(filters.lostReason) : t("Todos");
  // O sentinela é texto do PRODUTO (traduzível); categoria de negócio é dado.
  // O literal vai escrito no ramo de propósito: `t(variável)` traduziria dado do
  // operador (a régua de `i18n-espanhol-cobre-a-tela`), e categoria de negócio
  // na tela tem de aparecer exatamente como foi cadastrada.
  const categoriaLabel =
    filters.lostCategory === SEM_CATEGORIA
      ? t("Sem categoria")
      : (filters.lostCategory ?? t("Todas"));

  const temFiltro = Boolean(
    filters.search ||
    filters.owner ||
    marcadoresEscolhidos.length > 0 ||
    filters.overdueOnly ||
    filters.lostReason ||
    filters.lostCategory ||
    (filters.status && filters.status !== "all"),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="search"
        placeholder={t("Buscar por título…")}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="w-full sm:w-60"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={chip(!!filters.owner && filters.owner !== "any")}
          >
            {t("Responsável")}: {ownerLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("Responsável")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: "any" })}>
            {t("Todos")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: "unassigned" })}>
            {t("Sem responsável")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onChange({ ...filters, owner: user.id })}>
            {t("Eu")}
          </DropdownMenuItem>
          {/*
            Humanos e agentes numa lista SÓ, ordenados juntos por nome. Não existe
            separador entre eles: separador agrupa, e agrupar comunica "as pessoas,
            e depois também os bots" — segregação por posição, que é a mesma ideia
            do badge "AI" colorido que o contrato de UI proíbe. Quem distingue é o
            avatar (disco preenchido = humano, círculo vazado com anel = agente),
            reusando o OwnerBadge do card para os dois não divergirem.
            O separador ACIMA (linha do "Eu") fica: ele divide as opções meta
            (Todos / Sem responsável / Eu) das pessoas, e ali agrupar está certo.
          */}
          {assignees.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {assignees.map((a) => (
                <DropdownMenuItem
                  key={a.key}
                  onClick={() => onChange({ ...filters, owner: a.owner })}
                >
                  <OwnerBadge ownerKind={a.kind} ownerName={a.name} agentVersion={a.version} />
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={chip(!!filters.status && filters.status !== "all")}
          >
            {t("Status")}: {statusLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {STATUS_OPTIONS.map((o) => (
            <DropdownMenuItem
              key={o.value}
              onClick={() => onChange({ ...filters, status: o.value })}
            >
              {t(o.label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {mostraPerda ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={chip(!!filters.lostReason)}>
                {t("Motivo")}: {motivoLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onChange({ ...filters, lostReason: undefined })}>
                {t("Todos")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {motivosPerdidos.map((motivo) => (
                <DropdownMenuItem
                  key={motivo}
                  onClick={() => onChange({ ...filters, lostReason: motivo })}
                >
                  {rotuloDoMotivo(motivo)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {categoriasPerdidas.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={chip(!!filters.lostCategory)}>
                  {t("Categoria")}: {categoriaLabel}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => onChange({ ...filters, lostCategory: undefined })}>
                  {t("Todas")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {categoriasPerdidas.map((categoria) => (
                  <DropdownMenuItem
                    key={categoria}
                    onClick={() => onChange({ ...filters, lostCategory: categoria })}
                  >
                    {categoria === SEM_CATEGORIA ? t("Sem categoria") : categoria}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={tagOptions.length === 0}
            className={chip(marcadoresEscolhidos.length > 0)}
          >
            {marcadoresEscolhidos[0] ? (
              <PontoDaEtiqueta tag={marcadoresEscolhidos[0]} className="mr-2" />
            ) : null}
            {tagLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => onChange({ ...filters, tag: undefined, tagMode: undefined })}
          >
            {t("Todas")}
          </DropdownMenuItem>
          {/* O E/OU só aparece com DUAS etiquetas. Com uma só o parâmetro não
              muda o resultado — e um controle que não muda nada é pior do que
              nenhum. */}
          {marcadoresEscolhidos.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={filters.tagMode === "ou" ? "ou" : "e"}
                onValueChange={(modo) =>
                  onChange({ ...filters, tagMode: modo === "ou" ? "ou" : undefined })
                }
              >
                <DropdownMenuRadioItem value="e">{t("Todas (E)")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ou">{t("Qualquer uma (OU)")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
          <DropdownMenuSeparator />
          {/* Checkbox, e não item comum: `DropdownMenuCheckboxItem` marca e NÃO
              fecha o menu, que é o que permite escolher a segunda etiqueta sem
              reabrir o menu. O `onSelect` com `preventDefault` trava esse
              comportamento, porque o item de checkbox fecha por padrão. */}
          {tagOptions.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag}
              checked={marcadoresEscolhidos.includes(tag)}
              onCheckedChange={() => alternaEtiqueta(tag)}
              onSelect={(e) => e.preventDefault()}
            >
              <PontoDaEtiqueta tag={tag} className="mr-2" />
              {tag}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <label
        className={cn(
          "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors select-none hover:border-border-strong lg:h-8",
          chip(!!filters.overdueOnly),
        )}
      >
        <input
          type="checkbox"
          checked={!!filters.overdueOnly}
          className="h-3.5 w-3.5 accent-accent"
          onChange={(e) => onChange({ ...filters, overdueOnly: e.target.checked })}
        />
        {t("Apenas atrasados")}
      </label>

      {/*
        FILTROS SALVOS (fase 1, item 1.6). Um seletor só, para aplicar, apagar
        e salvar: aparece quando há o que salvar (filtro ativo) ou o que
        aplicar (algum salvo). Chip neutro — ele não restringe o quadro, quem
        restringe são os chips que ele liga.
      */}
      {pipelineId && (temFiltro || salvos.length > 0) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={chip(false)}
              data-testid="filtros-salvos"
            >
              {t("Filtros salvos")}
              {salvos.length > 0 ? (
                <span className="ml-1 text-text-subtle tabular-nums">{salvos.length}</span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {salvos.map((salvo) => (
              <div key={salvo.nome} className="flex items-center">
                <DropdownMenuItem
                  className="min-w-0 flex-1 max-lg:min-h-11"
                  onSelect={() => aplicarSalvo(salvo)}
                  data-testid="filtro-salvo"
                >
                  <span className="truncate">{salvo.nome}</span>
                </DropdownMenuItem>
                {/* Apagar não fecha o menu: quem limpa a lista costuma apagar
                    mais de um. */}
                <DropdownMenuItem
                  aria-label={`${t("Apagar")}: ${salvo.nome}`}
                  className="shrink-0 justify-center px-2 text-text-subtle hover:text-text max-lg:min-h-11 max-lg:min-w-11"
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!pipelineId) return;
                    apagarFiltroSalvo(armazenamentoLocal(), pipelineId, salvo.nome);
                    avisarSalvos();
                  }}
                >
                  <X size={14} aria-hidden />
                </DropdownMenuItem>
              </div>
            ))}
            {salvos.length > 0 && temFiltro ? <DropdownMenuSeparator /> : null}
            {temFiltro ? (
              <DropdownMenuItem className="max-lg:min-h-11" onSelect={() => setSalvarAberto(true)}>
                {t("Salvar filtro")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {temFiltro && (
        <Button
          variant="ghost"
          size="sm"
          className="text-text-muted hover:text-text lg:h-8"
          onClick={() => {
            setSearchInput("");
            onChange({ status: "all" });
          }}
        >
          {t("Limpar filtros")}
        </Button>
      )}

      <Dialog
        open={salvarAberto}
        onOpenChange={(aberto) => {
          setSalvarAberto(aberto);
          if (!aberto) setNomeDoFiltro("");
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={confirmarSalvar} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("Salvar filtro")}</DialogTitle>
              <DialogDescription>
                {t("Fica salvo neste aparelho, só para este funil.")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nome-do-filtro-salvo">{t("Nome do filtro")}</Label>
              <Input
                id="nome-do-filtro-salvo"
                value={nomeDoFiltro}
                maxLength={TAMANHO_MAXIMO_DO_NOME}
                autoFocus
                onChange={(e) => setNomeDoFiltro(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSalvarAberto(false)}>
                {t("Cancelar")}
              </Button>
              <Button type="submit" disabled={!nomeDoFiltro.trim()}>
                {t("Salvar")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
