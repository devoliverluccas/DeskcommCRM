"use client";
/**
 * "Pronta para ativar?" (fase 4, 4.1) — o checklist do editor de automações.
 *
 * A regra mora em `lib/automation/prontidao-da-regra.ts` (pura); aqui só se
 * entrega o formulário e a lista de canais, e se desenha o resultado. Lista sem
 * cartão em volta: um marcador por item, o texto diz o que falta.
 */
import { useT } from "@/hooks/i18n/useT";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { CheckCircle, Info, Warning } from "@/lib/ui/icons";
import { prontidaoDaRegra, type ChaveDoItem, type SituacaoDoItem } from "@/lib/automation/prontidao-da-regra";
import { cn } from "@/lib/utils";

const TEXTO_DO_ITEM: Record<ChaveDoItem, string> = {
  gatilho: "Gatilho configurado",
  acao: "Ao menos uma ação",
  acoes_validas: "Ações com todos os campos preenchidos",
  canal_ativo: "Número de WhatsApp conectado nas ações que enviam mensagem",
};

const SITUACAO: Record<SituacaoDoItem, string> = {
  ok: "Ok",
  falta: "Falta",
  nao_se_aplica: "Não se aplica",
};

export function ProntaParaAtivar({
  evento,
  triggerConfig,
  acoes,
}: {
  evento: string;
  triggerConfig: unknown;
  acoes: ReadonlyArray<{ type: string; config?: unknown }>;
}) {
  const t = useT();
  const { data: canais } = useChannelSessions();
  const { itens, pronta } = prontidaoDaRegra({ evento, triggerConfig, acoes, canais });

  return (
    <section aria-labelledby="pronta-para-ativar" className="space-y-2">
      <h3 id="pronta-para-ativar" className="text-base font-semibold text-text">
        {t("Pronta para ativar?")}
      </h3>
      <ul className="space-y-1.5">
        {itens.map((item) => {
          const Icone = item.situacao === "ok" ? CheckCircle : item.situacao === "falta" ? Warning : Info;
          return (
            <li key={item.chave} className="flex items-start gap-2 text-sm">
              <Icone
                size={18}
                aria-hidden
                className={cn(
                  "mt-0.5 shrink-0",
                  item.situacao === "ok" && "text-success-fg",
                  item.situacao === "falta" && "text-warning-fg",
                  item.situacao === "nao_se_aplica" && "text-text-subtle",
                )}
              />
              <span className={cn(item.situacao === "nao_se_aplica" ? "text-text-muted" : "text-text")}>
                {t(TEXTO_DO_ITEM[item.chave])}
                <span className="sr-only">: {t(SITUACAO[item.situacao])}</span>
                {item.acoes?.length ? (
                  <span className="text-text-muted">
                    {" "}
                    ({t("ação")} {item.acoes.map((i) => i + 1).join(", ")})
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={cn("text-sm", pronta ? "text-success-fg" : "text-text-muted")}>
        {pronta
          ? t("Tudo certo: pode ligar a automação.")
          : t("Resolva os itens marcados antes de ligar — do jeito que está, a automação não faria nada.")}
      </p>
    </section>
  );
}
