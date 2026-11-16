"use client";

import { useEffect, useState, useTransition } from "react";

import { cartaoDeEscolha } from "@/app/onboarding/_components/Passo";
import { SEGMENTOS } from "@/lib/onboarding/segmentos";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

import { acceptWelcome } from "@/app/actions/onboarding/acceptWelcome";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FUSO_PADRAO, FUSOS_DO_ONBOARDING } from "@/lib/tempo/fusos";
import { fusoDoNavegador } from "@/lib/tempo/fuso-do-navegador";
import { RodapeDoPasso } from "../_components/Passo";

export function WelcomeForm({ defaultOrgName, orgId }: { defaultOrgName: string; orgId: string }) {
  const t = useT();
  const [displayName, setDisplayName] = useState(defaultOrgName);
  const [oQueFaz, setOQueFaz] = useState("");
  const [segmento, setSegmento] = useState("");
  const [timezone, setTimezone] = useState(FUSO_PADRAO);

  // O fuso do NAVEGADOR (se for um oferecido) vem marcado no lugar de São
  // Paulo: é o mesmo com que a empresa nasceu (`lib/auth/perfil-da-empresa-nova.ts`),
  // e este passo regrava o fuso da empresa com o que estiver marcado. Num
  // efeito, e não no estado inicial, porque o servidor não sabe o fuso do
  // navegador — e a hidratação divergiria.
  useEffect(() => {
    const doNavegador = fusoDoNavegador();
    // Uma leitura só, depois da hidratação, de um valor que só o navegador
    // tem: não há prop nem estado anterior de onde derivar no render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (doNavegador && FUSOS_DO_ONBOARDING.some((f) => f.id === doNavegador))
      setTimezone(doNavegador);
  }, []);
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-6 border-t border-border pt-8"
      action={(formData) => {
        if (!accepted) {
          toast.error(t("Aceite os termos para continuar."));
          return;
        }
        startTransition(async () => {
          const res = await acceptWelcome(formData);
          if (res && !res.ok) {
            toast.error(
              res.error === "organization_changed"
                ? t("A empresa ativa mudou. Recarregue a página antes de continuar.")
                : `Falha: ${res.error}`,
            );
          }
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="display_name">{t("Como se chama o seu negócio?")}</Label>
        <Input
          id="display_name"
          name="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          minLength={2}
          maxLength={120}
          required
        />
        <p className="text-xs text-text-muted">
          {t(
            "É o nome que aparece para o seu time e nos relatórios. Pode ser clínica, loja, escritório — o que for seu.",
          )}
        </p>
      </div>

      {/*
        A pergunta que faltava no produto inteiro. Sem ela, o funcionário nasce
        se apresentando como atendente de uma "loja online" — era o que os três
        modelos de prompt diziam — e o quadro de clientes nasce com as colunas
        de e-commerce que o gatilho semeia. Os dois defeitos têm a mesma origem:
        uma instalação que nunca pergunta em que ramo entrou.
      */}
      {/*
        O SEGMENTO. Escolher aqui traz, além do quadro de clientes, etiquetas,
        respostas rápidas, tipos de agendamento e automações do ramo
        (`lib/onboarding/segmentos.ts`). É opcional de propósito — "Outro" é uma
        resposta, e quem a dá segue pelo texto livre logo abaixo, como sempre.

        Rádio NATIVO dentro do cartão, como as formas de conexão do passo
        seguinte: o cartão é só o desenho, e o controle é o que o teclado e o
        leitor de tela já conhecem.
      */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">{t("Qual é o seu segmento?")}</legend>
        <p className="text-xs text-text-muted">
          {t(
            "Com isso o sistema já nasce com quadro, etiquetas, respostas rápidas e automações do seu ramo. Dá para mudar tudo depois.",
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SEGMENTOS.map((s) => (
            <label key={s.id} data-testid={`segmento-${s.id}`} className={cartaoDeEscolha(segmento === s.id)}>
              <input
                type="radio"
                name="segmento"
                value={s.id}
                checked={segmento === s.id}
                onChange={() => setSegmento(s.id)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text">{t(s.rotulo)}</span>
                <span className="block text-xs text-text-muted">{t(s.descricao)}</span>
              </span>
            </label>
          ))}
          <label data-testid="segmento-outro" className={cartaoDeEscolha(segmento === "")}>
            <input
              type="radio"
              name="segmento"
              value=""
              checked={segmento === ""}
              onChange={() => setSegmento("")}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text">{t("Outro")}</span>
              <span className="block text-xs text-text-muted">
                {t("Conte abaixo o que vocês fazem e o quadro é montado a partir disso.")}
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="o_que_faz">{t("O que vocês fazem?")}</Label>
        <Input
          id="o_que_faz"
          name="o_que_faz"
          value={oQueFaz}
          onChange={(e) => setOQueFaz(e.target.value)}
          maxLength={280}
          placeholder={t("Ex.: clínica odontológica, ou venda de roupa fitness pelo WhatsApp")}
        />
        <p className="text-xs text-text-muted">
          {t(
            "Uma linha basta. É com isso que seu funcionário aprende com quem ele está falando — e que a gente monta o quadro de clientes do seu jeito.",
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="timezone">{t("Onde você atende")}</Label>
        <Select value={timezone} onValueChange={setTimezone}>
          <SelectTrigger id="timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FUSOS_DO_ONBOARDING.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {t(f.cidade)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="timezone" value={timezone} />
        {/* A org para a qual ESTA aba foi aberta. No submit, o server action
            resolve por ela (validada como membership), não pela org ativa do
            momento — que outra aba pode ter trocado. */}
        <input type="hidden" name="organization_id" value={orgId} />
        <p className="text-xs text-text-muted">
          {t("Decide o horário em que seu funcionário pode falar com clientes.")}
        </p>
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-4 text-sm hover:bg-hover">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          required
        />
        <span>
          {t("Li e aceito os")}{" "}
          <a className="text-text underline underline-offset-2" href="/legal/terms" target="_blank" rel="noreferrer">
            {t("Termos de Uso")}
          </a>{" "}
          {t("e a")}{" "}
          <a className="text-text underline underline-offset-2" href="/legal/privacy" target="_blank" rel="noreferrer">
            {t("Política de Privacidade")}
          </a>
          .
        </span>
      </label>

      <RodapeDoPasso>
        <Button type="submit" size="lg" disabled={pending || !accepted}>
          {pending ? t("Salvando...") : t("Continuar")}
        </Button>
      </RodapeDoPasso>
    </form>
  );
}
