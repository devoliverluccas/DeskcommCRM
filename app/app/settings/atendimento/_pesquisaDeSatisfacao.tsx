"use client";

/**
 * A PORTA DA PESQUISA DE SATISFAÇÃO (#4023): ligar, escolher a régua e ver o
 * resultado.
 *
 * Salva no clique, como as outras opções desta tela. Ligar e trocar a régua é
 * de quem administra (o PATCH de `/api/v1/settings/atendimento` cobra `admin`);
 * ver o resultado é de quem gerencia, que é o piso da própria tela.
 *
 * O resultado chega pronto do servidor (`page.tsx`), lido pela mesma função da
 * rota de métricas, e é desenhado pelo MESMO componente da aba de Relatórios
 * (`ResultadoDaSatisfacao`): a tela não pode mostrar uma conta que a outra não faz.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import type { EscalaDaSatisfacao, ResumoDaSatisfacao } from "@/lib/atendimento/satisfacao-nps";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import { ResultadoDaSatisfacao } from "@/app/app/relatorios/_components/ResultadoDaSatisfacao";

export function PesquisaDeSatisfacao({
  ligada,
  janelaHoras,
  escala,
  resumo,
  idioma,
  podeMudar,
}: {
  ligada: boolean;
  janelaHoras: number;
  /** A régua em vigor (3.4). Ausente = a de sempre, de 1 a 5. */
  escala?: EscalaDaSatisfacao;
  /** `null` quando a leitura falhou: a tela diz isso em vez de mostrar zero. */
  resumo: ResumoDaSatisfacao | null;
  idioma: Idioma;
  /** Espelha o `admin` que a rota cobra. Cortesia, não autorização. */
  podeMudar: boolean;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [valor, setValor] = useState(ligada);
  const [regua, setRegua] = useState<EscalaDaSatisfacao>(escala ?? "csat_1_5");
  const [isPending, startTransition] = useTransition();

  function salvar(proximo: { ligado: boolean; escala: EscalaDaSatisfacao }, desfazer: () => void) {
    startTransition(async () => {
      try {
        await apiClient.patch("/api/v1/settings/atendimento", proximo);
        toast.success(t("Opção salva."));
        router.refresh();
      } catch (err) {
        desfazer();
        toast.error(err instanceof Error ? t(err.message) : t("Não consegui salvar agora."));
      }
    });
  }

  function mudar(novo: boolean) {
    setValor(novo);
    salvar({ ligado: novo, escala: regua }, () => setValor(!novo));
  }

  function mudarRegua(nova: EscalaDaSatisfacao) {
    if (nova === regua) return;
    const anterior = regua;
    setRegua(nova);
    salvar({ ligado: valor, escala: nova }, () => setRegua(anterior));
  }

  const opcoes: Array<{ id: EscalaDaSatisfacao; rotulo: string }> = [
    { id: "csat_1_5", rotulo: t("De 1 a 5 (satisfação)") },
    { id: "nps_0_10", rotulo: t("De 0 a 10 (NPS)") },
  ];

  return (
    <Card className="p-6" data-testid="pesquisa-de-satisfacao">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="pesquisa_de_satisfacao">{t("Pesquisa de satisfação ao encerrar")}</Label>
          <p className="max-w-2xl text-xs text-text-muted">
            {t(
              "Ligada, quem tem o atendimento encerrado recebe uma pergunta: de 1 a 5, como avalia o atendimento. A resposta vira nota só se vier logo em seguida: se a equipe ou a IA voltar a falar com o cliente, um número que ele mande é conversa normal. Não sai para contato bloqueado ou pessoal, nem fora do horário de envio do número.",
            )}
          </p>
          <p className="max-w-2xl text-xs" data-testid="pesquisa-de-satisfacao-estado">
            {valor
              ? t("Ligada: a pergunta sai ao encerrar o atendimento.")
              : t("Desligada: nenhuma pergunta sai ao encerrar.")}
          </p>
          {!podeMudar && (
            <p className="text-xs text-text-muted">
              {t("Só um administrador da organização pode mudar esta opção.")}
            </p>
          )}
        </div>
        <Switch
          id="pesquisa_de_satisfacao"
          checked={valor}
          disabled={isPending || !podeMudar}
          onCheckedChange={mudar}
        />
      </div>

      <fieldset className="mt-5 flex flex-col gap-2" data-testid="pesquisa-de-satisfacao-escala">
        <legend className="text-xs font-medium">{t("Escala da pergunta")}</legend>
        <div role="radiogroup" aria-label={t("Escala da pergunta")} className="flex flex-wrap gap-2">
          {opcoes.map((o) => {
            const ativa = regua === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={ativa}
                disabled={isPending || !podeMudar}
                onClick={() => mudarRegua(o.id)}
                className={`inline-flex h-11 items-center rounded-md border px-3 text-sm transition-colors duration-fast disabled:opacity-60 lg:h-8 ${
                  ativa
                    ? "border-accent bg-pressed font-medium"
                    : "border-border text-text-muted hover:bg-hover"
                }`}
              >
                {o.rotulo}
              </button>
            );
          })}
        </div>
        <p className="max-w-2xl text-xs text-text-muted">
          {t(
            "No NPS a pergunta é de 0 a 10 e o resultado é % de promotores (9–10) menos % de detratores (0–6). Trocar a escala vale para as próximas perguntas; quem já foi perguntado responde na escala em que recebeu.",
          )}
        </p>
      </fieldset>

      <div className="mt-6 border-t border-border pt-4" data-testid="pesquisa-de-satisfacao-resultado">
        <h3 className="mb-3 text-sm font-semibold">{t("Resultado dos últimos 30 dias")}</h3>
        {resumo === null ? (
          <p className="text-xs text-text-muted">{t("Não foi possível calcular a satisfação.")}</p>
        ) : (
          <>
            <ResultadoDaSatisfacao
              resumo={resumo}
              escala={regua}
              testIdDaMedia="pesquisa-de-satisfacao-media"
            />
            <p className="mt-3 text-xs text-text-muted">
              {t(
                "Quem não respondeu conta em \"Sem resposta\", nunca como nota baixa. A média usa só as respostas.",
              )}{" "}
              {resumo.aguardando > 0 ? t("Há perguntas ainda esperando resposta.") : null}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {t("Prazo para o cliente responder:")} {janelaHoras} h
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
