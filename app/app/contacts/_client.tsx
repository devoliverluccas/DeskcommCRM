"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";
import {
  Plus,
  DownloadSimple,
  MagnifyingGlass,
  UploadSimple,
  UsersThree,
  ArrowsClockwise,
  Warning,
} from "@/lib/ui/icons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useContactList } from "@/hooks/contacts/useContactList";
import { useBulkContacts, type AcaoEmLoteDeContatos } from "@/hooks/contacts/useBulkContacts";
import { useSelecaoEmLote } from "@/hooks/contacts/useSelecaoEmLote";
import { ContactsTable } from "@/components/contacts/ContactsTable";
import { BarraDeContatosEmLote } from "@/components/contacts/BarraDeContatosEmLote";
import { PontoDaEtiqueta } from "@/components/tags/PontoDaEtiqueta";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { ImportContactsDialog } from "@/components/contacts/ImportContactsDialog";
import { SyncPhoneContactsDialog } from "@/components/contacts/SyncPhoneContactsDialog";
import { TAG_DE_CLIENTE } from "@/lib/contacts/cliente";
import { queryDaExportacao, type FormatoDeExport } from "@/lib/contacts/exportar";
import { roleAtLeast } from "@/lib/auth/types";
import { ORIGEM_AGENDA_DO_CELULAR } from "@/lib/leads/origem-do-contato";
import { type ModoDeEtiqueta } from "@/lib/inbox/marcador-da-conversa";
import { useActiveOrg, usePermission } from "@/hooks/auth/AuthProvider";
import { MergeDialog } from "@/components/contacts/MergeDialog";
import { EmptyContacts, EmptyFilterResults, EmptyState } from "@/components/empty";
import { PageHeader } from "@/components/app/PageHeader";
import { cn } from "@/lib/utils";
import type { ContactOrderBy } from "@/lib/schemas/contacts";

const SOURCE_OPTIONS = [
  { value: undefined, label: "Todas as origens" },
  { value: "manual", label: "Manual" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "site", label: "Site (landing page)" },
  { value: "nuvemshop", label: "Nuvemshop" },
  { value: "import_csv", label: "Importado (CSV)" },
  { value: ORIGEM_AGENDA_DO_CELULAR, label: "Agenda do celular" },
  // Os dois valores que a atribuição de anúncio grava em `contacts.source`
  // (`PlataformaDeAnuncio` em lib/leads/atribuicao-de-anuncio.ts). Sem eles, o
  // contato que veio de um clique em anúncio existe no banco e não é
  // alcançável por nenhum filtro desta tela. O handler aceita qualquer valor
  // (`_handler.ts:167` faz `eq("source", q.source)`), então a lista é a única
  // porta — e ela estava incompleta desde que a atribuição passou a existir.
  { value: "meta_ads", label: "Anúncio da Meta" },
  { value: "google_ads", label: "Anúncio do Google" },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

/** Chip de filtro: compacto no mouse, 44px no toque; ativo em `accent-soft`. */
function chip(ativo: boolean) {
  return cn(
    "bg-surface lg:h-8",
    ativo && "border-accent/40 bg-accent-soft text-accent hover:bg-accent-soft hover:border-accent/60",
  );
}

export function ContactsListClient() {
  const t = useT();
  const orgAtiva = useActiveOrg();
  const clientesLigado = orgAtiva?.cliente_pela_agenda === true;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // VÁRIAS etiquetas com E/OU (#1274). O estado é a LISTA, e uma etiqueta só é
  // a lista de um — o que faz "nenhuma escolha" e "vip escolhida" passarem pelo
  // mesmo caminho, e impede a segunda forma de nascer daqui.
  const [tags, setTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<ModoDeEtiqueta | undefined>(undefined);
  const [source, setSource] = useState<string | undefined>(undefined);
  // Só pessoais (spec 21, etapa 15 — filtro "Pessoais"): ligado lista SÓ
  // pessoais (`?pessoais=true`, etapa 13); desligado é o padrão que exclui.
  const [soPessoais, setSoPessoais] = useState(false);
  const [orderBy, setOrderBy] = useState<ContactOrderBy>("last_activity_at");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState<number>(25);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [duplicadosOpen, setDuplicadosOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(
    () => ({
      search,
      tag: tags.length > 0 ? tags : undefined,
      tagMode,
      source,
      pessoais: soPessoais || undefined,
      order_by: orderBy,
      order_dir: orderDir,
      limit,
    }),
    [search, tags, tagMode, source, soPessoais, orderBy, orderDir, limit],
  );
  const q = useContactList(filters);

  // LOTE (#2484, fatia F3): a seleção múltipla e a barra de ações dos contatos.
  // O portão de tela é o MESMO piso da edição individual (`contact.update` —
  // agent+); quem só lê nem vê a barra. (A rota ainda valida por conta própria:
  // este portão é de tela, a fonte da regra é a API.)
  const podeAgirEmLote = usePermission("contact.update");
  const podeMudarResponsavel = usePermission("contact.carteira");
  const selecao = useSelecaoEmLote();
  const lote = useBulkContacts();

  const rodarLote = useCallback(
    (args: AcaoEmLoteDeContatos) => {
      const ids = Array.from(selecao.selecionados);
      if (ids.length === 0) return;
      lote.mutate(
        { ids, ...args },
        {
          // A seleção é limpa depois do lote, aconteça o que acontecer: manter
          // marcados os contatos recusados (de outra organização, inexistentes)
          // deixaria a barra no lugar mensageando um lote que não existe mais.
          onSuccess: () => selecao.limpar(),
        },
      );
    },
    [lote, selecao],
  );

  const allContacts = useMemo(
    () => q.data?.pages.flatMap((p) => p.data) ?? [],
    [q.data],
  );

  const tagOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of allContacts) for (const tag of c.tags) set.add(tag);
    // `cliente` na lista mesmo que nenhum contato da página carregada a tenha —
    // COM A REGRA LIGADA. As demais opções saem do que já foi paginado — o que
    // basta para etiqueta que a equipe criou e usa em bloco, e falha justamente
    // para esta, que o sistema escreve sozinho e cujo primeiro uso é "filtrar
    // quem já é cliente" numa base grande, onde a primeira página pode não ter
    // nenhum. Desligada, a opção fixa ofereceria um filtro de uma regra que não
    // roda; quem já tem a etiqueta continua aparecendo pela linha de cima.
    if (clientesLigado) set.add(TAG_DE_CLIENTE);
    return Array.from(set).sort();
  }, [allContacts, clientesLigado]);

  const handleSort = useCallback(
    (column: ContactOrderBy) => {
      if (column === orderBy) {
        setOrderDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setOrderBy(column);
        setOrderDir(column === "display_name" ? "asc" : "desc");
      }
    },
    [orderBy],
  );

  // O MESMO gate da rota (`requireRole("manager")`): um botão que só devolve
  // 403 é armadilha — quem tem papel de leitura nem vê a porta.
  const podeExportar = roleAtLeast(orgAtiva?.role, "manager");

  /**
   * Exportar é exportar o QUE A TELA ESTÁ MOSTRANDO: os mesmos filtros da lista
   * viajam na query (busca, etiquetas em E/OU, origem, pessoais), sem `cursor`
   * nem `limit` — o arquivo é o conjunto filtrado inteiro, não a página que a
   * pessoa rolou até aqui.
   */
  const exportar = useCallback(
    (formato: FormatoDeExport) => {
      const qs = queryDaExportacao(formato, {
        search,
        tags,
        tagMode,
        source,
        pessoais: soPessoais,
        order_by: orderBy,
        order_dir: orderDir,
      });
      // `Content-Disposition: attachment` na resposta faz o navegador baixar,
      // não navegar — o mesmo gesto do "Exportar CSV" da tela de auditoria.
      window.location.href = `/api/v1/contacts/export?${qs}`;
    },
    [search, tags, tagMode, source, soPessoais, orderBy, orderDir],
  );

  const filtrando = Boolean(search || tags.length > 0 || source || soPessoais);
  const limparFiltros = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setTags([]);
    setTagMode(undefined);
    setSource(undefined);
    setSoPessoais(false);
  }, []);

  return (
    <div className="space-y-4 md:p-2">
      {/*
        As ações SECUNDÁRIAS (duplicados, importar, sincronizar, exportar) moram
        no "⋯" abaixo de `md`: antes eram cinco botões empilhados em três linhas
        de 44px antes do primeiro contato. De `md` para cima continuam botões com
        o mesmo nome. "Novo contato" fica sozinho e visível em toda largura.
        - Duplicados: a porta fica nesta tela porque é olhando a lista que se
          descobre contato repetido.
        - Sincronizar agenda (#2736) ao lado do Importar CSV: os dois trazem base
          de fora.
        - Exportar: dois formatos, dois destinos (CSV e vCard) num menu.
      */}
      <PageHeader
        title={t("Contatos")}
        subtitle={t("Customer 360 — busque, filtre e gerencie contatos.")}
        secondaryActions={[
          { label: t("Duplicados"), icon: UsersThree, onSelect: () => setDuplicadosOpen(true) },
          { label: t("Importar CSV"), icon: UploadSimple, onSelect: () => setImportOpen(true) },
          { label: t("Sincronizar agenda"), icon: ArrowsClockwise, onSelect: () => setSyncOpen(true) },
          // O MESMO gate da rota de exportação (`requireRole("manager")`).
          ...(podeExportar
            ? [
                {
                  label: t("Exportar"),
                  icon: DownloadSimple,
                  items: [
                    { label: t("Exportar CSV"), onSelect: () => exportar("csv") },
                    { label: t("Exportar vCard"), onSelect: () => exportar("vcf") },
                  ],
                },
              ]
            : []),
        ]}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} weight="bold" aria-hidden />
            <span>{t("Novo contato")}</span>
          </Button>
        }
      />

      {/* Filtros sem moldura, numa linha que quebra: busca e chips. Chip ativo
          em `accent-soft` (seleção de dado), parado em `bg-surface`. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle"
            aria-hidden
          />
          <Input
            type="search"
            placeholder={t("Buscar por nome, email ou telefone…")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={tagOptions.length === 0}
              className={chip(tags.length > 0)}
            >
              {tags[0] ? <PontoDaEtiqueta tag={tags[0]} className="mr-2" /> : null}
              {/* Resumo, e não a lista inteira: o gatilho tem a largura do filtro de
                  origem ao lado. Uma etiqueta mostra o nome; duas mostram a
                  primeira e o resto em contagem. */}
              {tags.length === 0
                ? `${t("Tag")}: ${t("todas")}`
                : tags.length === 1
                  ? `${t("Tag")}: ${tags[0]}`
                  : `${t("Tag")}: ${tags[0]} +${tags.length - 1}`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("Tag")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setTags([]);
                setTagMode(undefined);
              }}
            >
              {t("Todas")}
            </DropdownMenuItem>
            {/* O E/OU so aparece com DUAS etiquetas: com uma so o parametro nao
                muda o resultado, e um controle que nao muda nada e pior do que
                nenhum. */}
            {tags.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={tagMode === "ou" ? "ou" : "e"}
                  onValueChange={(modo) => setTagMode(modo === "ou" ? "ou" : undefined)}
                >
                  <DropdownMenuRadioItem value="e">{t("Todas (E)")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="ou">{t("Qualquer uma (OU)")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </>
            )}
            <DropdownMenuSeparator />
            {/* `DropdownMenuCheckboxItem` marca e NAO fecha o menu — e o
                `onSelect` com `preventDefault` trava esse comportamento, porque
                o item de checkbox fecha por padrao. Sem isso, escolher a segunda
                etiqueta exigiria reabrir o menu. */}
            {tagOptions.map((tagOption) => (
              <DropdownMenuCheckboxItem
                key={tagOption}
                checked={tags.includes(tagOption)}
                onCheckedChange={() => {
                  const escolhida = tags.includes(tagOption);
                  const proximas = escolhida
                    ? tags.filter((et) => et !== tagOption)
                    : [...tags, tagOption];
                  setTags(proximas);
                  // O modo so faz sentido com DUAS: com uma so ele nao muda o
                  // resultado, e o `&modo=ou` na URL seria ruido.
                  setTagMode(proximas.length > 1 ? tagMode : undefined);
                }}
                onSelect={(e) => e.preventDefault()}
              >
                <PontoDaEtiqueta tag={tagOption} className="mr-2" />
                {tagOption}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={chip(source !== undefined)}>
              {t(SOURCE_OPTIONS.find((s) => s.value === source)?.label ?? "Origem")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {SOURCE_OPTIONS.map((s) => (
              <DropdownMenuItem key={s.label} onClick={() => setSource(s.value)}>
                {t(s.label)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Só pessoais: o filtro que acha quem saiu da operação — e a porta do
            desmarcar em lote mental (abre a ficha e desmarca um a um). O
            `data-testid` é contrato do e2e da spec. */}
        <Button
          variant="outline"
          size="sm"
          className={chip(soPessoais)}
          data-testid="filtro-pessoais"
          aria-pressed={soPessoais}
          onClick={() => setSoPessoais((v) => !v)}
        >
          {t("Pessoais")}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className={chip(false)}>
              {limit} {t("por página")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t("Itens por página")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {PAGE_SIZE_OPTIONS.map((n) => (
              <DropdownMenuItem key={n} onClick={() => setLimit(n)}>
                {n}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {filtrando && (
          <Button
            variant="ghost"
            size="sm"
            className="text-text-muted lg:h-8"
            onClick={limparFiltros}
          >
            {t("Limpar filtros")}
          </Button>
        )}
      </div>

      {podeAgirEmLote && (
        <BarraDeContatosEmLote
          quantidade={selecao.quantidade}
          pendente={lote.isPending}
          onAdicionarEtiqueta={(tag) => rodarLote({ action: "tag", op: "add", tag })}
          onRemoverEtiqueta={(tag) => rodarLote({ action: "tag", op: "remove", tag })}
          onMudarResponsavel={
            podeMudarResponsavel
              ? (donoUserId) =>
                  rodarLote({ action: "carteira", dono_user_id: donoUserId, origem: "manual" })
              : undefined
          }
          onPreencherCampo={(chave, valor) => rodarLote({ action: "custom-field", chave, valor })}
          onLimpar={selecao.limpar}
        />
      )}

      {q.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <EmptyState
          icon={Warning}
          headline={t("Erro ao carregar contatos.")}
          primary={{ label: t("Tentar novamente"), onClick: () => void q.refetch() }}
        />
      ) : allContacts.length === 0 ? (
        // Com filtro, "nenhum contato ainda" mentiria: a base existe, o filtro
        // é que não casa. A saída é limpar, não esperar contato chegar.
        filtrando ? (
          <EmptyFilterResults primary={{ label: t("Limpar filtros"), onClick: limparFiltros }} />
        ) : (
          <EmptyContacts />
        )
      ) : (
        <>
          {/* Abaixo de `md` a tabela vira cartão e o cabeçalho some, levando a
              caixa "selecionar todas": este botão é a porta que a substitui. */}
          {podeAgirEmLote && (
            <Button
              size="sm"
              variant="outline"
              className="md:hidden"
              onClick={() => selecao.selecionarTodos(allContacts.map((c) => c.id))}
            >
              {t("Selecionar todos os contatos visíveis")}
            </Button>
          )}
          {/* Sem cartão em volta: a tabela ocupa a largura útil e a borda de
              cima separa do filtro. */}
          <div className="border-t border-border">
            <ContactsTable
              contacts={allContacts}
              orderBy={orderBy}
              orderDir={orderDir}
              onSort={handleSort}
              // Sem `contact.update` não há barra, então as caixas seriam um
              // controle que marca e não leva a nada: a tabela só as desenha
              // quando recebe `onAlternarSelecao`.
              selecionados={podeAgirEmLote ? selecao.selecionados : undefined}
              onAlternarSelecao={podeAgirEmLote ? selecao.alternar : undefined}
              onSelecionarTodosVisiveis={
                podeAgirEmLote
                  ? () => selecao.selecionarTodos(allContacts.map((c) => c.id))
                  : undefined
              }
            />
          </div>
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <p className="text-sm tabular-nums text-text-muted">
              {allContacts.length} {allContacts.length === 1 ? t("contato") : t("contatos")}
              {q.hasNextPage ? ` ${t("carregados — há mais resultados")}` : ""}
            </p>
            {q.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => q.fetchNextPage()}
                disabled={q.isFetchingNextPage}
              >
                {q.isFetchingNextPage ? t("Carregando…") : t("Carregar mais")}
              </Button>
            )}
          </div>
        </>
      )}

      <NewContactDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportContactsDialog open={importOpen} onOpenChange={setImportOpen} />
      <SyncPhoneContactsDialog open={syncOpen} onOpenChange={setSyncOpen} />
      <MergeDialog open={duplicadosOpen} onOpenChange={setDuplicadosOpen} />
    </div>
  );
}
