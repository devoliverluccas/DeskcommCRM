"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createDefaultAgent, skipAi } from "@/app/actions/onboarding/createDefaultAgent";
import type { PromptTemplate } from "@/lib/schemas/onboarding";
import { PROVEDOR_POR_ID } from "@/lib/ai/pontos/provedores";
import { Check, X } from "@/lib/ui/icons";
import { AvisoDoPasso, RodapeDoPasso, cartaoDeEscolha } from "../_components/Passo";

/**
 * O jeito de falar, não o "estilo de prompt".
 *
 * Os rótulos anteriores eram "Amigável (e-commerce)", "Profissional" e "Suporte
 * minimalista" — dois deles amarrados a loja virtual, num produto cuja maioria
 * de adopters roda em clínica, imobiliária e infoproduto. Os identificadores
 * continuam os mesmos porque já existem gravados; só a fala mudou.
 */
/** "openrouter" no meio de uma frase é identificador vazando para a tela. */
function provedorLegivel(id: string | null, t: (texto: string) => string): string {
  if (!id) return t("da inteligência escolhida na instalação");
  return `${t("da")} ${PROVEDOR_POR_ID.get(id)?.rotulo ?? id}`;
}

const JEITOS: { id: PromptTemplate; titulo: string; desc: string }[] = [
  {
    id: "ecommerce_friendly",
    titulo: "Próximo e caloroso",
    desc: "Conversa como gente, puxa assunto, tranquiliza. Bom para quem vende no dia a dia.",
  },
  {
    id: "ecommerce_professional",
    titulo: "Objetivo e cordial",
    desc: "Vai direto ao ponto sem ser seco, e sempre indica o próximo passo.",
  },
  {
    id: "support_minimal",
    titulo: "Curto e prático",
    desc: "Frases curtas, pergunta só o essencial e chama uma pessoa cedo.",
  },
];

interface Props {
  /** O que ele já sabe fazer, em linguagem de dono de negócio. */
  capacidades: string[];
  /** O que ele nunca faz — as conferências antes de cada mensagem sair. */
  conferencias: string[];
  /**
   * As regras do SEGMENTO escolhido no primeiro passo, já no campo — a pessoa
   * lê, edita e só então elas viram memória do funcionário. Vazio quando não
   * houve segmento.
   */
  regrasIniciais?: string;
}

export function SetupAiForm({ capacidades, conferencias, regrasIniciais = "" }: Props) {
  const t = useT();
  const [name, setName] = useState("Atendente IA");
  const [jeito, setJeito] = useState<PromptTemplate>("ecommerce_friendly");
  const [regras, setRegras] = useState(regrasIniciais);
  const [naoPublicado, setNaoPublicado] = useState<string | null>(null);
  const [causa, setCausa] = useState<"canal" | "modelo" | "chave" | null>(null);
  const [provedor, setProvedor] = useState<string | null>(null);
  // Provedor cuja chave a pessoa JÁ colou e que o provedor ainda não confirmou.
  const [chaveEmVerificacao, setChaveEmVerificacao] = useState<string | null>(null);
  const [motivoDoModelo, setMotivoDoModelo] = useState<
    "catalogo_vazio" | "nenhum_com_ferramentas" | null
  >(null);
  const [regrasNaoSalvas, setRegrasNaoSalvas] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-8"
      action={(formData) => {
        startTransition(async () => {
          setNaoPublicado(null);
          setCausa(null);
          setProvedor(null);
          setChaveEmVerificacao(null);
          setMotivoDoModelo(null);
          setRegrasNaoSalvas(null);
          const res = await createDefaultAgent(formData);
          if (res && !res.ok) {
            toast.error(`${t("Falha ao criar agente:")} ${res.error}`);
            return;
          }
          if (res?.regras_nao_salvas) setRegrasNaoSalvas(res.regras_nao_salvas);
          // Sem chave utilizável não há o que publicar — e o conselho é outro:
          // não é esperar o catálogo nem trocar de provedor, é cadastrar a chave.
          if (res?.publish_blocked_by === "chave") {
            setCausa("chave");
            setProvedor(res.provider ?? null);
            // A chave colada (e ainda não confirmada) tem provedor PRÓPRIO: sem
            // isto a tela pediria de novo uma chave que a pessoa já colou.
            setChaveEmVerificacao(res.chave_em_verificacao ?? null);
            toast.warning(t("Atendente criado, mas ainda não está no ar."));
            return;
          }
          if (res?.publish_blocked_by === "modelo") {
            setCausa("modelo");
            setProvedor(res.provider ?? null);
            setMotivoDoModelo(res.motivo_do_modelo ?? null);
            toast.warning(t("Atendente criado, mas ainda não está no ar."));
            return;
          }
          if (res?.publish_error) {
            setNaoPublicado(res.publish_error);
            setCausa("canal");
            toast.warning(t("Agente criado, mas ainda não publicado."));
          }
        });
      }}
    >
      <div className="space-y-6 border-t border-border pt-8">
        <div className="space-y-2">
          <Label htmlFor="name">{t("Como ele vai se chamar")}</Label>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
          <p className="text-xs text-text-muted">
            {t("É o nome que aparece para o seu time. O cliente vê só a conversa.")}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="pb-2 text-sm font-medium text-text">{t("O jeito dele falar")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {JEITOS.map((j) => (
              <label
                key={j.id}
                className={cartaoDeEscolha(jeito === j.id)}
              >
                <input
                  type="radio"
                  name="prompt_template"
                  value={j.id}
                  checked={jeito === j.id}
                  onChange={() => setJeito(j.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                />
                <span>
                  <span className="block text-sm font-medium text-text">{t(j.titulo)}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-text-muted">{t(j.desc)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="regras_da_casa">{t("As regras da casa (opcional)")}</Label>
          <Textarea
            id="regras_da_casa"
            name="regras_da_casa"
            value={regras}
            onChange={(e) => setRegras(e.target.value)}
            rows={5}
            maxLength={20000}
            placeholder={
              `${t("Nunca prometa desconto sem confirmar com uma pessoa.")}\n` +
              `${t("Horário de atendimento: 9h às 18h, de segunda a sexta.")}\n` +
              t("Sempre chame o cliente pelo primeiro nome.")
            }
          />
          <p className="text-xs text-text-muted">
            {t(
              "O que vale para qualquer atendimento aqui. Pode deixar em branco agora e escrever depois — ele aprende com você ao longo do tempo.",
            )}
          </p>
        </div>
      </div>

      {/*
        Nada aqui pede configuração: é o que ele JÁ vem sabendo. O passo
        anterior entregava um funcionário sem dizer uma linha sobre o que ele
        é capaz de fazer — e a primeira pergunta de quem contrata alguém é
        exatamente essa.
      */}
      <div className="grid gap-8 border-t border-border pt-8 sm:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text">{t("Ele já vem sabendo")}</h3>
          <ul className="space-y-2 text-sm text-text-muted">
            {capacidades.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <Check size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-success-fg" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text">{t("E nunca vai fazer")}</h3>
          <ul className="space-y-2 text-sm text-text-muted">
            {conferencias.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <X size={14} weight="bold" aria-hidden className="mt-0.5 shrink-0 text-error" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-subtle">
            {t("Essas conferências acontecem antes de cada mensagem sair, e não têm interruptor.")}
          </p>
        </section>
      </div>

      {regrasNaoSalvas && (
        <AvisoDoPasso tom="aviso" role="alert" className="space-y-3">
          <p className="text-sm font-medium">
            {t("O atendente foi criado, mas as")} <strong>{t("regras da casa")}</strong>{" "}
            {t("não foram gravadas. Copie o que você escreveu antes de sair — e salve de novo em")}{" "}
            <strong>{t("IA › Memória")}</strong>.
          </p>
          <p className="text-xs">
            {t("Erro do banco de dados:")} <code className="break-all">{regrasNaoSalvas}</code>
          </p>
        </AvisoDoPasso>
      )}

      {causa === "chave" && (
        <AvisoDoPasso tom="aviso" role="alert" className="space-y-3">
          <p className="text-sm font-medium">
            {t("Seu atendente foi criado, mas ficou como")} <strong>{t("rascunho")}</strong>{" "}
            {t("— ele ainda não tem com o que pensar.")}
          </p>
          {chaveEmVerificacao ? (
            // A chave EXISTE, está gravada, e o que falta é o provedor confirmar.
            // Dizer "não achei chave" aqui é falso — e manda a pessoa colar de
            // novo o que ela acabou de colar (#1007).
            <p className="text-sm">
              {t("A chave que você colou ainda não foi confirmada pelo provedor.")}{" "}
              {t("Assim que ela for confirmada, publique de novo — não precisa colar outra.")}
            </p>
          ) : (
            <p className="text-sm">
              {t("Não achei chave")} {provedorLegivel(provedor, t)}{" "}
              {t("nem cadastrada aqui, nem vinda da instalação. Cole a chave no campo acima («o cérebro dele») e crie o atendente de novo — ou cadastre em")}{" "}
              <strong>{t("IA › Credenciais")}</strong>.
            </p>
          )}
          {/*
            ⚠️ SEM ESTA SAÍDA O PASSO É UM BECO. O aviso irmão (o de modelo) já
            oferecia seguir, e este nasceu sem — quem instala sem chave nenhuma
            (o caminho que o CI exercita) ficava preso na tela de treinar, com um
            diagnóstico correto e nenhum botão. O atendente EXISTE como rascunho;
            o que falta é o cérebro, e isso se resolve depois sem travar o resto
            do wizard.
          */}
          <div className="flex sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = "/onboarding";
              }}
              className="w-full sm:w-auto"
            >
              {t("Continuar sem publicar")}
            </Button>
          </div>
        </AvisoDoPasso>
      )}

      {causa === "modelo" && (
        <AvisoDoPasso tom="aviso" role="alert" className="space-y-3">
          <p className="text-sm font-medium">
            {t("Seu atendente foi criado, mas ficou como")} <strong>{t("rascunho")}</strong>{" "}
            {t("— e rascunho não responde mensagem.")}
          </p>
          {/*
            As duas causas pedem conselhos OPOSTOS, e dar o errado custa caro:
            mandar esperar a sincronização diária quem já tem o catálogo
            completo é mandar esperar para sempre. Foi o que a tela fazia, e só
            apareceu percorrendo o wizard num ambiente com 400 modelos baixados.
          */}
          {motivoDoModelo === "nenhum_com_ferramentas" ? (
            <p className="text-sm">
              {t("Os modelos")} {provedorLegivel(provedor, t)}{" "}
              {t(
                "que esta instalação conhece não sabem usar ferramentas — sem isso ele conversaria bem e nunca criaria um cliente nem moveria um negócio no funil. Escolha outra empresa de IA em",
              )}{" "}
              <strong>{t("IA › Provedores")}</strong>.
            </p>
          ) : (
            <p className="text-sm">
              {t("Esta instalação ainda não tem a lista de modelos")} {provedorLegivel(provedor, t)}.{" "}
              {t("Ela é baixada automaticamente uma vez por dia; depois disso, publique em")}{" "}
              <strong>{t("IA › Agentes")}</strong>.
            </p>
          )}
          <div className="flex sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = "/onboarding";
              }}
              className="w-full sm:w-auto"
            >
              {t("Continuar sem publicar")}
            </Button>
          </div>
        </AvisoDoPasso>
      )}

      {naoPublicado && (
        <AvisoDoPasso tom="aviso" role="alert" className="space-y-3">
          <p className="text-sm font-medium">
            {t("Seu agente foi criado, mas ficou como")} <strong>{t("rascunho")}</strong>:{" "}
            {t(
              "não consegui ler os números de WhatsApp desta instalação, então não dá pra dizer em qual número ele atenderia — e rascunho não responde mensagem.",
            )}
          </p>
          <p className="text-xs">
            {t("Erro do banco de dados:")} <code className="break-all">{naoPublicado}</code>
          </p>
          <p className="text-sm">
            {t("Tente de novo no botão abaixo (clicar de novo não cria um segundo agente) ou siga agora e publique depois em")}{" "}
            <strong>{t("IA › Agentes")}</strong>.
          </p>
          <div className="flex sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = "/onboarding";
              }}
              className="w-full sm:w-auto"
            >
              {t("Continuar sem publicar")}
            </Button>
          </div>
        </AvisoDoPasso>
      )}

      <RodapeDoPasso
        secundaria={
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => startTransition(() => void skipAi())}
          >
            {t("Pular")}
          </Button>
        }
      >
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("Criando...") : t("Criar e continuar")}
        </Button>
      </RodapeDoPasso>
    </form>
  );
}
