"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";
import { useActiveOrg, useUser } from "@/hooks/auth/AuthProvider";
import { useConversation, isNotFound } from "@/hooks/inbox/useConversation";
import { useClaimConversation } from "@/hooks/inbox/useClaimConversation";
import { useReopenConversation } from "@/hooks/inbox/useCloseConversation";
import { useParticipantesDaConversa } from "@/hooks/inbox/useParticipantesDaConversa";
import { ChatThread } from "@/components/inbox/ChatThread";
import { Composer } from "@/components/inbox/Composer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { estadoDoCompositor } from "@/lib/inbox/estado-do-compositor";
import type { Lead } from "@/lib/types/leads";
import type { Message } from "@/lib/types/messaging";
import { ArrowSquareOut } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { ConversaNoDossie } from "./ConversaNoDossie";

/**
 * A CONVERSA, AO VIVO, DENTRO DO DOSSIÊ DO NEGÓCIO.
 *
 * O bloco de antes (`ConversaNoDossie`) era uma porta: prévia da última
 * mensagem e um link para o inbox. Funcionava, mas responder um cliente a partir
 * do funil custava sair do negócio, achar a conversa, voltar e reabrir o card —
 * e quem atende pelo funil faz isso dezenas de vezes por dia.
 *
 * ─── Não é uma segunda cópia do inbox ───────────────────────────────────────
 *
 * O fio e a caixa de resposta são os MESMOS componentes do inbox (`ChatThread`
 * e `Composer`), e o que trava a caixa sai da MESMA função que o inbox usa
 * (`estadoDoCompositor`). A recusa antiga de compositor no card
 * (`ConversaSlot`) era contra uma CÓPIA — anexos, modelos, notas e áudio
 * divergindo entre duas implementações. Aqui não há cópia: o card do quadro
 * continua só com o atalho, e o dossiê monta as peças do inbox.
 *
 * ─── O que fica no inbox ────────────────────────────────────────────────────
 *
 * Transferir, encerrar, convidar, o modelo da janela de 24h fechada e a ficha
 * do contato. O "Abrir no Inbox" está sempre à vista para isso. Daqui saem as
 * três coisas que o atendimento pelo funil pede: ler, responder e — quando a
 * caixa está travada — o gesto que a destrava (Assumir ou Reabrir).
 *
 * Sem `useMarkAsRead`: espiar a conversa pelo funil não zera o contador de quem
 * é o dono. Quem atende de verdade abre o inbox.
 */
export function ConversaNoDossieAoVivo({
  conversa,
  ativo = true,
  className,
}: {
  /** O resumo que o quadro já trouxe — dá o id e a prévia de reserva. */
  conversa: NonNullable<Lead["conversa"]>;
  /** A gaveta aberta (ou a página). Fechada, nada é buscado. */
  ativo?: boolean;
  /** A altura vem de quem monta: a gaveta e a página têm molduras diferentes. */
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const user = useUser();
  const activeOrg = useActiveOrg();
  const consulta = useConversation(conversa.id, ativo);
  const completa = consulta.data ?? null;
  const participantes = useParticipantesDaConversa(conversa.id, ativo);
  const participaDoAtendimento = participantes.data?.some((p) => p.user_id === user.id) === true;
  const claim = useClaimConversation();
  const reopen = useReopenConversation();
  const [respondendo, setRespondendo] = useState<Message | null>(null);

  // O mesmo relógio do inbox: a janela vence sozinha com o dossiê aberto.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), 30_000);
    return () => clearInterval(relogio);
  }, []);

  const href = `/app/inbox?id=${conversa.id}`;

  if (!completa) {
    if (consulta.isError && !isNotFound(consulta.error)) {
      // Falha que não é "fora do acesso": a porta de antes continua servindo.
      return <ConversaNoDossie conversa={conversa} />;
    }
    return (
      <section
        aria-label={t("Conversa")}
        data-testid="dossie-conversa"
        className={cn("flex min-h-0 flex-col gap-2", className)}
      >
        <h3 className="text-sm font-semibold text-text">{t("Conversa")}</h3>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-4 text-center">
          {isNotFound(consulta.error) ? (
            <p className="text-sm text-text-muted">
              {t("Conversa não encontrada ou fora do seu acesso.")}
            </p>
          ) : (
            <>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <span className="sr-only">{t("Carregando…")}</span>
            </>
          )}
        </div>
      </section>
    );
  }

  const estado = estadoDoCompositor({
    conversa: completa,
    usuario: user,
    bloquearAteAssumir: activeOrg?.interface_settings?.bloquearAteAssumir,
    participanteAtivo: participaDoAtendimento,
    agora,
    t,
  });
  const encerrada =
    completa.status === "closed" || completa.status === "archived" || completa.status === "resolved";
  const rotuloDoStatus =
    completa.status === "closed"
      ? t("Fechada")
      : completa.status === "archived"
        ? t("Arquivada")
        : completa.status === "resolved"
          ? t("Resolvida")
          : null;
  // O gesto que destrava, quando há um. Suporte somente leitura não escreve.
  const oferecerAssumir = estado.aguardandoAssumir && !estado.somenteLeitura;
  const oferecerReabrir = encerrada && !estado.somenteLeitura;

  return (
    <section
      aria-label={t("Conversa")}
      data-testid="dossie-conversa"
      data-conversa-id={completa.id}
      className={cn("flex min-h-0 flex-col gap-2", className)}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-text">{t("Conversa")}</h3>
        {rotuloDoStatus && (
          <span
            data-testid="dossie-conversa-status"
            className="rounded-sm bg-hover px-1.5 py-0.5 text-[11px] font-medium text-text-muted"
          >
            {rotuloDoStatus}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {oferecerAssumir && (
            <Button
              size="sm"
              data-testid="dossie-conversa-assumir"
              disabled={claim.isPending}
              title={t("Você passa a responder esta conversa e o atendimento automático para aqui.")}
              onClick={() =>
                claim.mutate({
                  conversation_id: completa.id,
                  expected_assignee: completa.assigned_to_user_id,
                })
              }
            >
              {t("Assumir")}
            </Button>
          )}
          {oferecerReabrir && (
            <Button
              size="sm"
              variant="outline"
              data-testid="dossie-conversa-reabrir"
              disabled={reopen.isPending}
              title={t("Reabre o atendimento desta conversa, que estava encerrada.")}
              onClick={() =>
                reopen.mutate({
                  conversation_id: completa.id,
                  expected_revision: completa.service_revision,
                })
              }
            >
              {t("Reabrir")}
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="text-text-muted hover:text-text">
            <Link href={href} data-testid="dossie-conversa-abrir-inbox">
              {t("Abrir no Inbox")}
              <ArrowSquareOut aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ChatThread
            conversationId={completa.id}
            provider={completa.channel_sessions?.provider ?? null}
            onResponder={setRespondendo}
            dono={{
              userId: completa.assigned_to_user_id ?? null,
              nome: completa.assigned_to_user_name ?? null,
            }}
            contatoId={completa.contacts?.id ?? null}
            contatoRecusaEnvio={Boolean(completa.contacts?.is_blocked || completa.contacts?.is_personal)}
            // A gaveta rola: acompanhar o fim do fio não pode arrastá-la junto.
            soNaCaixa
          />
        </div>
        {/* A janela barra a RESPOSTA, não a nota: a caixa continua aberta para
            nota interna, e o motivo fica colado nela. O modelo aprovado, que é
            a saída, mora no inbox — o link acima. */}
        {estado.janelaFechada && (
          <p
            role="status"
            data-testid="dossie-conversa-janela"
            className="border-t border-border bg-warning-bg px-3 py-2 text-xs text-warning-fg"
          >
            {estado.janelaFechada}
          </p>
        )}
        <Composer
          key={completa.id}
          conversationId={completa.id}
          agendamentoLigado={estado.agendamentoLigado}
          blockedReason={estado.blockedReason}
          janelaFechada={estado.janelaFechada}
          disabled={estado.disabled}
          aguardandoAssumir={estado.aguardandoAssumir}
          recusaNotaDeVoz={estado.recusaNotaDeVoz}
          contactName={completa.contacts?.name ?? null}
          contactDisplayName={completa.contacts?.display_name}
          currentContactId={completa.contact_id}
          respondendo={respondendo}
          onCancelarResposta={() => setRespondendo(null)}
          usuarioId={user.id}
          // A conversa que continua em outro número (#3732) abre no inbox: o
          // dossiê é deste negócio, e trocar a conversa aqui dentro mostraria
          // outra pessoa debaixo do título dele.
          onAbrirConversa={(id) => router.push(`/app/inbox?id=${id}`)}
        />
      </div>
    </section>
  );
}
