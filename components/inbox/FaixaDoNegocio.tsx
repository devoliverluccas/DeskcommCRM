"use client";

/**
 * A FAIXA DO NEGÓCIO — logo abaixo do cabeçalho da conversa.
 *
 * O negócio aberto mais recente do contato, numa linha: título, valor, funil, a
 * etapa com as setas de avançar e voltar, a barrinha do caminho no funil, e os
 * desfechos (Ganho, Perdido) mais o "Novo negócio". É o gesto que a pessoa faz
 * no meio do atendimento — "o cliente confirmou, passa para a próxima etapa" —
 * sem rolar o painel do contato até o bloco de negócios.
 *
 * ─── Onde ela mora, e por quê ────────────────────────────────────────────────
 *
 * IRMÃ do `ConversationHeader`, montada pelo `InboxLayout`, e nunca dentro dele:
 * os testes do cabeçalho medem `container.firstElementChild` como o cabeçalho
 * inteiro (largura mínima, barra enxuta), e a faixa lá dentro somaria à largura
 * que a barra de ações já disputa.
 *
 * ─── O que ela NÃO faz ───────────────────────────────────────────────────────
 *
 * Não reimplementa regra de funil. Ler, mover, ganhar e as recusas moram em
 * `useNegocioDaConversa`; os diálogos são os do quadro (campos obrigatórios,
 * motivo da perda, retomada, novo negócio).
 *
 * ─── Telas estreitas ─────────────────────────────────────────────────────────
 *
 * Abaixo do `md` a faixa é UMA linha com a etapa e as setas: título, valor e
 * desfechos saem (estão na Ficha), porque cada linha ali é altura tirada do fio
 * da conversa. Os alvos têm 44px abaixo do `lg`, como o resto da casca.
 */

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CamposObrigatoriosDialog } from "@/components/kanban/CamposObrigatoriosDialog";
import { LoseLeadDialog } from "@/components/kanban/LoseLeadDialog";
import { NewLeadDialog } from "@/components/kanban/NewLeadDialog";
import { RetomarComoNovoNegocioDialog } from "@/components/kanban/RetomarComoNovoNegocioDialog";
import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";
import {
  etapasDoCaminho,
  etapaVizinha,
  useNegocioDaConversa,
  type EtapaDoFunil,
} from "@/hooks/inbox/useNegocioDaConversa";
import { useDefaultPipeline } from "@/hooks/pipelines/useDefaultPipeline";
import { ROLE_RANK } from "@/lib/auth/types";
import { MOEDA_PADRAO, formatValorDoNegocio } from "@/lib/money";
import { CaretLeft, CaretRight, CheckCircle, Plus, XCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

interface Props {
  conversation: ConversationWithContact;
  /** Acompanhamento de suporte em leitura: a faixa informa, não age. */
  somenteLeitura?: boolean;
}

/**
 * A barrinha do caminho: um segmento por etapa do caminho (sem as de desfecho),
 * cheios até a atual. Decorativa (`aria-hidden`): quem diz a etapa a um leitor
 * de tela é o seletor ao lado.
 */
function CaminhoNoFunil({
  etapas,
  atual,
  className,
}: {
  etapas: EtapaDoFunil[];
  atual: string | undefined;
  className?: string;
}) {
  const caminho = etapasDoCaminho(etapas);
  if (caminho.length < 2) return null;
  const etapaAtual = etapas.find((e) => e.id === atual);
  // Numa etapa de desfecho (o ganho otimista, por exemplo) o caminho está todo andado.
  const idx =
    etapaAtual && (etapaAtual.is_won || etapaAtual.is_lost)
      ? caminho.length - 1
      : caminho.findIndex((e) => e.id === atual);
  return (
    <div
      aria-hidden
      data-testid="faixa-caminho"
      className={cn("flex h-1 shrink-0 items-stretch gap-0.5", className)}
    >
      {caminho.map((e, i) => (
        <span
          key={e.id}
          data-cheio={i <= idx ? "sim" : "nao"}
          className={cn(
            "min-w-0 flex-1 rounded-full",
            i < idx ? "bg-text-muted" : i === idx ? "bg-text" : "bg-border",
          )}
        />
      ))}
    </div>
  );
}

export function FaixaDoNegocio({ conversation, somenteLeitura = false }: Props) {
  const t = useT();
  const { user, activeOrg } = useAuth();
  const contato = conversation.contacts ?? null;
  // Grupo não é pessoa, e contato anonimizado não abre negócio: nos dois a
  // faixa não existe (a leitura nem sai).
  const contactId =
    conversation.is_group || contato?.is_anonymized
      ? null
      : (contato?.id ?? conversation.contact_id ?? null);

  const n = useNegocioDaConversa(contactId);

  // Mover, ganhar, perder e criar são `agent`+ nas rotas (`requireRole("agent")`);
  // a faixa não oferece o que a rota recusaria.
  const podeAgir =
    !somenteLeitura &&
    ((user?.is_platform_admin === true && !user?.support) ||
      (activeOrg != null && ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent));

  const [perdendo, setPerdendo] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  // O funil padrão é lido no CLIQUE (a mesma chave do painel, então quem já o
  // leu ali não espera de novo): sem funil, o aviso sai no gesto, e o diálogo
  // só abre com onde criar.
  const funilPadrao = useDefaultPipeline(false);
  async function abrirNovo() {
    const lido = await funilPadrao.refetch();
    if (lido.isError || !lido.data) {
      toast.error(t("Nenhum funil configurado nesta organização."));
      return;
    }
    setNovoAberto(true);
  }

  if (!contactId || n.carregando || n.falhou) return null;

  const botaoNovo = podeAgir ? (
    <Button
      size="sm"
      variant="ghost"
      className="gap-1.5 text-text-muted hover:text-text"
      data-testid="faixa-novo-negocio"
      disabled={funilPadrao.isFetching}
      onClick={() => void abrirNovo()}
    >
      <Plus aria-hidden />
      {funilPadrao.isFetching ? t("Carregando…") : t("Novo negócio")}
    </Button>
  ) : null;

  const dialogoNovo =
    novoAberto && funilPadrao.data ? (
      <NewLeadDialog
        open={novoAberto}
        onOpenChange={setNovoAberto}
        pipelineId={funilPadrao.data.pipeline.id}
        stages={funilPadrao.data.stages}
        settings={funilPadrao.data.pipeline.settings}
        contactId={contactId}
        onCreated={() => {
          n.escolherNegocio(null);
          n.reler();
        }}
      />
    ) : null;

  const negocio = n.negocio;
  if (!negocio) {
    // Sem negócio aberto: só a porta para criar um. Abaixo do `md` nem isso —
    // a Ficha tem o mesmo botão, e uma linha só para ele comeria o fio.
    if (!botaoNovo) return null;
    return (
      <div
        className="flex items-center border-b border-border px-3 py-0.5 max-md:hidden md:px-4"
        data-testid="faixa-do-negocio"
        data-estado="sem-negocio"
      >
        <div className="-ml-2">{botaoNovo}</div>
        {dialogoNovo}
      </div>
    );
  }

  const etapas = n.etapas;
  const atual = n.etapaExibida;
  const anterior = etapaVizinha(etapas, atual, -1);
  const proxima = etapaVizinha(etapas, atual, 1);
  const valor =
    negocio.value_cents != null
      ? formatValorDoNegocio(negocio.value_cents, negocio.currency ?? MOEDA_PADRAO)
      : null;
  const ocupado = n.movendo || n.ganhando;

  return (
    <section
      aria-label={t("Negócio")}
      data-testid="faixa-do-negocio"
      data-negocio={negocio.id}
      className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-0.5 text-xs md:gap-3 md:px-4"
    >
      {/* QUAL NEGÓCIO: o título (ou o seletor, com mais de um aberto) e o valor. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 max-md:hidden">
        {n.abertos.length > 1 ? (
          <Select value={negocio.id} onValueChange={(id) => n.escolherNegocio(id)}>
            <SelectTrigger
              aria-label={t("Negócio")}
              data-testid="faixa-escolher-negocio"
              className="h-7 w-auto max-w-[18rem] min-w-0 gap-1 border-transparent bg-transparent px-1.5 text-[13px] font-medium hover:bg-hover"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {n.abertos.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.funil_nome ? `${l.title} · ${l.funil_nome}` : l.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span
            className="min-w-0 truncate text-[13px] font-medium text-text"
            title={negocio.title}
          >
            {negocio.title}
          </span>
        )}
        {valor && (
          <span
            className="shrink-0 font-mono text-xs text-text-muted tabular-nums"
            data-testid="faixa-valor"
          >
            {valor}
          </span>
        )}
      </div>

      {/* ONDE ELE ESTÁ: funil, setas e etapa. O funil só a partir do `lg`, onde
          sobra largura; a etapa diz o essencial sozinha. */}
      <div className="flex min-w-0 items-center gap-1 max-md:flex-1">
        {negocio.funil_nome && (
          <span
            className="max-w-[10rem] truncate text-text-subtle max-lg:hidden"
            title={negocio.funil_nome}
          >
            {negocio.funil_nome}
          </span>
        )}
        {podeAgir && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 lg:h-7 lg:w-7"
            aria-label={t("Etapa anterior")}
            title={anterior ? anterior.name : undefined}
            data-testid="faixa-etapa-anterior"
            disabled={!anterior || ocupado}
            onClick={() => n.andar(-1)}
          >
            <CaretLeft aria-hidden />
          </Button>
        )}
        {etapas.length > 0 && atual ? (
          <Select
            value={atual}
            onValueChange={(v) => void n.mudarEtapa(v)}
            disabled={!podeAgir || ocupado}
          >
            <SelectTrigger
              aria-label={t("Etapa do funil")}
              data-testid="faixa-etapa-select"
              className="h-7 w-auto max-w-[14rem] min-w-0 gap-1 px-2 text-xs max-md:max-w-none max-md:flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {etapas.map((e) => (
                <SelectItem key={e.id} value={e.id} className="text-xs">
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // Resposta antiga da rota (sem as etapas): o nome, sem seletor vazio.
          <span className="truncate text-text">{negocio.etapa_nome ?? "—"}</span>
        )}
        {podeAgir && (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 lg:h-7 lg:w-7"
            aria-label={t("Próxima etapa")}
            title={proxima ? proxima.name : undefined}
            data-testid="faixa-etapa-proxima"
            disabled={!proxima || ocupado}
            onClick={() => n.andar(1)}
          >
            <CaretRight aria-hidden />
          </Button>
        )}
      </div>

      <CaminhoNoFunil etapas={etapas} atual={atual} className="w-16 max-md:hidden lg:w-24" />

      {/* OS DESFECHOS e o negócio novo — à direita, fora do celular. */}
      {podeAgir && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5 max-md:hidden">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            data-testid="faixa-ganho"
            disabled={ocupado}
            onClick={() => n.marcarGanho()}
          >
            <CheckCircle aria-hidden className="text-success-fg" />
            {t("Ganho")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            data-testid="faixa-perdido"
            disabled={ocupado}
            onClick={() => setPerdendo(true)}
          >
            <XCircle aria-hidden className="text-error-fg" />
            {t("Perdido")}
          </Button>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          {botaoNovo}
        </div>
      )}

      {/* Os diálogos do quadro, cada um com a sua pendência — e montados só
          quando abrem: fechados, cada um consultaria o próprio contexto (moeda,
          motivos do funil) em toda conversa aberta, para ninguém. */}
      {perdendo && (
        <LoseLeadDialog
          key={`perdido:${negocio.id}`}
          open
          onOpenChange={setPerdendo}
          leadId={negocio.id}
          leadLabel={negocio.title}
          pipelineId={negocio.pipeline_id}
          motivos={negocio.motivos_de_perda}
          onPerdido={() => {
            n.escolherNegocio(null);
            n.reler();
          }}
        />
      )}
      {n.perda && (
        <LoseLeadDialog
          key={`perda:${n.perda.stageId}`}
          open
          onOpenChange={(aberto) => {
            if (!aberto) n.fecharPerda();
          }}
          pipelineId={negocio.pipeline_id}
          leadLabel={negocio.title}
          motivos={negocio.motivos_de_perda}
          submitting={n.movendo}
          onConfirm={(motivo) => n.confirmarPerda(motivo)}
        />
      )}
      {n.recusa && (
        <CamposObrigatoriosDialog
          open
          onOpenChange={(aberto) => {
            if (!aberto) n.fecharRecusa();
          }}
          recusa={n.recusa}
          isPending={n.movendo}
          onConfirmar={n.confirmarCampos}
        />
      )}
      {n.retomada && (
        <RetomarComoNovoNegocioDialog
          open
          onOpenChange={(aberto: boolean) => {
            if (!aberto) n.fecharRetomada();
          }}
          leadId={n.retomada.leadId}
          stageId={n.retomada.stageId}
          pipelineId={negocio.pipeline_id}
        />
      )}
      {dialogoNovo}
    </section>
  );
}
