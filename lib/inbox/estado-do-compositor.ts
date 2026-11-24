/**
 * O QUE TRAVA O COMPOSITOR DESTA CONVERSA — numa função só.
 *
 * A decisão nasceu inline no `InboxLayout`: janela de 24h, contato bloqueado ou
 * anonimizado, suporte somente leitura, conversa fechada, a trava "até assumir"
 * (#3012) e o canal que recusa nota de voz. Cada pedaço já tinha a sua regra
 * pura (`motivo-do-envio-bloqueado`, `bloqueio-ate-assumir`, `janela`,
 * `capabilities`); o que faltava era a COMPOSIÇÃO, e ela morava no JSX.
 *
 * Ela sai daqui porque o compositor passou a aparecer num segundo lugar — o
 * dossiê do negócio. Duas telas montando o mesmo `Composer` com duas cópias da
 * composição divergem: a correção entra numa e não na outra, e o atendente
 * aprende que "pelo funil dá para mandar o que o inbox barra".
 *
 * A regra aqui é a do `InboxLayout` TAL COMO ESTÁ, inclusive nos detalhes:
 *
 *   - o motivo do suporte somente leitura vai CRU, sem `t()` — é o que o inbox
 *     passa hoje, e esta função existe para o inbox poder trocar o inline por
 *     ela sem mudar uma vírgula da tela;
 *   - `disabled` é só `status === "closed"` (arquivada e resolvida não travam
 *     o compositor no inbox; quem oferece "Reabrir" é outra pergunta);
 *   - `estadoDaJanela` não é protegido por `try`: provider desconhecido lança
 *     lá, e lançaria aqui igual.
 *
 * Função PURA: o relógio (`agora`), a tradução (`t`) e o que vem da sessão
 * entram por parâmetro. Quem chama mantém o relógio andando (o inbox recalcula
 * a cada 30s) — sem isso a janela venceria com a aba aberta e o compositor
 * seguiria liberado.
 */
import { recusaNotaDeVoz as canalRecusaNotaDeVoz } from "@/lib/channels/capabilities";
import { estadoDaJanela, type EstadoDaJanela } from "@/lib/channels/janela";
import { composerBloqueadoAteAssumir } from "@/lib/inbox/bloqueio-ate-assumir";
import { motivoDaJanelaFechada, motivoDoContato } from "@/lib/inbox/motivo-do-envio-bloqueado";

type Traduzir = (texto: string) => string;

/** O que a função lê da conversa — um recorte de `ConversationWithContact`. */
export interface ConversaDoCompositor {
  status: string;
  assigned_to_user_id: string | null;
  last_inbound_at: string | null;
  channel_session_id?: string | null;
  contacts?: {
    id?: string | null;
    is_blocked?: boolean | null;
    is_anonymized?: boolean | null;
  } | null;
  channel_sessions?: { provider?: string | null } | null;
}

export interface EntradaDoCompositor {
  /** A conversa aberta. `null` devolve tudo liberado, como o inbox sem seleção. */
  conversa: ConversaDoCompositor | null | undefined;
  /** Quem está na tela (`user.id`) e o modo de suporte, quando houver. */
  usuario: {
    id: string | null;
    support?: { access_mode?: string | null } | null;
  };
  /** `activeOrg.interface_settings.bloquearAteAssumir` — a opção da ORGANIZAÇÃO. */
  bloquearAteAssumir: boolean | undefined;
  /** Vínculo ativo na rota de participantes (#2542). */
  participanteAtivo: boolean;
  agora: Date;
  t: Traduzir;
}

export interface EstadoDoCompositor {
  /** A régua da janela, para quem quiser mostrar relógio ou oferecer modelo. */
  janela: EstadoDaJanela;
  /** O motivo da janela fechada — vai em `Composer.janelaFechada`. */
  janelaFechada: string | null;
  /** Contato bloqueado/anonimizado ou suporte somente leitura — `Composer.blockedReason`. */
  blockedReason: string | null;
  /** `Composer.disabled`: a conversa está fechada. */
  disabled: boolean;
  /** `Composer.aguardandoAssumir` (#3012). */
  aguardandoAssumir: boolean;
  /** `Composer.recusaNotaDeVoz`: o canal não aceita a nota de voz gravada. */
  recusaNotaDeVoz: boolean;
  /** `Composer.agendamentoLigado`: há contato e número, e não é suporte só leitura. */
  agendamentoLigado: boolean;
  /** O suporte temporário em modo só leitura — quem chama esconde os gestos de escrita. */
  somenteLeitura: boolean;
}

/** O texto que o inbox passa CRU ao compositor no suporte somente leitura. */
export const MOTIVO_SUPORTE_SOMENTE_LEITURA = "Acompanhamento somente leitura";

export function estadoDoCompositor(entrada: EntradaDoCompositor): EstadoDoCompositor {
  const { conversa, usuario, t } = entrada;
  const provider = conversa?.channel_sessions?.provider;
  const somenteLeitura = usuario.support?.access_mode === "support_readonly";

  const janela = estadoDaJanela(provider ?? null, conversa?.last_inbound_at ?? null, entrada.agora);
  const janelaFechada = motivoDaJanelaFechada(janela, provider, t);
  const blockedReason = somenteLeitura
    ? MOTIVO_SUPORTE_SOMENTE_LEITURA
    : motivoDoContato(conversa?.contacts, t);

  // Sem conversa, a trava de assumir não tem dono a comparar: o inbox nem
  // desenha o compositor nesse estado, e liberar é o lado de sempre.
  const aguardandoAssumir = conversa
    ? composerBloqueadoAteAssumir({
        ligada: entrada.bloquearAteAssumir === true,
        donoDaConversa: conversa.assigned_to_user_id,
        atendenteId: usuario.id,
        participanteAtivo: entrada.participanteAtivo,
      })
    : false;

  return {
    janela,
    janelaFechada,
    blockedReason,
    disabled: conversa?.status === "closed",
    aguardandoAssumir,
    recusaNotaDeVoz: canalRecusaNotaDeVoz(provider),
    agendamentoLigado:
      Boolean(conversa?.contacts?.id && conversa?.channel_session_id) && !somenteLeitura,
    somenteLeitura,
  };
}
