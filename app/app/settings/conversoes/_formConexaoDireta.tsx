"use client";

/**
 * A conexão de conversões do GA4 e do TikTok (9488): credencial, regras de
 * evento, interruptor e "Testar conexão" — um formulário só para as duas
 * plataformas, que mudam só nos rótulos.
 *
 * O segredo nasce VAZIO e isso não é bug: a tela nunca o recebe (o estado traz
 * só `temSegredo`). Vazio ao salvar = "mantenha o gravado". Mesmo contrato do
 * formulário da Meta (`_form.tsx`).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import {
  EVENTOS_MAPEAVEIS,
  OPCOES_DE_EVENTO,
  type PlataformaComMapeamento,
} from "@/lib/plataformas-de-anuncio/mapeamento-de-eventos";
import type { EventoMapeavel, MapeamentoDeEventos } from "@/lib/plataformas-de-anuncio/types";

export interface EstadoDoFormulario {
  identificador: string | null;
  temSegredo: boolean;
  habilitada: boolean;
  testEventCode: string | null;
  mapeamento: MapeamentoDeEventos;
}

const ERRO_EM_PORTUGUES: Record<string, string> = {
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  unauthenticated: "Sua sessão expirou. Entre de novo.",
  forbidden_role: "Só um administrador da organização pode mudar esta conexão.",
  mfa_required: "Confirme o segundo fator para salvar esta mudança.",
  state_conflict: "Preencha o identificador e o token para poder salvar.",
  cifra_indisponivel:
    "Esta instalação está sem a chave mestra de criptografia, e o token não foi gravado. Quem instalou o sistema precisa configurá-la — refazer o cadastro aqui não resolve.",
  internal_error: "Não consegui gravar agora. Tente de novo em instantes.",
};

const ROTULO_DO_EVENTO: Record<EventoMapeavel, string> = {
  Purchase: "Compra",
  LeadSubmitted: "Novo lead",
  QualifiedLead: "Lead qualificado",
};

/** O que muda entre as duas plataformas: só texto. */
const TEXTOS: Record<
  PlataformaComMapeamento,
  {
    identificador: string;
    ajudaDoIdentificador: string;
    exemplo: string;
    segredo: string;
    ajudaDoSegredo: string;
  }
> = {
  ga4: {
    identificador: "ID de métricas",
    ajudaDoIdentificador:
      "Começa com G-. No Google Analytics, em Administrador › Fluxos de dados › seu fluxo da Web.",
    exemplo: "G-XXXXXXXXXX",
    segredo: "Chave secreta da API",
    ajudaDoSegredo:
      "No mesmo fluxo de dados, em Chaves secretas da API do Measurement Protocol. Guardada criptografada; ela nunca volta para esta tela.",
  },
  tiktok: {
    identificador: "Código do pixel",
    ajudaDoIdentificador: "No Gerenciador de Eventos do TikTok, nas configurações do pixel.",
    exemplo: "C4ABCDEF1234567890",
    segredo: "Token de acesso",
    ajudaDoSegredo:
      "Gerado no pixel, em Configurações › Events API. Guardado criptografado; ele nunca volta para esta tela.",
  },
};

const CAMPO_DE_SELECAO =
  "h-8 min-h-11 w-full rounded-md border border-border bg-surface px-2.5 text-base text-text hover:border-border-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent md:text-sm lg:min-h-0";

export function FormularioDaConexaoDireta({
  plataforma,
  estado,
  idioma,
}: {
  plataforma: PlataformaComMapeamento;
  estado: EstadoDoFormulario;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [salvando, startSalvar] = useTransition();
  const [testando, startTestar] = useTransition();
  const textos = TEXTOS[plataforma];

  const [identificador, setIdentificador] = useState(estado.identificador ?? "");
  const [segredo, setSegredo] = useState("");
  const [codigoDeTeste, setCodigoDeTeste] = useState(estado.testEventCode ?? "");
  const [habilitada, setHabilitada] = useState(estado.habilitada);
  const [eventos, setEventos] = useState<MapeamentoDeEventos>(estado.mapeamento);
  const [teste, setTeste] = useState<
    { passou: boolean; apenasFormato: boolean; detalhe: string | null } | null
  >(null);

  const podeSalvar =
    identificador.trim().length >= 4 && (estado.temSegredo || segredo.trim().length >= 8);
  const endereco = `/api/v1/plataformas-de-anuncio/${plataforma}`;

  function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    startSalvar(async () => {
      const resposta = await fetch(endereco, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identificador: identificador.trim(),
          ...(segredo.trim() ? { segredo: segredo.trim() } : {}),
          ...(plataforma === "tiktok" ? { test_event_code: codigoDeTeste.trim() || null } : {}),
          enabled: habilitada,
          eventos,
        }),
      }).catch(() => null);
      if (resposta?.ok) {
        setSegredo("");
        toast.success(t("Conexão salva."));
        router.refresh();
        return;
      }
      const corpo = (await resposta?.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      toast.error(t(ERRO_EM_PORTUGUES[corpo?.error?.code ?? ""] ?? "Não consegui salvar agora."));
    });
  }

  function testar() {
    setTeste(null);
    startTestar(async () => {
      const resposta = await fetch(`${endereco}/testar`, { method: "POST" }).catch(() => null);
      const corpo = (await resposta?.json().catch(() => null)) as {
        data?: { passou: boolean; apenasFormato: boolean; detalhe: string | null };
        error?: { code?: string };
      } | null;
      if (resposta?.ok && corpo?.data) {
        setTeste(corpo.data);
        return;
      }
      setTeste({
        passou: false,
        apenasFormato: false,
        detalhe: t(ERRO_EM_PORTUGUES[corpo?.error?.code ?? ""] ?? "Não consegui salvar agora."),
      });
    });
  }

  return (
    <form onSubmit={salvar} className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-4" aria-labelledby="credenciais-titulo">
        <h2 id="credenciais-titulo" className="text-sm font-semibold">
          {t("Credenciais")}
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="identificador">{t(textos.identificador)}</Label>
          <Input
            id="identificador"
            autoComplete="off"
            spellCheck={false}
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            placeholder={textos.exemplo}
          />
          <p className="text-xs text-text-muted">{t(textos.ajudaDoIdentificador)}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="segredo">{t(textos.segredo)}</Label>
          <Input
            id="segredo"
            type="password"
            autoComplete="off"
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            placeholder={
              estado.temSegredo
                ? t("Gravado. Deixe em branco para manter.")
                : t("Cole o token gerado na plataforma")
            }
          />
          <p className="text-xs text-text-muted">{t(textos.ajudaDoSegredo)}</p>
        </div>
        {plataforma === "tiktok" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="test_event_code">{t("Código de teste (opcional)")}</Label>
            <Input
              id="test_event_code"
              autoComplete="off"
              value={codigoDeTeste}
              onChange={(e) => setCodigoDeTeste(e.target.value)}
              placeholder="TEST12345"
            />
            <p className="text-xs text-text-muted">
              {t(
                "Enquanto preenchido, as vendas vão marcadas como teste e não contam para a otimização. Apague quando terminar de conferir.",
              )}
            </p>
          </div>
        )}
      </section>

      <section
        className="flex flex-col gap-4 border-t border-border pt-6"
        aria-labelledby="regras-titulo"
      >
        <div className="flex flex-col gap-1">
          <h2 id="regras-titulo" className="text-sm font-semibold">
            {t("Regras de conversão")}
          </h2>
          <p className="text-xs text-text-muted">
            {t("Qual evento da plataforma cada acontecimento do CRM vira. Escolha Não enviar para deixar de fora.")}
          </p>
        </div>
        <dl className="flex flex-col divide-y divide-border">
          {EVENTOS_MAPEAVEIS.map((evento) => (
            <div
              key={evento}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center"
            >
              <dt>
                <label htmlFor={`evento-${evento}`} className="block text-sm font-medium">
                  {t(ROTULO_DO_EVENTO[evento])}
                </label>
              </dt>
              <dd>
                <select
                  id={`evento-${evento}`}
                  data-testid={`evento-${evento}`}
                  className={CAMPO_DE_SELECAO}
                  value={eventos[evento] ?? ""}
                  onChange={(e) =>
                    setEventos((atual) => ({ ...atual, [evento]: e.target.value || null }))
                  }
                >
                  {OPCOES_DE_EVENTO[plataforma][evento].map((nome) => (
                    <option key={nome} value={nome}>
                      {nome}
                    </option>
                  ))}
                  <option value="">{t("Não enviar")}</option>
                </select>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex items-center justify-between gap-4 border-t border-border pt-6">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="enabled">{t("Reportar vendas automaticamente")}</Label>
          <p className="text-xs text-text-muted">
            {t("Desligar pausa o envio e mantém a credencial gravada.")}
          </p>
        </div>
        <Switch id="enabled" checked={habilitada} onCheckedChange={setHabilitada} />
      </section>

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button
          type="submit"
          className="min-h-11 lg:min-h-0"
          disabled={salvando || !podeSalvar}
        >
          {salvando ? t("Salvando…") : t("Salvar conexão")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 lg:min-h-0"
          disabled={testando || !estado.temSegredo}
          onClick={testar}
        >
          {testando ? t("Testando…") : t("Testar conexão")}
        </Button>
        {!podeSalvar && (
          <span className="text-xs text-text-muted">
            {t("Preencha o identificador e o token para poder salvar.")}
          </span>
        )}
      </div>

      <div role="status" aria-live="polite" data-testid="resultado-do-teste">
        {teste && (
          <p
            className={
              teste.passou
                ? "rounded-md bg-success-bg px-3 py-2 text-sm text-success-fg"
                : "rounded-md bg-error-bg px-3 py-2 text-sm text-error-fg"
            }
          >
            {teste.passou
              ? teste.apenasFormato
                ? t("O Google aceitou o formato do evento. Esta checagem não confere a chave secreta: confira os eventos no relatório em tempo real do GA4.")
                : t("Conexão funcionando. O evento de teste aparece em Testar eventos, no TikTok.")
              : `${t("A plataforma recusou o teste.")} ${teste.detalhe ?? ""}`.trim()}
          </p>
        )}
      </div>
    </form>
  );
}
