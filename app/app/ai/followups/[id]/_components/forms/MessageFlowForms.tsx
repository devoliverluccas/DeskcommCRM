"use client";

/**
 * Formulários dos nós do fluxo de mensagens que entraram juntos (4.3).
 *
 * A regra dos demais formulários vale aqui: o campo só grava no nó vivo quando
 * o candidato passa no schema do grafo (`graph-schema.ts`), senão mostra o erro
 * e o canvas fica com a última configuração válida. Texto em branco PASSA no
 * rascunho (o painel grava a cada tecla) — quem exige preenchido é o publish.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { useAttendants } from "@/hooks/team/useAttendants";
import { useSectors } from "@/hooks/team/useSectors";
import { useSegredoDoWebhookDoFluxo } from "@/hooks/followup/useSegredoDoWebhookDoFluxo";
import {
  MAX_BOTOES,
  MAX_CORPO_INTERATIVO,
  MAX_DESCRICAO_DA_LISTA,
  MAX_ITENS_DA_LISTA,
  MAX_ROTULO_DA_LISTA,
  MAX_ROTULO_DO_BOTAO,
} from "@/lib/channels/interativo";
import {
  buttonsConfigSchema,
  listConfigSchema,
  transferConfigSchema,
  webhookConfigSchema,
} from "@/lib/followup/graph-schema";
import { ESPERA_PELA_RESPOSTA } from "@/lib/followup/vocabulario";
import { Plus, Trash } from "@/lib/ui/icons";

import { minToMs, msToMin, type ConfigOf } from "./shared";

type Opcao = { id: string; label: string; description?: string };

/** `op_N` livre — o id é o ramo (a aresta aponta para ele), e não muda ao renomear. */
function novoIdDeOpcao(usados: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const candidato = `op_${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

/** Editor comum de Botões e Lista: corpo, opções e a espera pela escolha. */
function EditorDeOpcoes({
  tipo,
  config,
  onChange,
}: {
  tipo: "buttons" | "list";
  config: ConfigOf<"buttons"> | ConfigOf<"list">;
  onChange: (c: ConfigOf<"buttons"> | ConfigOf<"list">) => void;
}) {
  const t = useT();
  const ehLista = tipo === "list";
  const teto = ehLista ? MAX_ITENS_DA_LISTA : MAX_BOTOES;
  const tetoDoRotulo = ehLista ? MAX_ROTULO_DA_LISTA : MAX_ROTULO_DO_BOTAO;
  const [body, setBody] = useState(config.body);
  const [opcoes, setOpcoes] = useState<Opcao[]>(config.options);
  const [botao, setBotao] = useState("button_label" in config ? config.button_label : "");
  const [graceMin, setGraceMin] = useState(msToMin(config.grace_timeout_ms));
  const [erro, setErro] = useState<string | null>(null);

  const commit = (next: { body: string; opcoes: Opcao[]; botao: string; graceMin: number }) => {
    const parsed = ehLista
      ? listConfigSchema.safeParse({
          body: next.body,
          button_label: next.botao,
          options: next.opcoes,
          grace_timeout_ms: minToMs(next.graceMin),
        })
      : buttonsConfigSchema.safeParse({
          body: next.body,
          options: next.opcoes.map(({ id, label }) => ({ id, label })),
          grace_timeout_ms: minToMs(next.graceMin),
        });
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setErro(null);
    onChange(parsed.data);
  };
  const atual = { body, opcoes, botao, graceMin };

  const mudarOpcao = (index: number, patch: Partial<Opcao>) => {
    const next = opcoes.map((o, i) => (i === index ? { ...o, ...patch } : o));
    setOpcoes(next);
    commit({ ...atual, opcoes: next });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${tipo}-body`}>{t("Mensagem")}</Label>
        <Textarea
          id={`${tipo}-body`}
          value={body}
          maxLength={MAX_CORPO_INTERATIVO}
          rows={3}
          onChange={(e) => {
            setBody(e.target.value);
            commit({ ...atual, body: e.target.value });
          }}
        />
      </div>

      {ehLista && (
        <div className="space-y-2">
          <Label htmlFor="list-button-label">{t("Texto do botão da lista")}</Label>
          <Input
            id="list-button-label"
            value={botao}
            maxLength={MAX_ROTULO_DO_BOTAO}
            onChange={(e) => {
              setBotao(e.target.value);
              commit({ ...atual, botao: e.target.value });
            }}
          />
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text">{t("Opções")}</legend>
        <ol className="space-y-2" data-testid={`${tipo}-opcoes`}>
          {opcoes.map((opcao, index) => (
            <li key={opcao.id} className="flex items-start gap-2">
              <span className="mt-2.5 w-5 shrink-0 text-right text-xs tabular-nums text-text-subtle" aria-hidden>
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Input
                  aria-label={`${t("Opção")} ${index + 1}`}
                  value={opcao.label}
                  maxLength={tetoDoRotulo}
                  onChange={(e) => mudarOpcao(index, { label: e.target.value })}
                />
                {ehLista && (
                  <Input
                    aria-label={`${t("Descrição da opção")} ${index + 1}`}
                    placeholder={t("Descrição (opcional)")}
                    value={opcao.description ?? ""}
                    maxLength={MAX_DESCRICAO_DA_LISTA}
                    onChange={(e) =>
                      mudarOpcao(index, e.target.value ? { description: e.target.value } : { description: undefined })
                    }
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${t("Remover opção")} ${index + 1}`}
                disabled={opcoes.length <= 1}
                onClick={() => {
                  const next = opcoes.filter((_, i) => i !== index);
                  setOpcoes(next);
                  commit({ ...atual, opcoes: next });
                }}
              >
                <Trash size={14} aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        {opcoes.length < teto && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const id = novoIdDeOpcao(new Set(opcoes.map((o) => o.id)));
              const next = [...opcoes, { id, label: `${t("Opção")} ${opcoes.length + 1}` }];
              setOpcoes(next);
              commit({ ...atual, opcoes: next });
            }}
          >
            <Plus size={14} aria-hidden className="mr-1" /> {t("Adicionar opção")}
          </Button>
        )}
        <p className="text-xs text-text-muted">
          {t(
            "Cada opção é uma saída do nó. No WhatsApp oficial as opções aparecem como botões; nos outros canais, como lista numerada — o cliente pode responder com o número ou com o nome da opção.",
          )}
        </p>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={`${tipo}-grace`}>{t(ESPERA_PELA_RESPOSTA.rotulo)}</Label>
        <Input
          id={`${tipo}-grace`}
          type="number"
          min={ESPERA_PELA_RESPOSTA.minimoMinutos}
          value={graceMin}
          onChange={(e) => {
            const v = Number(e.target.value);
            setGraceMin(v);
            commit({ ...atual, graceMin: v });
          }}
        />
        <p className="text-xs text-text-muted">{ESPERA_PELA_RESPOSTA.ajuda(t)}</p>
      </div>
      {erro && <p className="text-xs text-error-fg">{erro}</p>}
    </div>
  );
}

export function ButtonsForm(props: { config: ConfigOf<"buttons">; onChange: (c: ConfigOf<"buttons">) => void }) {
  return (
    <EditorDeOpcoes
      tipo="buttons"
      config={props.config}
      onChange={(c) => props.onChange(c as ConfigOf<"buttons">)}
    />
  );
}

export function ListForm(props: { config: ConfigOf<"list">; onChange: (c: ConfigOf<"list">) => void }) {
  return (
    <EditorDeOpcoes tipo="list" config={props.config} onChange={(c) => props.onChange(c as ConfigOf<"list">)} />
  );
}

export function WebhookForm({
  config,
  onChange,
  flowId,
}: {
  config: ConfigOf<"webhook">;
  onChange: (c: ConfigOf<"webhook">) => void;
  flowId?: string;
}) {
  const t = useT();
  const [url, setUrl] = useState(config.url);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const segredo = useSegredoDoWebhookDoFluxo(flowId, mostrar);

  const commit = (proxima: string) => {
    setUrl(proxima);
    const parsed = webhookConfigSchema.safeParse({
      url: proxima,
      ...(config.timeout_ms !== undefined ? { timeout_ms: config.timeout_ms } : {}),
    });
    if (!parsed.success) {
      setErro(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setErro(null);
    onChange(parsed.data);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="webhook-url">{t("Endereço (URL)")}</Label>
        <Input
          id="webhook-url"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          maxLength={2000}
          onChange={(e) => commit(e.target.value)}
        />
        <p className="text-xs text-text-muted">
          {t(
            "O fluxo envia um POST com os dados do contato e da conversa e segue em seguida: resposta 2xx sai por Sucesso; erro, demora acima de 5 segundos ou endereço de rede interna saem por Erro.",
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("Segredo da assinatura")}</Label>
        <p className="text-xs text-text-muted">
          {t("Cada envio leva o cabeçalho X-Webhook-Signature (HMAC SHA-256). Use este segredo para conferir a assinatura no seu sistema.")}
        </p>
        {mostrar && segredo.data ? (
          <code
            className="block break-all rounded-md border border-border bg-surface-elevated px-2.5 py-2 font-mono text-xs text-text"
            data-testid="webhook-segredo"
          >
            {segredo.data}
          </code>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!flowId || segredo.isFetching}
            onClick={() => setMostrar(true)}
          >
            {t("Mostrar segredo")}
          </Button>
        )}
        {segredo.isError && (
          <p className="text-xs text-error-fg">{t("Não foi possível carregar o segredo. Tente de novo.")}</p>
        )}
      </div>
      {erro && <p className="text-xs text-error-fg">{erro}</p>}
    </div>
  );
}

export function TransferForm({
  config,
  onChange,
}: {
  config: ConfigOf<"transfer">;
  onChange: (c: ConfigOf<"transfer">) => void;
}) {
  const t = useT();
  const [destino, setDestino] = useState(config.destino);
  const setores = useSectors(destino.tipo === "setor");
  const atendentes = useAttendants(destino.tipo === "atendente");

  const commit = (next: ConfigOf<"transfer">["destino"]) => {
    setDestino(next);
    const parsed = transferConfigSchema.safeParse({ destino: next });
    if (parsed.success) onChange(parsed.data);
  };
  const idAtual = destino.tipo === "setor" ? destino.sector_id : destino.user_id;
  const opcoes =
    destino.tipo === "setor"
      ? (setores.data?.data ?? []).map((s) => ({ id: s.id, nome: s.name }))
      : (atendentes.data?.data ?? []).map((a) => ({ id: a.user_id, nome: a.name ?? t("Sem nome") }));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="transfer-tipo">{t("Transferir para")}</Label>
        <Select
          value={destino.tipo}
          onValueChange={(v) =>
            commit(v === "setor" ? { tipo: "setor", sector_id: "" } : { tipo: "atendente", user_id: "" })
          }
        >
          <SelectTrigger id="transfer-tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="setor">{t("Setor")}</SelectItem>
            <SelectItem value="atendente">{t("Atendente")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="transfer-destino">{destino.tipo === "setor" ? t("Setor") : t("Atendente")}</Label>
        <Select
          value={idAtual || undefined}
          onValueChange={(v) =>
            commit(destino.tipo === "setor" ? { tipo: "setor", sector_id: v } : { tipo: "atendente", user_id: v })
          }
        >
          <SelectTrigger id="transfer-destino">
            <SelectValue placeholder={t("Escolha")} />
          </SelectTrigger>
          <SelectContent>
            {opcoes.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-text-muted">
          {t("A mesma troca do botão Transferir: a conversa passa para quem você escolher e o fluxo segue para a próxima caixa.")}
        </p>
      </div>
    </div>
  );
}

export function HandoffAiForm() {
  const t = useT();
  return (
    <p className="text-sm text-text-muted">
      {t("O fluxo termina aqui e o agente de IA volta a responder esta conversa.")}
    </p>
  );
}
