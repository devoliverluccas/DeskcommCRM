"use client";
/**
 * SAÚDE DO NÚMERO (item 5.5) — a nota que a Meta dá ao número oficial, o limite
 * de conversas por dia e quando isso foi lido.
 *
 * Hierarquia por peso e espaço, sem cartão próprio: três linhas de rótulo e
 * valor, e o "o que fazer" só aparece quando há o que fazer. A cor fica no
 * ponto e no selo da nota — o resto é texto.
 */
import { Button } from "@/components/ui/button";
import {
  useAtualizarSaudeDoNumeroOficial,
  useSaudeDoNumeroOficial,
  type SaudeDoNumeroOficial as Saude,
} from "@/hooks/channels/useSaudeDoNumeroOficial";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { cn } from "@/lib/utils";

type Qualidade = NonNullable<NonNullable<Saude["saude"]>["qualidade"]>;

const COR: Record<Qualidade, { ponto: string; selo: string }> = {
  GREEN: { ponto: "bg-success", selo: "bg-success-bg text-success-fg" },
  YELLOW: { ponto: "bg-warning", selo: "bg-warning-bg text-warning-fg" },
  RED: { ponto: "bg-error", selo: "bg-error-bg text-error-fg" },
  UNKNOWN: { ponto: "bg-text-subtle", selo: "bg-hover text-text-muted" },
};

export function SaudeDoNumeroOficial() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { data, isPending, isError } = useSaudeDoNumeroOficial();
  const atualizar = useAtualizarSaudeDoNumeroOficial();

  const estado = data?.data;
  if (isPending || isError || !estado?.conectado || !estado.saude) return null;
  const s = estado.saude;
  const qualidade: Qualidade = s.qualidade ?? "UNKNOWN";

  const rotuloDaQualidade =
    qualidade === "GREEN"
      ? t("Alta")
      : qualidade === "YELLOW"
        ? t("Média")
        : qualidade === "RED"
          ? t("Baixa")
          : t("Sem nota");

  const limite = s.sem_limite
    ? t("Sem limite")
    : s.conversas_por_dia !== null
      ? t("{n} conversas por dia").replace("{n}", s.conversas_por_dia.toLocaleString(tag))
      : t("Não informado");

  const quando = s.atualizada_em
    ? new Date(s.atualizada_em).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })
    : null;

  const oQueFazer =
    qualidade === "RED"
      ? t(
          "Muitos clientes estão bloqueando ou denunciando as mensagens. Pause disparos em massa, mande só para quem pediu contato e revise o texto dos modelos. Se a nota seguir baixa, a Meta reduz o limite.",
        )
      : qualidade === "YELLOW"
        ? t(
            "A Meta notou mais bloqueios e denúncias que o normal. Reduza o volume, mande só para quem pediu contato e revise o texto dos modelos antes que a nota caia para baixa.",
          )
        : null;

  return (
    <section
      className="flex flex-col gap-3 border-t border-border pt-4"
      data-testid="saude-do-numero"
      aria-labelledby="saude-do-numero-titulo"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="saude-do-numero-titulo" className="text-sm font-semibold text-text">
          {t("Saúde do número")}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => atualizar.mutate()}
          disabled={atualizar.isPending}
        >
          {atualizar.isPending ? t("Atualizando…") : t("Atualizar agora")}
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-text-muted">{t("Qualidade")}</dt>
        <dd className="flex items-center gap-2">
          <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", COR[qualidade].ponto)} />
          <span
            className={cn("rounded-sm px-1.5 py-0.5 text-xs font-medium", COR[qualidade].selo)}
            data-testid="saude-qualidade"
            data-qualidade={qualidade}
          >
            {rotuloDaQualidade}
          </span>
        </dd>

        <dt className="text-text-muted">{t("Limite de conversas")}</dt>
        <dd className="tabular-nums text-text" data-testid="saude-limite">
          {limite}
        </dd>

        <dt className="text-text-muted">{t("Última leitura")}</dt>
        <dd className="text-text">{quando ?? t("Ainda não lida")}</dd>
      </dl>

      {oQueFazer ? (
        <p className="text-sm text-text" data-testid="saude-o-que-fazer">
          <span className="font-medium">{t("O que fazer:")}</span> {oQueFazer}
        </p>
      ) : null}

      {s.evento_da_conta && s.evento_da_conta !== "VERIFIED_ACCOUNT" ? (
        <p className="text-sm text-text-muted" data-testid="saude-evento-da-conta">
          {t("Último aviso da Meta sobre a conta:")}{" "}
          <span className="font-mono text-xs text-text">{s.evento_da_conta}</span>
          {". "}
          {t("Veja o motivo no Gerenciador do WhatsApp, na Meta.")}
        </p>
      ) : null}

      {estado.leitura?.erro ? (
        <p className="text-xs text-text-subtle">
          {t("Não foi possível perguntar à Meta agora; mostrando a última leitura guardada.")}
        </p>
      ) : null}
    </section>
  );
}
