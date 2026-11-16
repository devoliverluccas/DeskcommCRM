"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { useAutomaticoAtivo } from "@/hooks/ai/useAutomaticoAtivo";
import { useT } from "@/hooks/i18n/useT";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { channelLabel, useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { apiClient } from "@/lib/api/client";
import { rotuloDoContato, type ContatoNomeavel } from "@/lib/contacts/rotulo-do-contato";
import { automaticoNoComando, consultasDoPainel, haQuantoTempo, montarColunas, type ConversaDoPainel } from "@/lib/inbox/painel-de-atendimento";
import { Robot, Tray } from "@/lib/ui/icons";

interface Conversa extends ConversaDoPainel {
  last_message_preview: string | null;
  contacts?: (ContatoNomeavel & NonNullable<ConversaDoPainel["contacts"]>) | null;
}

interface RespostaDaLista {
  data: Conversa[];
  meta?: { has_more?: boolean };
}

function Coluna<C extends Conversa>({
  titulo,
  itens,
  destaque,
  vazio,
  tempo,
  rotulo,
  automaticoDaOrg,
  rotuloIA,
}: {
  titulo: string;
  itens: C[];
  destaque?: boolean;
  vazio: string;
  tempo: (c: C) => string;
  rotulo: (c: Conversa) => string;
  automaticoDaOrg: boolean | undefined;
  rotuloIA: string;
}) {
  // Coluna sem caixa: o cabeçalho forte (nome + contagem) e a divisória fazem a
  // separação; cada item é um alvo inteiro, com o retorno neutro do cursor.
  const urgente = destaque && itens.length > 0;
  return (
    <section className="flex max-h-[28rem] min-h-0 flex-col md:max-h-none">
      <header className="flex items-baseline gap-2 border-b border-border-strong px-1 pb-2.5">
        <h2 className="text-sm font-semibold">{titulo}</h2>
        <span
          className={`rounded-sm px-1.5 text-sm font-semibold tabular-nums ${
            urgente ? "bg-error-bg text-error-fg" : "text-text-muted"
          }`}
        >
          {itens.length}
        </span>
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto py-2">
        {itens.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-text-muted">
            <Tray className="size-5 text-text-subtle" aria-hidden />
            {vazio}
          </li>
        )}
        {itens.map((c) => (
          <li key={c.id}>
            <Link
              href={`/app/inbox?id=${c.id}`}
              className="flex min-h-11 flex-col justify-center rounded-md px-2.5 py-2 transition-colors duration-fast hover:bg-hover"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{rotulo(c)}</span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${destaque ? "font-medium text-error-fg" : "text-text-subtle"}`}
                >
                  {tempo(c)}
                </span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">
                {automaticoNoComando(c, automaticoDaOrg) && <Robot className="mr-1 inline h-3 w-3" aria-label={rotuloIA} />}
                {c.last_message_preview ?? ""}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PainelDeAtendimento() {
  const t = useT();
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId ?? null;
  const { data: numeros } = useChannelSessions();
  const [numero, setNumero] = useState<string>("");

  const { data: automaticoDaOrg } = useAutomaticoAtivo();
  const fuso = activeOrg?.timezone;
  const consultas = consultasDoPainel({ numero, automaticoDaOrg, fuso });

  const abertas = useQuery({
    queryKey: ["painel-de-atendimento", consultas.abertas],
    queryFn: () => apiClient.get<RespostaDaLista>(consultas.abertas),
    refetchInterval: 15_000,
    enabled: !!orgId,
  });
  const fila = useQuery({
    queryKey: ["painel-de-atendimento", consultas.fila],
    queryFn: () => apiClient.get<RespostaDaLista>(consultas.fila),
    refetchInterval: 15_000,
    enabled: !!orgId,
  });
  const encerradas = useQuery({
    queryKey: ["painel-de-atendimento", consultas.encerradas],
    queryFn: () => apiClient.get<RespostaDaLista>(consultas.encerradas),
    refetchInterval: 60_000,
    enabled: !!orgId,
  });
  const casos = useQuery({
    queryKey: ["painel-de-atendimento", "casos"],
    queryFn: () => apiClient.get<{ data: { open_count?: number } }>("/api/v1/ai/cases?status=open"),
    refetchInterval: 30_000,
    enabled: !!orgId,
  });

  const colunas = useMemo(
    () => montarColunas([...(abertas.data?.data ?? []), ...(fila.data?.data ?? []), ...(encerradas.data?.data ?? [])], fuso),
    [abertas.data, fila.data, encerradas.data, fuso],
  );
  const casosAbertos = casos.data?.data?.open_count ?? 0;
  const rotulo = (c: Conversa) => rotuloDoContato(c.contacts, t);
  const rotuloIA = t("Automático atendendo");
  const haTempo = (iso: string) => t("há {tempo}").replace("{tempo}", haQuantoTempo(iso));
  // Cada consulta devolve no máximo 100: se há mais, a coluna não é a lista inteira.
  const truncado = [abertas, fila, encerradas].some((lista) => lista.data?.meta?.has_more === true);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 md:h-[calc(100dvh-var(--faixas-de-cima,0px)-3.5rem-var(--casca-recuo,0px)-var(--space-6)-max(var(--space-6),var(--rodape-ocupado,0px)))] md:overflow-visible md:p-2">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">{t("Painel de atendimento")}</h1>
        <select
          aria-label={t("Número")}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          className="h-11 min-w-0 max-w-full rounded-md border border-border bg-surface px-2.5 text-sm transition-colors duration-fast hover:border-border-strong lg:h-8"
        >
          <option value="">{t("Todos os números")}</option>
          {(numeros ?? []).map((n) => (
            <option key={n.id} value={n.id}>
              {channelLabel(n, t)}
            </option>
          ))}
        </select>
        {/* Só aparece se a consulta deu certo: quem não pode ver casos receberia um "0" que mente. */}
        {casos.isSuccess && (
          <Link
            href="/app/ai/cases"
            className={`inline-flex h-11 items-center rounded-md border px-2.5 text-sm transition-colors duration-fast hover:bg-hover lg:h-8 ${
              casosAbertos > 0 ? "border-error font-semibold text-error-fg" : "border-border text-text-muted"
            }`}
          >
            {t("Casos da IA")}: {casosAbertos}
          </Link>
        )}
      </header>
      {(abertas.isError || fila.isError || encerradas.isError) && (
        <p className="text-sm text-error-fg">{t("Não deu para carregar as conversas agora.")}</p>
      )}
      {truncado && (
        <p className="text-xs text-text-muted">
          {t("Há mais de 100 conversas em alguma lista. Quem espera sem dono são as 100 com mais tempo de espera; as demais são as 100 com a mensagem mais recente.")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-8 md:min-h-0 md:flex-1 md:grid-cols-3 md:grid-rows-[minmax(0,1fr)] md:gap-6">
        <Coluna
          titulo={t("Aguardando atendimento")}
          itens={colunas.aguardando}
          destaque
          vazio={t("Ninguém esperando.")}
          rotulo={rotulo}
          automaticoDaOrg={automaticoDaOrg}
          rotuloIA={rotuloIA}
          tempo={(c) => t("esperando há {tempo}").replace("{tempo}", haQuantoTempo(c.esperandoDesde))}
        />
        <Coluna
          titulo={t("Em atendimento")}
          itens={colunas.emAtendimento}
          vazio={t("Nenhuma conversa em andamento.")}
          rotulo={rotulo}
          automaticoDaOrg={automaticoDaOrg}
          rotuloIA={rotuloIA}
          tempo={(c) => (c.last_message_at ? haTempo(c.last_message_at) : "")}
        />
        <Coluna
          titulo={t("Atendidos hoje")}
          itens={colunas.atendidosHoje}
          vazio={t("Nada encerrado hoje ainda.")}
          rotulo={rotulo}
          automaticoDaOrg={automaticoDaOrg}
          rotuloIA={rotuloIA}
          tempo={(c) => {
            const quando = c.service_closed_at ?? c.status_changed_at;
            return quando ? haTempo(quando) : "";
          }}
        />
      </div>
    </div>
  );
}
