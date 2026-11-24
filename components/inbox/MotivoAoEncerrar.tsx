"use client";

/**
 * O MOTIVO NO DIÁLOGO DE FECHAR (fase 3, item 3.2) e o PROTOCOLO do atendimento
 * (item 3.1), prontos para o cabeçalho da conversa montar.
 *
 * Como montar no `AlertDialog` de "Fechar esta conversa?":
 *
 *   const motivo = useMotivoAoEncerrar(confirmFecharOpen);
 *   …
 *   <SeletorDeMotivoAoEncerrar estado={motivo} />         // dentro do conteúdo
 *   <AlertDialogAction disabled={motivo.bloqueiaFechar}
 *     onClick={() => close.mutate({ …escolha, ...motivo.corpo })}>
 *
 * Sem motivo cadastrado o seletor não aparece e `corpo` é `{}`: fechar continua
 * sendo só fechar, como antes deste item. A exigência só bloqueia quando a
 * organização a ligou E tem ao menos um motivo ativo — a mesma regra do
 * servidor (`decidirMotivo`), que é quem decide de verdade.
 */
import { useId, useState } from "react";

import { useMotivosDeEncerramento } from "@/hooks/inbox/useMotivosDeEncerramento";
import { useT } from "@/hooks/i18n/useT";
import type { MotivoDeEncerramento } from "@/lib/atendimento/motivos-de-encerramento";
import { cn } from "@/lib/utils";

export interface EstadoDoMotivoAoEncerrar {
  motivoId: string;
  escolher: (id: string) => void;
  ativos: MotivoDeEncerramento[];
  exigido: boolean;
  carregando: boolean;
  /** `true` quando a organização exige e nada foi escolhido. */
  bloqueiaFechar: boolean;
  /** O que entra no corpo do `POST …/close`. */
  corpo: { motivo_id?: string };
}

export function useMotivoAoEncerrar(aberto: boolean): EstadoDoMotivoAoEncerrar {
  const consulta = useMotivosDeEncerramento(aberto);
  // A escolha recomeça a cada abertura do diálogo: o motivo da conversa
  // anterior não pode ir junto na próxima. Ajuste durante a renderização (e não
  // em efeito), o padrão do React para estado que acompanha uma prop.
  const [estado, setEstado] = useState({ aberto, motivoId: "" });
  if (estado.aberto !== aberto) setEstado({ aberto, motivoId: "" });

  const ativos = (consulta.data?.motivos ?? []).filter((m) => m.ativo);
  const exigido = (consulta.data?.motivo_obrigatorio_ao_encerrar ?? false) && ativos.length > 0;
  const motivoId = ativos.some((m) => m.id === estado.motivoId) ? estado.motivoId : "";

  return {
    motivoId,
    escolher: (id) => setEstado((atual) => ({ ...atual, motivoId: id })),
    ativos,
    exigido,
    carregando: consulta.isLoading,
    bloqueiaFechar: exigido && !motivoId,
    corpo: motivoId ? { motivo_id: motivoId } : {},
  };
}

export function SeletorDeMotivoAoEncerrar({ estado }: { estado: EstadoDoMotivoAoEncerrar }) {
  const t = useT();
  const id = useId();
  if (estado.ativos.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="motivo-ao-encerrar">
      <label htmlFor={id} className="block text-sm font-medium text-text">
        {t("Motivo do encerramento")}
        {estado.exigido ? null : (
          <span className="ml-1 font-normal text-text-muted">({t("opcional")})</span>
        )}
      </label>
      <select
        id={id}
        value={estado.motivoId}
        onChange={(e) => estado.escolher(e.target.value)}
        aria-required={estado.exigido}
        className={cn(
          "min-h-11 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-text lg:min-h-8",
          "hover:border-border-strong focus:border-accent-500 focus:outline-hidden focus:ring-[3px] focus:ring-accent-500/15",
        )}
      >
        <option value="">{estado.exigido ? t("Escolha um motivo") : t("Sem motivo")}</option>
        {estado.ativos.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </select>
      {estado.exigido ? (
        <p className="text-xs text-text-muted">{t("Sua empresa pede um motivo para encerrar.")}</p>
      ) : null}
    </div>
  );
}

/**
 * O protocolo do atendimento vigente, para o cabeçalho (o GET da conversa traz
 * `protocolo_do_atendimento`). Sem protocolo, não desenha nada.
 */
export function ProtocoloDoAtendimento({
  protocolo,
  className,
}: {
  protocolo: string | null | undefined;
  className?: string;
}) {
  const t = useT();
  if (!protocolo) return null;
  return (
    <span
      data-testid="protocolo-do-atendimento"
      className={cn("text-xs text-text-muted", className)}
    >
      {t("Protocolo")} <span className="font-mono tabular-nums text-text">{protocolo}</span>
    </span>
  );
}
