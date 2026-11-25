"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ChannelAiAccess } from "@/components/connections/ChannelAiAccess";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  configDoChatSchema,
  CONFIG_PADRAO,
  CORES_SUGERIDAS,
  MAX_DOMINIOS,
  MAX_NOME,
  MAX_SAUDACAO,
  type ConfigDoChat,
  type PosicaoDaBolha,
} from "@/lib/channels/webchat/config";
import { cn } from "@/lib/utils";

/**
 * O formulário do chat do site. A validação é a MESMA do servidor
 * (`configDoChatSchema`, `lib/channels/webchat/config.ts`): a tela recusa antes
 * de mandar, e o servidor recusa de novo.
 */

const ROTA = "/api/v1/channels/webchat";
const CHAVE_DA_CONSULTA = ["chat-do-site"];

interface Estado {
  connected: boolean;
  channel_session_id: string | null;
  config: ConfigDoChat;
  chave: string | null;
  snippet: string | null;
}

export function ChatDoSiteClient() {
  const t = useT();
  const ids = useId();
  const consulta = useQuery({
    queryKey: CHAVE_DA_CONSULTA,
    queryFn: async () => (await apiClient.get<{ data: Estado }>(ROTA)).data,
  });

  if (consulta.isLoading) {
    return <p className="text-sm text-text-muted">{t("Carregando…")}</p>;
  }
  if (consulta.isError || !consulta.data) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-2">
        <p className="rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {t("Não foi possível ler o chat do site.")}
        </p>
        <Button variant="outline" onClick={() => void consulta.refetch()}>
          {t("Tentar novamente")}
        </Button>
      </div>
    );
  }
  // A chave é a leitura: cada leitura nova do servidor recomeça o formulário,
  // sem copiar a resposta para o estado dentro de um efeito.
  return <FormularioDoChat key={consulta.dataUpdatedAt} estado={consulta.data} ids={ids} />;
}

function FormularioDoChat({ estado, ids }: { estado: Estado; ids: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [config, setConfig] = useState<ConfigDoChat>(estado.config ?? CONFIG_PADRAO);
  const [dominiosTexto, setDominiosTexto] = useState((estado.config ?? CONFIG_PADRAO).dominios.join("\n"));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const mudar = <K extends keyof ConfigDoChat>(chave: K, valor: ConfigDoChat[K]) =>
    setConfig((c) => ({ ...c, [chave]: valor }));

  const salvar = async () => {
    setErro(null);
    const dominios = dominiosTexto
      .split(/[\n,]+/)
      .map((d) => d.trim())
      .filter(Boolean);
    const parsed = configDoChatSchema.safeParse({ ...config, dominios });
    if (!parsed.success) {
      setErro(t(parsed.error.issues[0]?.message ?? "Configuração inválida."));
      return;
    }
    if (parsed.data.ativo && parsed.data.dominios.length === 0) {
      setErro(t("Informe ao menos um domínio para ligar o chat."));
      return;
    }
    setSalvando(true);
    try {
      await apiClient.put(ROTA, parsed.data);
      toast.success(t("Chat do site salvo."));
      await qc.invalidateQueries({ queryKey: CHAVE_DA_CONSULTA });
    } catch (e) {
      setErro(e instanceof Error ? t(e.message) : t("Não foi possível salvar."));
    } finally {
      setSalvando(false);
    }
  };

  const copiar = async () => {
    if (!estado.snippet) return;
    try {
      await navigator.clipboard.writeText(estado.snippet);
      toast.success(t("Código copiado."));
    } catch {
      toast.error(t("Não foi possível copiar. Selecione o código e copie à mão."));
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-10" data-testid="chat-do-site">
      <section aria-labelledby={`${ids}-aparencia`} className="flex flex-col gap-5">
        <h2 id={`${ids}-aparencia`} className="text-sm font-semibold">
          {t("Aparência")}
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-nome`}>{t("Nome na janela")}</Label>
          <Input
            id={`${ids}-nome`}
            value={config.nome}
            maxLength={MAX_NOME}
            onChange={(e) => mudar("nome", e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-saudacao`}>{t("Saudação")}</Label>
          <Textarea
            id={`${ids}-saudacao`}
            value={config.saudacao}
            maxLength={MAX_SAUDACAO}
            rows={2}
            onChange={(e) => mudar("saudacao", e.target.value)}
          />
          <p className="text-xs text-text-subtle">{t("A primeira mensagem que o visitante vê ao abrir a janela.")}</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("Cor")}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {CORES_SUGERIDAS.map((cor) => (
              <button
                key={cor}
                type="button"
                onClick={() => mudar("cor", cor)}
                aria-label={cor}
                aria-pressed={config.cor.toLowerCase() === cor}
                className={cn(
                  "flex size-11 items-center justify-center rounded-md border border-border lg:size-8",
                  config.cor.toLowerCase() === cor && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
                )}
              >
                {/* A amostra é o próprio dado escolhido, não estilo da tela. */}
                <span aria-hidden="true" className="size-6 rounded-sm lg:size-5" style={{ backgroundColor: cor }} />
              </button>
            ))}
            <Label htmlFor={`${ids}-cor`} className="sr-only">
              {t("Cor em hexadecimal")}
            </Label>
            <Input
              id={`${ids}-cor`}
              value={config.cor}
              maxLength={7}
              className="w-28 font-mono"
              onChange={(e) => mudar("cor", e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("Posição")}</legend>
          <div className="flex gap-2">
            {(["direita", "esquerda"] as PosicaoDaBolha[]).map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                aria-pressed={config.posicao === p}
                className={cn(config.posicao === p && "bg-pressed font-medium")}
                onClick={() => mudar("posicao", p)}
              >
                {p === "direita" ? t("Canto direito") : t("Canto esquerdo")}
              </Button>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby={`${ids}-onde`} className="flex flex-col gap-5">
        <h2 id={`${ids}-onde`} className="text-sm font-semibold">
          {t("Onde aparece")}
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-dominios`}>{t("Domínios permitidos")}</Label>
          <Textarea
            id={`${ids}-dominios`}
            value={dominiosTexto}
            rows={3}
            placeholder="example.com"
            className="font-mono"
            onChange={(e) => setDominiosTexto(e.target.value)}
          />
          <p className="text-xs text-text-subtle">
            {t("Um por linha. O domínio vale também para os subdomínios dele. Fora desta lista, a bolha não aparece.")}{" "}
            {t("Até")} {MAX_DOMINIOS}.
          </p>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <Switch
            id={`${ids}-ativo`}
            checked={config.ativo}
            onCheckedChange={(v) => mudar("ativo", v)}
          />
          <Label htmlFor={`${ids}-ativo`}>{config.ativo ? t("Ligado") : t("Desligado")}</Label>
        </div>
      </section>

      <div className="flex flex-col items-start gap-2">
        {erro && (
          <p role="alert" className="rounded-md bg-error-bg px-3 py-2 text-sm text-error-fg">
            {erro}
          </p>
        )}
        <Button onClick={() => void salvar()} disabled={salvando}>
          {salvando ? t("Salvando…") : t("Salvar")}
        </Button>
      </div>

      {estado.connected && estado.snippet && (
        <section aria-labelledby={`${ids}-codigo`} className="flex flex-col gap-3">
          <h2 id={`${ids}-codigo`} className="text-sm font-semibold">
            {t("Código para colar no site")}
          </h2>
          <p className="text-sm text-text-muted">
            {t("Cole antes do fechamento da tag </body> em todas as páginas onde o chat deve aparecer.")}
          </p>
          <pre
            data-testid="snippet-do-chat"
            className="overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-xs text-text"
          >
            {estado.snippet}
          </pre>
          <Button variant="outline" className="self-start" onClick={() => void copiar()}>
            {t("Copiar código")}
          </Button>
          {!estado.config.ativo && (
            <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-fg">
              {t("O chat está desligado: o código não mostra nada até você ligá-lo.")}
            </p>
          )}
        </section>
      )}

      {estado.connected && estado.channel_session_id && (
        <section aria-labelledby={`${ids}-ia`} className="flex flex-col gap-3">
          <h2 id={`${ids}-ia`} className="text-sm font-semibold">
            {t("Agente de IA neste canal")}
          </h2>
          <p className="text-sm text-text-muted">
            {t("Todo canal novo nasce com a IA em teste. Libere para que o agente responda os visitantes.")}
          </p>
          <ChannelAiAccess channelId={estado.channel_session_id} phoneTesting={false} />
        </section>
      )}
    </div>
  );
}
