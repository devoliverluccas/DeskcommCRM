"use client";

import { format } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import {
  useMidiasDaConversa,
  type FiltroDeMidia,
  type MidiaDaConversa,
} from "@/hooks/inbox/useMidiasDaConversa";
import { cn } from "@/lib/utils";

import { AudioPlayer } from "./media/AudioPlayer";
import { DocumentCard } from "./media/DocumentCard";
import { ImageMedia } from "./media/ImageMedia";
import { VideoMedia } from "./media/VideoMedia";

/**
 * A ABA MÍDIAS DO PAINEL — o que foi trocado nesta conversa, sem rolar o fio.
 *
 * "Me manda de novo aquele comprovante" é a pergunta que isto responde: a foto
 * do documento, o PDF do orçamento, o áudio com o endereço. No fio, achar isso
 * é rolar semanas para trás; aqui é um filtro.
 *
 * Nada de render novo: cada item é o MESMO componente que o balão usa
 * (`components/inbox/media/*`), então abrir, ampliar, tocar e baixar se
 * comportam exatamente como no fio — inclusive o `?baixar=1` com o nome
 * original e a conversão do áudio para o aparelho que não toca opus. O arquivo
 * sai por `GET /api/v1/messages/{id}/media`, que confere o acesso de novo; a
 * lista vem de `GET /api/v1/conversations/{id}/media`.
 */

const FILTROS: Array<{ id: FiltroDeMidia; rotulo: string }> = [
  { id: "imagem", rotulo: "Fotos" },
  { id: "video", rotulo: "Vídeos" },
  { id: "documento", rotulo: "Documentos" },
  { id: "audio", rotulo: "Áudios" },
];

interface Props {
  conversationId: string | null;
  /** A aba está aberta: só então a galeria pergunta ao servidor. */
  ativo?: boolean;
}

export function MidiasDaConversa({ conversationId, ativo = true }: Props) {
  const t = useT();
  const [filtro, setFiltro] = useState<FiltroDeMidia>("imagem");
  const consulta = useMidiasDaConversa(conversationId, filtro, ativo);
  const itens = consulta.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <section data-testid="inbox-midias" className="space-y-3">
      {/* Os sub-filtros: um grupo de alternância, não abas dentro de abas —
          `aria-pressed` diz qual está valendo, e o selecionado usa o neutro
          de "item atual" (`bg-pressed`), não a cor da marca. */}
      <div role="group" aria-label={t("Mídia")} className="flex flex-wrap gap-1">
        {FILTROS.map((f) => {
          const atual = f.id === filtro;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={atual}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "inline-flex h-11 items-center rounded-md px-2.5 text-xs transition-colors duration-fast lg:h-7",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                atual
                  ? "bg-pressed font-medium text-text"
                  : "text-text-muted hover:bg-hover hover:text-text",
              )}
            >
              {t(f.rotulo)}
            </button>
          );
        })}
      </div>

      {consulta.isPending ? (
        <EsqueletoDaGaleria filtro={filtro} />
      ) : consulta.isError ? (
        <div className="space-y-2" role="alert">
          <p className="text-xs text-error-fg">{t("Não foi possível carregar as mídias.")}</p>
          <Button
            size="sm"
            variant="outline"
            className="h-11 lg:h-7"
            onClick={() => void consulta.refetch()}
          >
            {t("Tentar de novo")}
          </Button>
        </div>
      ) : itens.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-muted" data-testid="inbox-midias-vazio">
          {t("Nenhuma mídia deste tipo nesta conversa.")}
        </p>
      ) : (
        <ListaDeMidias filtro={filtro} itens={itens} />
      )}

      {consulta.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="h-11 w-full text-xs lg:h-7"
          disabled={consulta.isFetchingNextPage}
          onClick={() => void consulta.fetchNextPage()}
        >
          {consulta.isFetchingNextPage ? t("Carregando…") : t("Carregar mais")}
        </Button>
      )}
    </section>
  );
}

function ListaDeMidias({ filtro, itens }: { filtro: FiltroDeMidia; itens: MidiaDaConversa[] }) {
  const t = useT();
  const locale = useLocaleDeData();
  const quando = (iso: string) => format(new Date(iso), "dd/MM/yy HH:mm", { locale });

  // Foto e vídeo em GRADE: o que se reconhece de relance é a imagem. O vídeo
  // pede duas colunas porque os controles nativos não cabem num terço do painel.
  if (filtro === "imagem" || filtro === "video") {
    return (
      <ul
        className={cn("grid gap-1.5", filtro === "imagem" ? "grid-cols-3" : "grid-cols-2")}
        data-testid="inbox-midias-grade"
      >
        {itens.map((m) => (
          <li
            key={m.id}
            data-testid="inbox-midia-item"
            data-midia-id={m.id}
            title={quando(m.sent_at)}
            className="min-w-0 [&_.w-64]:w-full"
          >
            {filtro === "imagem" ? (
              <ImageMedia messageId={m.id} alt={t("Imagem recebida")} />
            ) : (
              <VideoMedia messageId={m.id} />
            )}
          </li>
        ))}
      </ul>
    );
  }

  // Documento e áudio em LISTA: o que identifica é o nome, a duração, a data.
  return (
    <ul className="space-y-2" data-testid="inbox-midias-lista">
      {itens.map((m) => (
        <li key={m.id} data-testid="inbox-midia-item" data-midia-id={m.id} className="min-w-0 space-y-0.5">
          {filtro === "documento" ? (
            <DocumentCard
              messageId={m.id}
              mime={m.media_mime}
              sizeBytes={m.media_size_bytes}
              storagePath={m.media_storage_path}
              isOutbound={false}
              fileName={m.nome}
            />
          ) : (
            <AudioPlayer messageId={m.id} isOutbound={false} mime={m.media_mime} />
          )}
          <p className="text-[11px] tabular-nums text-text-subtle">{quando(m.sent_at)}</p>
        </li>
      ))}
    </ul>
  );
}

function EsqueletoDaGaleria({ filtro }: { filtro: FiltroDeMidia }) {
  if (filtro === "imagem" || filtro === "video") {
    return (
      <div className={cn("grid gap-1.5", filtro === "imagem" ? "grid-cols-3" : "grid-cols-2")} aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/3] w-full rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}
