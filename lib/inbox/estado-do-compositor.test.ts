import { describe, expect, it } from "vitest";

import { recusaNotaDeVoz } from "@/lib/channels/capabilities";
import { estadoDaJanela } from "@/lib/channels/janela";
import { composerBloqueadoAteAssumir } from "@/lib/inbox/bloqueio-ate-assumir";
import { motivoDaJanelaFechada, motivoDoContato } from "@/lib/inbox/motivo-do-envio-bloqueado";
import { DEFAULT_CHANNEL_PROVIDER, CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_SOCIAL, CHANNEL_PROVIDER_TELEGRAM } from "@/lib/channels/capabilities";

import {
  estadoDoCompositor,
  MOTIVO_SUPORTE_SOMENTE_LEITURA,
  type ConversaDoCompositor,
  type EntradaDoCompositor,
} from "./estado-do-compositor";

/**
 * A composição do bloqueio do compositor, caso a caso — e a PARIDADE com o
 * `InboxLayout`, que é a razão de esta função existir: o inbox vai trocar o
 * inline por ela, e o dossiê do negócio já a usa. Se as duas divergirem, o
 * funil deixa mandar o que o inbox barra.
 */

const t = (texto: string) => `«${texto}»`;
const AGORA = new Date("2026-11-24T12:00:00Z");
const HA = (horas: number) => new Date(AGORA.getTime() - horas * 3_600_000).toISOString();
const EU = "u-eu";
const OUTRO = "u-outro";

function conversa(over: Partial<ConversaDoCompositor> = {}): ConversaDoCompositor {
  return {
    status: "open",
    assigned_to_user_id: EU,
    last_inbound_at: HA(1),
    channel_session_id: "sess-1",
    contacts: { id: "c-1", is_blocked: false, is_anonymized: false },
    channel_sessions: { provider: DEFAULT_CHANNEL_PROVIDER },
    ...over,
  };
}

function entrada(over: Partial<EntradaDoCompositor> = {}): EntradaDoCompositor {
  return {
    conversa: conversa(),
    usuario: { id: EU, support: null },
    bloquearAteAssumir: false,
    participanteAtivo: false,
    agora: AGORA,
    t,
    ...over,
  };
}

describe("conversa comum, nada barra", () => {
  it("tudo liberado no WhatsApp pareado", () => {
    const e = estadoDoCompositor(entrada());
    expect(e).toMatchObject({
      janelaFechada: null,
      blockedReason: null,
      disabled: false,
      aguardandoAssumir: false,
      recusaNotaDeVoz: false,
      agendamentoLigado: true,
      somenteLeitura: false,
    });
    expect(e.janela).toEqual({ tipo: "sem_restricao" });
  });
});

describe("a janela de 24h", () => {
  it("canal oficial com o cliente escrevendo há 30h: fechada, com o motivo do modelo", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ channel_sessions: { provider: CHANNEL_PROVIDER_META }, last_inbound_at: HA(30) }) }),
    );
    expect(e.janela.tipo).toBe("fechada");
    expect(e.janelaFechada).toContain("«A janela de 24h fechou há»");
    expect(e.janelaFechada).toContain("«Só um modelo aprovado sai daqui — texto livre é recusado pela plataforma.»");
    // A janela barra a RESPOSTA, não o compositor inteiro: nada mais trava.
    expect(e.blockedReason).toBeNull();
    expect(e.disabled).toBe(false);
  });

  it("canal oficial em que o cliente nunca escreveu: fechada, 'nunca abriu'", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ channel_sessions: { provider: CHANNEL_PROVIDER_META }, last_inbound_at: null }) }),
    );
    expect(e.janelaFechada).toBe(
      "«O cliente ainda não escreveu — a janela de 24h nunca abriu. Só um modelo aprovado sai daqui.»",
    );
  });

  it("canal oficial dentro das 24h: aberta, sem motivo", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ channel_sessions: { provider: CHANNEL_PROVIDER_META }, last_inbound_at: HA(2) }) }),
    );
    expect(e.janela.tipo).toBe("aberta");
    expect(e.janelaFechada).toBeNull();
  });

  it("rede social fechada: o motivo é esperar o cliente, não modelo", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ channel_sessions: { provider: CHANNEL_PROVIDER_SOCIAL }, last_inbound_at: HA(48) }) }),
    );
    expect(e.janelaFechada).toBe(
      "«Aguarde uma nova mensagem do cliente para reabrir o atendimento nesta rede.»",
    );
  });

  it("WhatsApp pareado não tem janela, mesmo com a última entrada há uma semana", () => {
    const e = estadoDoCompositor(entrada({ conversa: conversa({ last_inbound_at: HA(24 * 7) }) }));
    expect(e.janelaFechada).toBeNull();
  });
});

describe("o contato e o suporte", () => {
  it("contato bloqueado trava com o motivo do contato", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ contacts: { id: "c-1", is_blocked: true, is_anonymized: false } }) }),
    );
    expect(e.blockedReason).toBe("«Contato bloqueado — envio de mensagens desabilitado.»");
  });

  it("contato anonimizado trava com o motivo da LGPD", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ contacts: { id: "c-1", is_blocked: false, is_anonymized: true } }) }),
    );
    expect(e.blockedReason).toBe("«Contato anonimizado — não é possível enviar mensagens.»");
  });

  it("suporte somente leitura vence o contato, CRU (como o inbox passa) e desliga o agendamento", () => {
    const e = estadoDoCompositor(
      entrada({
        usuario: { id: EU, support: { access_mode: "support_readonly" } },
        conversa: conversa({ contacts: { id: "c-1", is_blocked: true, is_anonymized: false } }),
      }),
    );
    expect(e.blockedReason).toBe(MOTIVO_SUPORTE_SOMENTE_LEITURA);
    expect(e.blockedReason).toBe("Acompanhamento somente leitura");
    expect(e.agendamentoLigado).toBe(false);
    expect(e.somenteLeitura).toBe(true);
  });

  it("suporte com escrita não é somente leitura", () => {
    const e = estadoDoCompositor(entrada({ usuario: { id: EU, support: { access_mode: "support_write" } } }));
    expect(e.blockedReason).toBeNull();
    expect(e.somenteLeitura).toBe(false);
  });
});

describe("conversa fechada", () => {
  it("só `closed` desabilita — arquivada e resolvida seguem como no inbox", () => {
    expect(estadoDoCompositor(entrada({ conversa: conversa({ status: "closed" }) })).disabled).toBe(true);
    expect(estadoDoCompositor(entrada({ conversa: conversa({ status: "archived" }) })).disabled).toBe(false);
    expect(estadoDoCompositor(entrada({ conversa: conversa({ status: "resolved" }) })).disabled).toBe(false);
  });
});

describe("a trava até assumir (#3012)", () => {
  it("opção ligada e conversa sem dono: trava", () => {
    const e = estadoDoCompositor(
      entrada({ bloquearAteAssumir: true, conversa: conversa({ assigned_to_user_id: null }) }),
    );
    expect(e.aguardandoAssumir).toBe(true);
  });

  it("opção ligada e dono é outro: trava", () => {
    const e = estadoDoCompositor(
      entrada({ bloquearAteAssumir: true, conversa: conversa({ assigned_to_user_id: OUTRO }) }),
    );
    expect(e.aguardandoAssumir).toBe(true);
  });

  it("opção ligada, dono é outro, mas eu participo do atendimento: libera", () => {
    const e = estadoDoCompositor(
      entrada({
        bloquearAteAssumir: true,
        participanteAtivo: true,
        conversa: conversa({ assigned_to_user_id: OUTRO }),
      }),
    );
    expect(e.aguardandoAssumir).toBe(false);
  });

  it("opção ligada e a conversa é minha: libera", () => {
    expect(estadoDoCompositor(entrada({ bloquearAteAssumir: true })).aguardandoAssumir).toBe(false);
  });

  it("opção desligada ou ausente: nunca trava", () => {
    for (const bloquearAteAssumir of [false, undefined]) {
      const e = estadoDoCompositor(
        entrada({ bloquearAteAssumir, conversa: conversa({ assigned_to_user_id: null }) }),
      );
      expect(e.aguardandoAssumir).toBe(false);
    }
  });
});

describe("o canal e os recursos", () => {
  it("rede social recusa a nota de voz", () => {
    const e = estadoDoCompositor(
      entrada({ conversa: conversa({ channel_sessions: { provider: CHANNEL_PROVIDER_SOCIAL } }) }),
    );
    expect(e.recusaNotaDeVoz).toBe(true);
  });

  it("sem número ou sem contato o agendamento não liga", () => {
    expect(estadoDoCompositor(entrada({ conversa: conversa({ channel_session_id: null }) })).agendamentoLigado).toBe(false);
    expect(estadoDoCompositor(entrada({ conversa: conversa({ contacts: null }) })).agendamentoLigado).toBe(false);
  });

  it("sem conversa: tudo liberado (o inbox sem seleção)", () => {
    const e = estadoDoCompositor(entrada({ conversa: null, bloquearAteAssumir: true }));
    expect(e).toMatchObject({
      janelaFechada: null,
      blockedReason: null,
      disabled: false,
      aguardandoAssumir: false,
      recusaNotaDeVoz: false,
      agendamentoLigado: false,
    });
  });
});

/**
 * A PARIDADE. Isto é o inline do `InboxLayout` (l.689–702 e 1167–1200, no dia
 * em que esta função nasceu), reescrito expressão por expressão. Uma matriz de
 * estados passa pelos dois, e o resultado tem de ser idêntico.
 */
function comoOInboxDecide(e: EntradaDoCompositor) {
  const selectedConversation = e.conversa ?? null;
  const supportReadonly = e.usuario.support?.access_mode === "support_readonly";
  const janela = estadoDaJanela(
    selectedConversation?.channel_sessions?.provider ?? null,
    selectedConversation?.last_inbound_at ?? null,
    e.agora,
  );
  const motivoDaJanela = motivoDaJanelaFechada(janela, selectedConversation?.channel_sessions?.provider, e.t);
  const blockedReason = motivoDoContato(selectedConversation?.contacts, e.t);
  return {
    janelaFechada: motivoDaJanela,
    blockedReason: supportReadonly ? "Acompanhamento somente leitura" : blockedReason,
    disabled: selectedConversation?.status === "closed",
    aguardandoAssumir: composerBloqueadoAteAssumir({
      ligada: e.bloquearAteAssumir === true,
      donoDaConversa: selectedConversation!.assigned_to_user_id,
      atendenteId: e.usuario.id,
      participanteAtivo: e.participanteAtivo,
    }),
    recusaNotaDeVoz: recusaNotaDeVoz(selectedConversation?.channel_sessions?.provider),
    agendamentoLigado:
      Boolean(selectedConversation?.contacts?.id && selectedConversation?.channel_session_id) && !supportReadonly,
  };
}

describe("paridade com o InboxLayout", () => {
  it("dá o MESMO resultado numa matriz de estados", () => {
    const providers = [DEFAULT_CHANNEL_PROVIDER, CHANNEL_PROVIDER_META, CHANNEL_PROVIDER_SOCIAL, CHANNEL_PROVIDER_TELEGRAM, null];
    const entradas = [null, HA(1), HA(30)];
    const donos = [null, EU, OUTRO];
    const status = ["open", "closed", "archived"];
    const contatos = [
      { id: "c-1", is_blocked: false, is_anonymized: false },
      { id: "c-1", is_blocked: true, is_anonymized: false },
      { id: "c-1", is_blocked: false, is_anonymized: true },
      null,
    ];
    const suportes = [null, { access_mode: "support_readonly" }];
    let casos = 0;
    for (const provider of providers)
      for (const last_inbound_at of entradas)
        for (const assigned_to_user_id of donos)
          for (const s of status)
            for (const contacts of contatos)
              for (const support of suportes)
                for (const bloquearAteAssumir of [true, false])
                  for (const participanteAtivo of [true, false]) {
                    const e = entrada({
                      conversa: conversa({
                        status: s,
                        assigned_to_user_id,
                        last_inbound_at,
                        contacts,
                        channel_sessions: provider ? { provider } : null,
                      }),
                      usuario: { id: EU, support },
                      bloquearAteAssumir,
                      participanteAtivo,
                    });
                    const { janela: _j, somenteLeitura: _s, ...daFuncao } = estadoDoCompositor(e);
                    expect(daFuncao).toEqual(comoOInboxDecide(e));
                    casos++;
                  }
    expect(casos).toBeGreaterThan(1000);
  });
});
