"use client";
/**
 * "Testar" (fase 4, 4.1) — a automação SALVA contra um contato escolhido, sem
 * efeito: `POST /api/v1/automation-rules/[id]/testar`. A tela traduz cada código
 * do resultado (`lib/automation/simular-regra.ts`) numa frase.
 */
import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type {
  AvisoDaAcao,
  ResultadoDaSimulacao,
  SituacaoDasCondicoes,
  SituacaoDoGatilho,
} from "@/lib/automation/simular-regra";
import { GATILHO_PALAVRA_CHAVE } from "@/lib/automation/gatilho-palavra-chave";
import { CheckCircle, Play, Warning, X, XCircle } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

import { ACTION_LABELS, type ActionType } from "./labels";

const GATILHO: Record<SituacaoDoGatilho, string> = {
  casou: "O gatilho dispararia: a mensagem tem a palavra",
  nao_casou: "O gatilho não dispararia: a mensagem não tem nenhuma das palavras.",
  suposto: "O teste supõe que o gatilho aconteceu agora.",
  falta_texto: "Escreva uma mensagem de exemplo para conferir as palavras-chave.",
  nao_configurado: "O gatilho salvo está sem palavras-chave.",
};

const CONDICOES: Record<SituacaoDasCondicoes, string> = {
  passam: "As condições passam para este contato.",
  nao_passam: "As condições não passam para este contato.",
  sem_condicoes: "Sem condições: vale para todo contato.",
};

const AVISO: Record<AvisoDaAcao, string> = {
  acao_invalida: "Esta ação está incompleta e não rodaria.",
  fecharia_laco: "Esta ação não roda com este gatilho: dispararia a automação de novo.",
  sem_contato: "Não rodaria: não há contato.",
  sem_telefone: "Não rodaria: o contato não tem telefone.",
  sem_email: "Não rodaria: o contato não tem e-mail.",
  canal_inativo: "Não rodaria agora: o número de WhatsApp escolhido não está conectado.",
  sem_negocio: "Não rodaria: o contato não tem negócio aberto.",
  negocio_nao_ganho: "Não enviaria: a venda só sai de negócio ganho, e este negócio está aberto.",
  sem_conversa: "Não rodaria: o contato não tem conversa aberta.",
};

interface ContatoDaBusca {
  id: string;
  name: string | null;
  phone_number: string | null;
}

function useBuscaDeContatos(busca: string) {
  const termo = busca.trim();
  return useQuery({
    queryKey: ["automacao-testar-contatos", termo],
    enabled: termo.length >= 2,
    staleTime: 15_000,
    queryFn: async () =>
      apiClient.get<{ data: ContatoDaBusca[] }>(`/api/v1/contacts?search=${encodeURIComponent(termo)}&limit=5`),
  });
}

export function TestarAutomacao({ ruleId, evento }: { ruleId: string; evento: string }) {
  const t = useT();
  const [busca, setBusca] = React.useState("");
  const [contato, setContato] = React.useState<ContatoDaBusca | null>(null);
  const [texto, setTexto] = React.useState("");
  const { data: achados, isFetching } = useBuscaDeContatos(contato ? "" : busca);

  const testar = useMutation({
    mutationFn: async () =>
      apiClient.post<{ data: ResultadoDaSimulacao }>(`/api/v1/automation-rules/${ruleId}/testar`, {
        contact_id: contato?.id,
        ...(texto.trim() ? { texto } : {}),
      }),
    onError: showApiError,
  });
  const resultado = testar.data?.data;
  const pedeTexto = evento === GATILHO_PALAVRA_CHAVE || evento === "message.received";

  return (
    <section aria-labelledby="testar-automacao" className="space-y-3">
      <div className="space-y-1">
        <h3 id="testar-automacao" className="text-base font-semibold text-text">
          {t("Testar")}
        </h3>
        <p className="text-sm text-text-muted">
          {t("Simula a versão salva desta automação contra um contato. Nada é enviado nem alterado.")}
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="testar-contato">{t("Escolha o contato")}</Label>
        {contato ? (
          <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 lg:min-h-9">
            <span className="truncate text-sm text-text">
              {contato.name || contato.phone_number || t("Sem nome")}
              {contato.phone_number && contato.name ? (
                <span className="text-text-muted"> · {contato.phone_number}</span>
              ) : null}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 lg:h-8 lg:w-8"
              aria-label={t("Trocar contato")}
              onClick={() => {
                setContato(null);
                testar.reset();
              }}
            >
              <X />
            </Button>
          </div>
        ) : (
          <>
            <Input
              id="testar-contato"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={t("Buscar contato por nome ou telefone")}
              className="min-h-11 lg:min-h-9"
            />
            {busca.trim().length >= 2 ? (
              <ul className="divide-y divide-border rounded-md border border-border" aria-busy={isFetching}>
                {(achados?.data ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-text hover:bg-hover lg:min-h-9"
                      onClick={() => setContato(c)}
                    >
                      <span className="truncate">{c.name || c.phone_number || t("Sem nome")}</span>
                      {c.phone_number && c.name ? <span className="text-text-muted">{c.phone_number}</span> : null}
                    </button>
                  </li>
                ))}
                {!isFetching && (achados?.data ?? []).length === 0 ? (
                  <li className="px-3 py-2 text-sm text-text-muted">{t("Nenhum contato encontrado.")}</li>
                ) : null}
              </ul>
            ) : null}
          </>
        )}
      </div>

      {pedeTexto ? (
        <div className="space-y-1">
          <Label htmlFor="testar-texto">{t("Mensagem de exemplo")}</Label>
          <Textarea
            id="testar-texto"
            rows={2}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t("Ex.: Qual o preço?")}
          />
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        className="min-h-11 w-full sm:w-auto lg:min-h-9"
        disabled={!contato || testar.isPending}
        onClick={() => testar.mutate()}
      >
        <Play /> {testar.isPending ? t("Testando…") : t("Testar")}
      </Button>

      {resultado ? <ResultadoDoTeste resultado={resultado} /> : null}
    </section>
  );
}

function ResultadoDoTeste({ resultado }: { resultado: ResultadoDaSimulacao }) {
  const t = useT();
  return (
    <div className="space-y-3 border-t border-border pt-3" aria-live="polite">
      <p className={cn("text-sm font-semibold", resultado.rodaria ? "text-success-fg" : "text-text")}>
        {resultado.rodaria ? t("A automação rodaria para este contato.") : t("A automação não rodaria para este contato.")}
      </p>
      <ul className="space-y-1 text-sm text-text">
        <li>
          {t(GATILHO[resultado.gatilho.situacao])}
          {resultado.gatilho.palavra ? <strong className="font-semibold"> “{resultado.gatilho.palavra}”</strong> : null}
        </li>
        <li>{t(CONDICOES[resultado.condicoes.situacao])}</li>
        {resultado.condicoes.usam_dados_do_evento ? (
          <li className="text-text-muted">
            {t("Algumas condições dependem do evento real (como a etapa de destino) e contam como não atendidas no teste.")}
          </li>
        ) : null}
        {resultado.alvo.negocio ? (
          <li className="text-text-muted">
            {t("Negócio usado no teste")}: {resultado.alvo.negocio.title || t("Sem título")}
          </li>
        ) : null}
      </ul>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{t("O que cada ação faria")}</p>
        <ol className="space-y-2">
          {resultado.acoes.map((acao) => {
            const Icone = acao.aviso ? Warning : CheckCircle;
            return (
              <li key={acao.indice} className="flex items-start gap-2 text-sm">
                <Icone
                  size={18}
                  aria-hidden
                  className={cn("mt-0.5 shrink-0", acao.aviso ? "text-warning-fg" : "text-success-fg")}
                />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-text">
                    {acao.indice + 1}. {t(ACTION_LABELS[acao.type as ActionType] ?? acao.type)}
                  </p>
                  {acao.aviso ? <p className="text-text-muted">{t(AVISO[acao.aviso])}</p> : null}
                  {acao.previa ? (
                    <p className="whitespace-pre-wrap break-words rounded-md bg-surface-elevated px-2 py-1 text-text-muted">
                      {acao.previa}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {!resultado.rodaria ? (
        <p className="flex items-center gap-1 text-xs text-text-muted">
          <XCircle size={14} aria-hidden /> {t("Como a automação não rodaria, nenhuma dessas ações sairia agora.")}
        </p>
      ) : null}
    </div>
  );
}
