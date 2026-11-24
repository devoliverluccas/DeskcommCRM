"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api/client";
import { queryDaTela, SEM_FILTROS, type FiltrosDoCatalogo } from "@/lib/catalogo/busca-da-tela";
import { MAXIMO_DE_FOTOS } from "@/lib/catalogo/fotos";
import { emPromocao, precoVigente } from "@/lib/catalogo/preco";
import { promocionalDoTexto } from "@/lib/catalogo/edicao-do-produto";
import { formatCents } from "@/lib/money";
import { precoParaCentavos, PROMOCAO_ACIMA_DO_PRECO, type Produto } from "@/lib/schemas/produtos";
import { ImageSquare, List } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { EdicaoDoProduto } from "./_edicao";

interface Textos {
  titulo: string;
  subtitulo: string;
  vazio: string;
  vazioDica: string;
}

interface ResumoDaImportacao {
  total_linhas: number;
  criados: number;
  atualizados: number;
  /** Quantos produtos tiveram a descrição escrita pela planilha. */
  descricoes?: number;
  erros: Array<{ linha: number; motivo: string }>;
  colunas_ignoradas: string[];
}

interface Rascunho {
  codigo: string;
  nome: string;
  marca: string;
  categoria: string;
  capacidade: string;
  preco: string;
  promocional: string;
  custo: string;
  quantidade: string;
  controla_estoque: boolean;
  descricao: string;
}

const VAZIO: Rascunho = {
  codigo: "",
  nome: "",
  marca: "",
  categoria: "",
  capacidade: "",
  preco: "",
  promocional: "",
  custo: "",
  quantidade: "0",
  controla_estoque: true,
  descricao: "",
};

/** Como a lista aparece. A escolha fica no navegador: é gosto de quem olha, não dado. */
type Vista = "lista" | "grade";
const CHAVE_DA_VISTA = "produtos.vista";

/**
 * A vista guardada, lida como armazenamento externo (`useSyncExternalStore`):
 * o servidor e o primeiro desenho dizem "lista" (sem divergência de
 * hidratação) e a escolha guardada entra em seguida, sem setState em efeito.
 * Navegador sem armazenamento (aba privada restrita): a escolha vale na visita.
 */
const ouvintesDaVista = new Set<() => void>();
let vistaSemArmazenamento: Vista | null = null;
function lerVista(): Vista {
  try {
    return window.localStorage.getItem(CHAVE_DA_VISTA) === "grade" ? "grade" : "lista";
  } catch {
    return vistaSemArmazenamento ?? "lista";
  }
}
function assinarVista(avisar: () => void): () => void {
  ouvintesDaVista.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    ouvintesDaVista.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}
function gravarVista(nova: Vista): void {
  try {
    window.localStorage.setItem(CHAVE_DA_VISTA, nova);
  } catch {
    vistaSemArmazenamento = nova;
  }
  for (const avisar of ouvintesDaVista) avisar();
}

const CAMPO = "mt-1 h-9 min-h-11 w-full rounded-md border border-border bg-surface px-3 lg:min-h-0";

function doRascunho(
  r: Rascunho,
  t: (s: string) => string,
): Record<string, unknown> | { erro: string } {
  const preco_cents = precoParaCentavos(r.preco);
  if (preco_cents === null) return { erro: t("Preço inválido. Escreva assim: 5.499,00") };
  const custo_cents = r.custo.trim() === "" ? null : precoParaCentavos(r.custo);
  if (r.custo.trim() !== "" && custo_cents === null) return { erro: t("Custo inválido.") };
  // Mesma régua do formulário de edição e do CHECK do banco (migration 9481).
  const promocional = promocionalDoTexto(r.promocional);
  if (promocional === "invalido") return { erro: t("Preço promocional inválido.") };
  if (promocional !== null && promocional >= preco_cents) return { erro: t(PROMOCAO_ACIMA_DO_PRECO) };

  return {
    codigo: r.codigo.trim(),
    nome: r.nome.trim(),
    ...(r.marca.trim() ? { marca: r.marca.trim() } : {}),
    ...(r.categoria.trim() ? { categoria: r.categoria.trim() } : {}),
    ...(r.capacidade.trim() ? { capacidade: r.capacidade.trim() } : {}),
    preco_cents,
    ...(promocional !== null ? { preco_promocional_cents: promocional } : {}),
    custo_cents,
    controla_estoque: r.controla_estoque,
    quantidade: Number(r.quantidade) || 0,
    ...(r.descricao.trim() ? { descricao: r.descricao.trim() } : {}),
  };
}

/**
 * O preço que vale agora. Em promoção, o de antes vem riscado na frente — o
 * mesmo par que o atendente de IA recebe (`preco` e `preco_original`).
 */
function Preco({ produto, className }: { produto: Produto; className?: string }) {
  const t = useT();
  if (!emPromocao(produto)) {
    return (
      <span className={cn("shrink-0 tabular-nums font-medium", className)}>
        {formatCents(produto.preco_cents, produto.moeda)}
      </span>
    );
  }
  return (
    <span className={cn("shrink-0 tabular-nums font-medium", className)} data-testid={`promocao-${produto.codigo}`}>
      <s className="mr-1.5 text-xs font-normal text-text-subtle">
        <span className="sr-only">{t("Preço sem promoção")}: </span>
        {formatCents(produto.preco_cents, produto.moeda)}
      </s>
      {formatCents(precoVigente(produto), produto.moeda)}
    </span>
  );
}

/** O selo de estoque da grade: dá para vender, acabou, ou a loja não conta. */
function SeloDeEstoque({ produto }: { produto: Produto }) {
  const t = useT();
  if (!produto.controla_estoque) return <Badge variant="neutral">{t("sem controle de estoque")}</Badge>;
  if (produto.quantidade > 0) {
    return (
      <Badge variant="success">
        {produto.quantidade} {t("em estoque")}
      </Badge>
    );
  }
  return <Badge variant="warning">{t("Sem estoque")}</Badge>;
}

/**
 * As fotos de UM produto: pôr, tirar e trocar a ordem. A primeira é a capa, e é
 * na ordem daqui que o atendente de IA as manda ao cliente.
 *
 * Toda mudança vai ao servidor e volta pelo `router.refresh()`: as URLs são
 * assinadas pela página, e a lista que vale é a do banco.
 */
function FotosDoProduto({ produto, urls }: { produto: Produto; urls: Record<string, string> }) {
  const t = useT();
  const router = useRouter();
  const [ocupado, setOcupado] = React.useState(false);
  const entradaRef = React.useRef<HTMLInputElement>(null);
  const fotos = produto.fotos ?? [];

  async function subir(arquivo: File) {
    setOcupado(true);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const res = await fetch(`/api/v1/products/${produto.id}/fotos`, { method: "POST", body: form });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(json?.error?.message ?? t("Não consegui enviar a foto."));
        return;
      }
      toast.success(t("Foto adicionada"));
      router.refresh();
    } catch {
      toast.error(t("Não consegui enviar a foto."));
    } finally {
      setOcupado(false);
      if (entradaRef.current) entradaRef.current.value = "";
    }
  }

  async function gravarOrdem(nova: string[], aviso: string) {
    setOcupado(true);
    try {
      await apiClient.put(`/api/v1/products/${produto.id}/fotos`, { fotos: nova });
      toast.success(aviso);
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setOcupado(false);
    }
  }

  function mover(i: number, delta: -1 | 1) {
    const nova = [...fotos];
    [nova[i], nova[i + delta]] = [nova[i + delta]!, nova[i]!];
    void gravarOrdem(nova, t("Ordem das fotos salva"));
  }

  return (
    <div className="border-t border-border bg-surface-elevated p-3" data-testid={`fotos-${produto.codigo}`}>
      <p className="mb-2 text-xs text-text-muted">
        {t("A primeira foto é a capa. O atendente de IA manda as fotos nesta ordem quando apresenta o produto.")}
      </p>
      <ul className="flex flex-wrap gap-3">
        {fotos.map((caminho, i) => (
          <li key={caminho} className="w-28" data-testid="foto-do-produto">
            {urls[caminho] ? (
              // URL assinada e curta, de outro host: `next/image` exigiria allowlist no build.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={urls[caminho]}
                alt={`${produto.nome} — ${t("foto")} ${i + 1}`}
                className="h-28 w-28 rounded-md border border-border object-cover"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-md border border-border text-xs text-text-muted">
                {t("Sem prévia")}
              </div>
            )}
            <div className="mt-1 flex justify-between">
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado || i === 0}
                onClick={() => mover(i, -1)}
                aria-label={t("Mover a foto para a esquerda")}
              >
                ←
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() => void gravarOrdem(fotos.filter((c) => c !== caminho), t("Foto removida"))}
                aria-label={t("Remover a foto")}
                data-testid="remover-foto"
              >
                ✕
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado || i === fotos.length - 1}
                onClick={() => mover(i, 1)}
                aria-label={t("Mover a foto para a direita")}
              >
                →
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <input
        ref={entradaRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        data-testid="arquivo-foto"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void subir(f);
        }}
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={ocupado || fotos.length >= MAXIMO_DE_FOTOS}
          onClick={() => entradaRef.current?.click()}
          data-testid="adicionar-foto"
        >
          {t(ocupado ? "Salvando…" : "Adicionar foto")}
        </Button>
        <span className="text-xs text-text-muted">
          {t("JPG ou PNG, até 5 MB. No máximo 5 fotos.")}
        </span>
      </div>
    </div>
  );
}

export function ProdutosClient({
  inicial,
  total,
  pagina,
  porPagina,
  buscaInicial,
  urlsDasFotos,
  podeEditar,
  capacidadeLigada = false,
  apresentacaoLigada = false,
  fonteDoFeed = null,
  categorias = [],
  filtros = SEM_FILTROS,
  parecidos = [],
  textos,
}: {
  /** A página atual, já filtrada no servidor (ver `lib/catalogo/busca-da-tela.ts`). */
  inicial: Produto[];
  /** Quantos produtos casam com a busca no catálogo INTEIRO, não só nesta página. */
  total: number;
  pagina: number;
  porPagina: number;
  buscaInicial: string;
  urlsDasFotos: Record<string, string>;
  podeEditar: boolean;
  /** A chave da empresa (`capacidade_do_produto`). Desligada, o campo não aparece. */
  capacidadeLigada?: boolean;
  apresentacaoLigada?: boolean;
  /** A seção do módulo `catalogo_por_feed`; `null` com o módulo desligado. */
  fonteDoFeed?: React.ReactNode;
  /** As categorias que existem no catálogo (`fn_categorias_do_catalogo`). */
  categorias?: string[];
  /** Os filtros que a URL pediu — a lista que veio já está filtrada. */
  filtros?: FiltrosDoCatalogo;
  /**
   * Quando o texto digitado não está em produto nenhum: os mais parecidos, pela
   * mesma busca do atendente de IA (`parecidosDaBusca`).
   */
  parecidos?: Produto[];
  textos: Textos;
}) {
  const t = useT();
  const router = useRouter();
  const [busca, setBusca] = React.useState(buscaInicial);
  const [carregando, iniciarNavegacao] = React.useTransition();

  // A URL pode mudar sem passar pela caixa: Voltar/Avançar do navegador, ou um
  // link. A página não remonta quando só as searchParams mudam, então a caixa
  // precisa acompanhar — senão o debounce abaixo via a caixa diferente da URL e
  // mandava de volta para a busca antiga. Quando a URL muda POR CAUSA da caixa
  // (o termo já é o mesmo, sem os espaços das pontas), nada a fazer: reescrever
  // a caixa tiraria o espaço que a pessoa acabou de digitar.
  const [buscaDaUrl, setBuscaDaUrl] = React.useState(buscaInicial);
  if (buscaInicial !== buscaDaUrl) {
    setBuscaDaUrl(buscaInicial);
    if (busca.trim() !== buscaInicial) setBusca(buscaInicial);
  }
  const [criando, setCriando] = React.useState(false);
  const [rascunho, setRascunho] = React.useState<Rascunho>(VAZIO);
  const [salvando, setSalvando] = React.useState(false);
  const [importando, setImportando] = React.useState(false);
  const [resumo, setResumo] = React.useState<ResumoDaImportacao | null>(null);
  const arquivoRef = React.useRef<HTMLInputElement>(null);
  const [fotosAbertas, setFotosAbertas] = React.useState<string | null>(null);
  const [editando, setEditando] = React.useState<string | null>(null);

  const vista = React.useSyncExternalStore<Vista>(assinarVista, lerVista, () => "lista");
  const escolherVista = gravarVista;

  // A busca vai à URL — e a URL, ao servidor, que procura no catálogo INTEIRO.
  // Os filtros vão junto, e trocar um deles volta para a página 1.
  const irPara = React.useCallback(
    (termo: string, novaPagina: number, novosFiltros: FiltrosDoCatalogo = filtros) => {
      const destino = queryDaTela(termo, novaPagina, novosFiltros) || "?";
      iniciarNavegacao(() => router.replace(destino, { scroll: false }));
    },
    [router, filtros],
  );

  React.useEffect(() => {
    if (busca.trim() === buscaInicial) return;
    // Espera a pessoa parar de digitar: cada consulta conta o catálogo inteiro.
    const timer = window.setTimeout(() => irPara(busca, 1), 350);
    return () => window.clearTimeout(timer);
  }, [busca, buscaInicial, irPara]);

  const primeiro = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const ultimo = Math.min(pagina * porPagina, total);
  const algumFiltro = filtros.categoria !== null || filtros.soComEstoque;

  async function salvar() {
    const corpo = doRascunho(rascunho, t);
    if ("erro" in corpo) {
      toast.error(corpo.erro as string);
      return;
    }
    setSalvando(true);
    try {
      await apiClient.post("/api/v1/products", corpo);
      toast.success(t("Produto cadastrado"));
      setRascunho(VAZIO);
      setCriando(false);
      router.refresh();
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  async function importar(arquivo: File) {
    setImportando(true);
    setResumo(null);
    try {
      const form = new FormData();
      form.append("file", arquivo);
      const res = await fetch("/api/v1/products/import", { method: "POST", body: form });
      const json = (await res.json()) as
        | { data: ResumoDaImportacao }
        | { error?: { message?: string } };
      if (!res.ok || !("data" in json)) {
        const msg = "error" in json ? json.error?.message : undefined;
        toast.error(msg ?? t("Não consegui ler essa planilha."));
        return;
      }
      // O resumo fica NA TELA, não num toast que some em 4 segundos: quem
      // importou 300 produtos precisa ler quais linhas foram recusadas e por quê.
      setResumo(json.data);
      router.refresh();
    } catch {
      toast.error(t("Não consegui enviar o arquivo."));
    } finally {
      setImportando(false);
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  }

  async function alternarAtivo(p: Produto) {
    try {
      await apiClient.patch(`/api/v1/products/${p.id}`, { ativo: !p.ativo });
      toast.success(t(p.ativo ? "Produto desativado" : "Produto reativado"));
      router.refresh();
    } catch (e) {
      showApiError(e);
    }
  }

  /** Os três botões de quem edita — os mesmos na lista e na grade. */
  function acoesDe(p: Produto) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditando((v) => (v === p.id ? null : p.id))}
          aria-expanded={editando === p.id}
          data-testid={`editar-${p.codigo}`}
        >
          {t("Editar")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFotosAbertas((v) => (v === p.id ? null : p.id))}
          aria-expanded={fotosAbertas === p.id}
          data-testid={`abrir-fotos-${p.codigo}`}
        >
          {t("Fotos")} ({p.fotos?.length ?? 0})
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void alternarAtivo(p)}
          data-testid={`alternar-${p.codigo}`}
        >
          {t(p.ativo ? "Desativar" : "Reativar")}
        </Button>
      </>
    );
  }

  /** Os painéis que abrem debaixo do produto: fotos e edição. */
  function paineisDe(p: Produto) {
    return (
      <>
        {podeEditar && fotosAbertas === p.id ? <FotosDoProduto produto={p} urls={urlsDasFotos} /> : null}
        {podeEditar && editando === p.id ? (
          // `key` porque o painel fica na MESMA posição do DOM ao trocar de
          // produto: sem ela o React reaproveita o estado e o formulário
          // abriria preenchido com o produto anterior.
          <EdicaoDoProduto
            key={p.id}
            produto={p}
            capacidadeLigada={capacidadeLigada}
            urlsDasFotos={urlsDasFotos}
            apresentacaoLigada={apresentacaoLigada}
            aoFechar={() => setEditando(null)}
          />
        ) : null}
      </>
    );
  }

  function itemDaLista(p: Produto) {
    const capa = p.fotos?.[0] ? urlsDasFotos[p.fotos[0]] : undefined;
    return (
      <li key={p.id} data-testid={`produto-${p.codigo}`}>
        {/*
          A linha não cabia em 375 px: preço (shrink-0) + os três botões de
          ação somam mais que a largura útil, e a coluna do nome — `flex-1`
          com `min-w-0` — encolhia até 0 px, levando o nome junto. Abaixo de
          `md` a linha passa a quebrar: nome e preço em cima, ações embaixo,
          ancoradas à direita e com `flex-wrap` próprio se ainda faltar
          espaço. Tudo em `max-md:` — de `md` para cima a lista é a de sempre.
        */}
        <div className="flex items-center gap-4 p-3 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1">
          {capa ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={capa} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className={`truncate font-medium ${p.ativo ? "" : "text-text-muted line-through"}`}>{p.nome}</p>
            <p className="text-xs text-text-muted">
              {p.codigo}
              {p.categoria ? ` · ${p.categoria}` : ""}
              {p.marca ? ` · ${p.marca}` : ""}
              {capacidadeLigada && p.capacidade ? ` · ${p.capacidade}` : ""}
              {p.controla_estoque
                ? ` · ${p.quantidade} ${t("em estoque")}`
                : ` · ${t("sem controle de estoque")}`}
              {/* Sem descrição, o atendente de IA só sabe nome e preço: a lista diz onde falta. */}
              {p.descricao?.trim() ? "" : ` · ${t("sem descrição")}`}
            </p>
          </div>
          <Preco produto={p} />
          {podeEditar ? (
            // Grupo próprio para as ações: sozinhas elas não cabem ao lado do
            // preço em 375 px, e como itens soltos da linha quebravam em
            // qualquer lugar. Aqui elas descem juntas (w-full abaixo de `md`)
            // e, se nem assim couberem, quebram entre si em vez de vazar.
            <div className="flex items-center gap-4 max-md:w-full max-md:flex-wrap max-md:justify-end max-md:gap-x-2 max-md:gap-y-1">
              {acoesDe(p)}
            </div>
          ) : null}
        </div>
        {paineisDe(p)}
      </li>
    );
  }

  function itemDaGrade(p: Produto) {
    const capa = p.fotos?.[0] ? urlsDasFotos[p.fotos[0]] : undefined;
    const aberto = editando === p.id || fotosAbertas === p.id;
    return (
      <li
        key={p.id}
        data-testid={`produto-${p.codigo}`}
        // Painel aberto ocupa a linha inteira da grade: o formulário não cabe
        // na largura de um cartão.
        className={cn("flex flex-col rounded-lg border border-border bg-surface", aberto && "col-span-full")}
      >
        <div className={cn("flex flex-col", aberto && "sm:flex-row")}>
          <div
            className={cn(
              "aspect-[4/3] overflow-hidden rounded-t-lg bg-surface-elevated",
              aberto && "sm:w-40 sm:shrink-0 sm:rounded-tr-none",
            )}
          >
            {capa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={capa} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-text-subtle">
                <ImageSquare size={32} aria-hidden />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
            <p className={cn("line-clamp-2 text-sm font-medium", !p.ativo && "text-text-muted line-through")}>
              {p.nome}
            </p>
            <p className="truncate text-xs text-text-muted">
              {p.codigo}
              {p.categoria ? ` · ${p.categoria}` : ""}
            </p>
            <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
              <Preco produto={p} />
              <SeloDeEstoque produto={p} />
            </div>
          </div>
        </div>
        {podeEditar ? (
          <div className="flex flex-wrap items-center justify-end gap-x-1 border-t border-border px-1.5 py-1">
            {acoesDe(p)}
          </div>
        ) : null}
        {paineisDe(p)}
      </li>
    );
  }

  function listaDe(produtos: Produto[], testId: string) {
    return vista === "grade" ? (
      <ul
        className={cn(
          "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
          carregando && "opacity-60",
        )}
        aria-busy={carregando}
        data-testid={testId}
        data-vista="grade"
      >
        {produtos.map(itemDaGrade)}
      </ul>
    ) : (
      <ul
        className={cn("divide-y divide-border rounded-lg border border-border", carregando && "opacity-60")}
        aria-busy={carregando}
        data-testid={testId}
        data-vista="lista"
      >
        {produtos.map(itemDaLista)}
      </ul>
    );
  }

  const botaoDeVista = (valor: Vista, rotulo: string, Icone: typeof List) => (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={vista === valor}
      onClick={() => escolherVista(valor)}
      className={cn("gap-1.5", vista === valor ? "bg-pressed" : "text-text-muted")}
      data-testid={`vista-${valor}`}
    >
      <Icone aria-hidden />
      {rotulo}
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl p-2" data-testid="tela-produtos">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{textos.titulo}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{textos.subtitulo}</p>
        </div>
        {podeEditar ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={arquivoRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="arquivo-planilha"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
              }}
            />
            <Button
              variant="secondary"
              disabled={importando}
              onClick={() => arquivoRef.current?.click()}
              data-testid="importar-planilha"
            >
              {t(importando ? "Importando…" : "Importar planilha")}
            </Button>
            <Button onClick={() => setCriando((v) => !v)} data-testid="novo-produto">
              {t(criando ? "Cancelar" : "Novo produto")}
            </Button>
          </div>
        ) : null}
      </header>

      {fonteDoFeed}

      {podeEditar ? (
        // Rota de API que devolve o arquivo com `content-disposition:
        // attachment` — é download, não navegação de página, e `<Link>` do Next
        // faria navegação de cliente para algo que não é tela.
        <div className="mb-4">
          <a
            href="/api/v1/products/import"
            download="modelo-catalogo.csv"
            className="inline-block text-xs text-text-muted underline"
            data-testid="modelo-planilha"
          >
            {t("Baixar planilha modelo")}
          </a>
          <p className="mt-1 break-words text-xs text-text-muted" data-testid="formato-da-foto">
            {t(
              "Na coluna foto, cole o link da imagem (JPG ou PNG, até 5 MB). Para até 5 fotos, separe os links com | — a primeira é a capa.",
            )}
          </p>
        </div>
      ) : null}

      {resumo ? (
        <div className="mb-6 rounded-lg border border-border p-4 text-sm" data-testid="resumo-importacao">
          <p className="font-medium">
            {resumo.criados} {t("novos")} · {resumo.atualizados} {t("atualizados")} ·{" "}
            {resumo.total_linhas} {t("linhas na planilha")}
          </p>
          {resumo.descricoes ? (
            <p className="mt-1 text-text-muted" data-testid="resumo-descricoes">
              {t("Descrição escrita pela planilha em {quantidade} produto(s).").replace(
                "{quantidade}",
                String(resumo.descricoes),
              )}
            </p>
          ) : null}
          {resumo.colunas_ignoradas.length > 0 ? (
            <p className="mt-2 text-text-muted">
              {t("Não usei estas colunas:")} {resumo.colunas_ignoradas.join(", ")}.
            </p>
          ) : null}
          {resumo.erros.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium">{t("Linhas que não entraram:")}</p>
              <ul className="mt-1 space-y-0.5 wrap-anywhere text-text-muted">
                {resumo.erros.slice(0, 20).map((e) => (
                  <li key={`${e.linha}-${e.motivo}`}>
                    {t("Linha")} {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
              {resumo.erros.length > 20 ? (
                <p className="mt-1 text-text-muted">
                  {t("…e mais")} {resumo.erros.length - 20}.
                </p>
              ) : null}
            </div>
          ) : null}
          <button className="mt-3 min-h-11 text-xs underline lg:min-h-0" onClick={() => setResumo(null)}>
            {t("Fechar")}
          </button>
        </div>
      ) : null}

      {criando && podeEditar ? (
        <div className="mb-6 rounded-lg border border-border p-4" data-testid="form-produto">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("Código")}
              <input
                value={rascunho.codigo}
                onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })}
                className={CAMPO}
                data-testid="produto-codigo"
              />
            </label>
            <label className="text-sm">
              {t("Nome")}
              <input
                value={rascunho.nome}
                onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })}
                className={CAMPO}
                data-testid="produto-nome"
              />
            </label>
            <label className="text-sm">
              {t("Marca")}
              <input
                value={rascunho.marca}
                onChange={(e) => setRascunho({ ...rascunho, marca: e.target.value })}
                className={CAMPO}
              />
            </label>
            <label className="text-sm">
              {t("Categoria")}
              <input
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}
                list="categorias-do-catalogo"
                className={CAMPO}
              />
            </label>
            {capacidadeLigada ? (
              <label className="text-sm">
                {t("Capacidade")} <span className="text-text-muted">{t("(opcional)")}</span>
                <input
                  value={rascunho.capacidade}
                  onChange={(e) => setRascunho({ ...rascunho, capacidade: e.target.value })}
                  placeholder={t("Ex.: 128GB")}
                  maxLength={60}
                  className={CAMPO}
                  data-testid="produto-capacidade"
                />
              </label>
            ) : null}
            <label className="text-sm">
              {t("Preço de venda")}
              <input
                value={rascunho.preco}
                onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })}
                placeholder="5.499,00"
                inputMode="decimal"
                className={CAMPO}
                data-testid="produto-preco"
              />
            </label>
            <label className="text-sm">
              {t("Preço promocional")} <span className="text-text-muted">{t("(opcional)")}</span>
              <input
                value={rascunho.promocional}
                onChange={(e) => setRascunho({ ...rascunho, promocional: e.target.value })}
                placeholder="4.999,00"
                inputMode="decimal"
                className={CAMPO}
                data-testid="produto-promocional"
              />
              <span className="mt-1 block text-xs text-text-muted">
                {t("Vazio, sem promoção. Com valor, é o preço que o atendente responde e que o orçamento usa.")}
              </span>
            </label>
            <label className="text-sm">
              {t("Custo")} <span className="text-text-muted">{t("(opcional)")}</span>
              <input
                value={rascunho.custo}
                onChange={(e) => setRascunho({ ...rascunho, custo: e.target.value })}
                placeholder="4.100,00"
                inputMode="decimal"
                className={CAMPO}
              />
              <span className="mt-1 block text-xs text-text-muted">
                {t("Serve para o atendente saber até onde pode negociar. Não aparece para o cliente.")}
              </span>
            </label>
          </div>
          {categorias.length > 0 ? (
            <datalist id="categorias-do-catalogo">
              {categorias.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          ) : null}

          <label className="mt-3 block text-sm">
            {t("Descrição")} <span className="text-text-muted">{t("(opcional)")}</span>
            <textarea
              value={rascunho.descricao}
              onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              data-testid="produto-descricao"
            />
            <span className="mt-1 block text-xs text-text-muted">
              {t("É o que o atendente de IA conta ao cliente: para que serve, medidas, materiais, diferenciais. Ele repete o que estiver aqui — e não inventa o que faltar.")}
            </span>
          </label>

          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
            <input
              type="checkbox"
              checked={rascunho.controla_estoque}
              onChange={(e) => setRascunho({ ...rascunho, controla_estoque: e.target.checked })}
              data-testid="produto-controla-estoque"
            />
            {t("Controlar estoque deste produto")}
          </label>
          {rascunho.controla_estoque ? (
            <label className="mt-2 block text-sm">
              {t("Quantidade")}
              <input
                value={rascunho.quantidade}
                onChange={(e) => setRascunho({ ...rascunho, quantidade: e.target.value })}
                inputMode="numeric"
                className="mt-1 h-9 min-h-11 w-32 rounded-md border border-border bg-surface px-3 lg:min-h-0"
              />
            </label>
          ) : (
            <p className="mt-2 text-xs text-text-muted">
              {t(
                "Sem controle de estoque, este produto sempre aparece como disponível para o atendente — é o certo para item sob encomenda ou fracionado.",
              )}
            </p>
          )}

          <div className="mt-4">
            <Button onClick={salvar} disabled={salvando} data-testid="salvar-produto">
              {t(salvando ? "Salvando…" : "Salvar produto")}
            </Button>
          </div>
        </div>
      ) : null}

      {/*
        A barra de filtro não tem moldura (redesign v2): campo e seletores
        direto na página. Busca, categoria e estoque vão à URL e ao servidor,
        que filtra o catálogo INTEIRO; a vista é só de quem olha.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t("Buscar por nome, código ou marca")}
          aria-label={t("Buscar por nome, código ou marca")}
          className="w-full sm:max-w-xs"
          data-testid="busca-produto"
        />
        {categorias.length > 0 || filtros.categoria ? (
          <select
            value={filtros.categoria ?? ""}
            onChange={(e) => irPara(busca, 1, { ...filtros, categoria: e.target.value || null })}
            aria-label={t("Categoria")}
            className="h-8 min-h-11 max-w-56 rounded-md border border-border bg-surface px-2.5 text-sm text-text hover:border-border-strong lg:min-h-0"
            data-testid="filtro-categoria"
          >
            <option value="">{t("Todas as categorias")}</option>
            {/* A categoria da URL pode não estar mais na lista (apagaram o último produto dela). */}
            {filtros.categoria && !categorias.includes(filtros.categoria) ? (
              <option value={filtros.categoria}>{filtros.categoria}</option>
            ) : null}
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          aria-pressed={filtros.soComEstoque}
          onClick={() => irPara(busca, 1, { ...filtros, soComEstoque: !filtros.soComEstoque })}
          className={cn(filtros.soComEstoque && "border-border-strong bg-pressed")}
          data-testid="filtro-estoque"
        >
          {t("Só com estoque")}
        </Button>
        <div
          role="group"
          aria-label={t("Exibição")}
          className="ml-auto inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
        >
          {botaoDeVista("lista", t("Lista"), List)}
          {botaoDeVista("grade", t("Grade"), ImageSquare)}
        </div>
      </div>

      {inicial.length === 0 && (buscaInicial !== "" || algumFiltro) ? (
        <>
          <div className="rounded-lg border border-dashed border-border p-8 text-center" data-testid="produtos-busca-vazia">
            <p className="font-medium">{t("Nenhum produto encontrado para essa busca")}</p>
          </div>
          {parecidos.length > 0 ? (
            <section className="mt-6" data-testid="produtos-parecidos">
              <h2 className="text-sm font-semibold">{t("Os mais parecidos")}</h2>
              <p className="mb-3 mt-0.5 text-xs text-text-muted">
                {t("É o que o atendente de IA encontraria com essas palavras.")}
              </p>
              {listaDe(parecidos, "lista-parecidos")}
            </section>
          ) : null}
        </>
      ) : inicial.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center" data-testid="produtos-vazio">
          <p className="font-medium">{textos.vazio}</p>
          <p className="mt-1 text-sm text-text-muted">{textos.vazioDica}</p>
        </div>
      ) : (
        listaDe(inicial, "lista-produtos")
      )}

      {total > 0 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-text-muted" data-testid="paginacao-produtos">
          <span className="tabular-nums" data-testid="contagem-produtos">
            {primeiro}–{ultimo} {t("de")} {total}
          </span>
          {total > porPagina ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagina <= 1 || carregando}
                onClick={() => irPara(busca, pagina - 1)}
                data-testid="pagina-anterior"
              >
                {t("Página anterior")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={ultimo >= total || carregando}
                onClick={() => irPara(busca, pagina + 1)}
                data-testid="proxima-pagina"
              >
                {t("Próxima página")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
