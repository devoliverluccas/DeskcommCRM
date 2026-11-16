"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import { finishOnboarding } from "@/app/actions/onboarding/finishOnboarding";
import type { ItemDoResumo } from "@/lib/onboarding/passos";
import type { PecaDoSistema } from "@/lib/onboarding/o-que-mais-existe";
import { ArrowRight, Check } from "@/lib/ui/icons";
import { cn } from "@/lib/utils";
import { CabecalhoDoPasso } from "../_components/Passo";

export interface KitNoResumo {
  rotulo: string;
  etiquetas: number;
  respostas: number;
  tiposDeAgendamento: number;
  automacoes: number;
}

export function DoneClient({
  itens,
  pecas,
  noAr,
  kit = null,
}: {
  itens: ItemDoResumo[];
  pecas: PecaDoSistema[];
  /**
   * O recibo do segmento escolhido no primeiro passo: o que foi criado além do
   * quadro. `null` quando não houve segmento — e aí a seção nem aparece.
   */
  kit?: KitNoResumo | null;
  /**
   * Existe ao menos um agente PUBLICADO nesta organização (não-arquivado, com
   * `published_version_id`)? É a página que lê o banco e passa — este componente
   * é cliente e não tem como perguntar sem um fetch que faria a tela piscar.
   */
  noAr: boolean;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const pendentes = itens.filter((i) => !i.feito);
  /**
   * O passo da IA ficou de fora (pulado ou nunca feito)? Sem ele não há
   * atendente treinado, e a frase antiga dizia "já está de pé" do mesmo jeito.
   */
  const semIa = itens.some((i) => i.segmento === "setup-ai" && !i.feito);

  /**
   * A CONCORDÂNCIA COM A REALIDADE.
   *
   * O fim do wizard era uma frase fixa: "Tudo pronto! Seu funcionário já está
   * de pé" — dita também para quem pulou o passo da IA e para quem ficou com o
   * atendente em rascunho. O wizard prometia o que não tinha entregue, e a
   * pessoa só descobria isso no primeiro cliente que ninguém respondeu.
   *
   * O que decide é o BANCO (`noAr`), não a contagem de pendências: publicar é
   * o que coloca o atendente no ar, e pular um passo que não depende da IA
   * (telefone, equipe) não tira ninguém do ar.
   */
  const titulo = noAr ? t("Tudo pronto!") : t("Quase lá!");
  const resumo = !noAr
    ? semIa
      ? t("O passo da IA ficou para depois: ele ainda não foi treinado nem colocado no ar.")
      : t("Ele já foi treinado, mas o atendimento ainda não foi publicado — ele segue em rascunho.")
    : pendentes.length === 0
      ? t("Seu funcionário está montado. Daqui em diante é só acompanhar.")
      : t("Seu funcionário já está de pé. O que ficou para depois continua te esperando.");

  return (
    <div>
      <CabecalhoDoPasso titulo={titulo} subtitulo={resumo} />

      <section className="border-t border-border py-8">
        <ul className="divide-y divide-border rounded-lg border border-border">
          {itens.map((it) => (
            <li key={it.segmento} className="flex min-h-11 items-center gap-3 px-4 py-3 text-sm">
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  it.feito ? "bg-success-bg text-success-fg" : "border border-border-strong",
                )}
              >
                {it.feito ? <Check size={12} weight="bold" /> : null}
              </span>
              <span className={cn("min-w-0 flex-1", it.feito ? "text-text" : "text-text-muted")}>
                {t(it.rotulo)}
              </span>
              {/*
                "Pulado" é escolha da pessoa; "ainda não" é o que ela não
                chegou a fazer. Antes tudo que não estivesse feito virava
                "(pulado)", inclusive passo que a instalação nunca ofereceu —
                o wizard cobrando o que ninguém pediu.
              */}
              {it.feito ? null : (
                <span className="shrink-0 rounded-sm bg-pressed px-1.5 py-0.5 text-[11px] text-text-muted">
                  {it.pulado ? t("você pulou") : t("ainda não")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {kit ? (
        <section className="border-t border-border py-8" data-testid="kit-do-segmento">
          <h3 className="text-sm font-semibold text-text">
            {t("O que já deixei pronto para o seu segmento:")} {t(kit.rotulo)}
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-text-muted">
            {kit.etiquetas > 0 ? (
              <li>
                <strong className="font-medium text-text tabular-nums">{kit.etiquetas}</strong>{" "}
                {t("etiquetas, em Configurações › Tags.")}
              </li>
            ) : null}
            {kit.respostas > 0 ? (
              <li>
                <strong className="font-medium text-text tabular-nums">{kit.respostas}</strong>{" "}
                {t("respostas rápidas, em Atendimento › Respostas rápidas.")}
              </li>
            ) : null}
            {kit.tiposDeAgendamento > 0 ? (
              <li>
                <strong className="font-medium text-text tabular-nums">{kit.tiposDeAgendamento}</strong>{" "}
                {t("tipos de agendamento, em Configurações › Tipos de agendamento.")}
              </li>
            ) : null}
            {kit.automacoes > 0 ? (
              <li>
                <strong className="font-medium text-text tabular-nums">{kit.automacoes}</strong>{" "}
                {t("automações, em Canais › Webhooks, na aba Automações. Elas nascem desligadas: leia e ligue as que fizerem sentido.")}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {/*
        A ação vem ANTES do "O que mais tem aqui": é o fim do wizard, e quem
        chegou aqui quer entrar. O resto é leitura opcional, logo abaixo.
      */}
      <div className="flex flex-col border-t border-border py-8 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
        <Button
          type="button"
          size="lg"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await finishOnboarding();
              if (res && !res.ok) toast.error(`${t("Falha:")} ${res.error}`);
            })
          }
        >
          {pending ? t("Finalizando...") : t("Começar a usar")}
          {pending ? null : <ArrowRight aria-hidden weight="bold" />}
        </Button>
      </div>

      {/*
        O wizard acabava aqui, com um botão que entregava a pessoa numa caixa de
        conversas vazia. Ela tinha acabado de montar um funcionário e não fazia
        ideia de que existe um lugar onde ele pede ajuda, outro que mostra quem
        esfriou, outro onde ele propõe as próprias melhorias. Descobrir isso
        ficava por conta da curiosidade — e quase ninguém volta para explorar
        menu.
      */}
      <section className="space-y-4 border-t border-border pt-8">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text">{t("O que mais tem aqui")}</h3>
          <p className="text-xs text-text-muted">
            {t("Você não precisa mexer em nada disso agora. É só para saber que existe.")}
          </p>
        </div>
        {/*
          Cada peça abre e mostra COMO funciona, em passos. Uma frase basta para
          dizer que a peça existe; não basta para o follow-up, que é a peça mais
          técnica do produto e a que mais assusta pelo nome — quem lê "volta a
          falar com quem sumiu" sem saber que o retorno PARA quando o cliente
          responde imagina um robô perseguindo cliente, e desliga justamente o
          que mais recupera venda.

          Fechado por padrão: quem acabou de montar o funcionário não precisa ler
          seis tutoriais agora. O que ele precisa é saber que a explicação existe
          e está a um clique.
        */}
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {pecas.map((p) => (
            <li key={p.href} className="border-t border-border py-4">
              <a href={p.href} className="text-sm font-medium text-text underline-offset-2 hover:underline">
                {t(p.comoChamar)}
              </a>
              <span className="ml-1 text-xs text-text-subtle">({t(p.label)})</span>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">{t(p.porQue)}</p>

              <details className="group mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs text-text-muted underline underline-offset-2 hover:text-text lg:min-h-0">
                  {t("Como funciona")}
                </summary>
                <ol className="mt-2 space-y-1.5">
                  {p.comoFunciona.map((passo, i) => (
                    <li key={passo} className="flex gap-2 text-xs text-text-muted">
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px]"
                      >
                        {i + 1}
                      </span>
                      <span>{t(passo)}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
