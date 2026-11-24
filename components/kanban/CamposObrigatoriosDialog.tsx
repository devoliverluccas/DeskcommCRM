"use client";
import { useContext, useEffect, useState } from "react";
import Link from "next/link";
import { QueryClientContext, type QueryClient } from "@tanstack/react-query";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { TIPO_DO_ITEM_REQUISITO } from "@/lib/leads/requisitos-da-etapa";
import type { BoardData } from "@/lib/kanban/types";
import { Warning } from "@/lib/ui/icons";
import { useMoedaDaOrgAtiva } from "@/hooks/auth/AuthProvider";
import { exemploDoCampoDeMoeda, lerCampoDeMoeda } from "@/lib/leads/campo-de-moeda";
import { MOEDA_PADRAO } from "@/lib/money";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileUploadCustomField } from "@/components/kanban/FileUploadCustomField";
import type { RecusaDeCampos } from "@/hooks/kanban/useMoveCard";

/**
 * O DIAGNÓGICO EM FORMULÁRIO — o outro lado do 422 `required_fields_missing`
 * (issue #1536).
 *
 * ─── Por que diálogo e não toast ───────────────────────────────────────────
 *
 * O quadro pedia para mover o card; o servidor recusou dizendo QUAIS campos
 * faltam (`details.faltando`, chave + rótulo + tipo). Um toast jogaria essa
 * lista fora: a pessoa veria "deu errado" sem caminho, fecharia o card e
 * perderia a posição que arrastou. Este diálogo é o mesmo formato da janela de
 * perder (`LoseLeadDialog`), com uma diferença de contrato: ele NÃO grava nada
 * sozinho — ele devolve os valores para o `useMoveCard` reenviar o MESMO move
 * com `custom_fields` junto, e a etapa e os campos saem numa escrita só.
 *
 * ─── O que ele não faz ─────────────────────────────────────────────────────
 *
 * Não valida vocabulário (o servidor é quem sabe a lista do funil), não
 * grava antes de mover (a janela entre dois writes é o defeito da #917) e não
 * adivinha o tipo: o que vem em `tipo` é o que o funil declarou, e tipo
 * desconhecido vira texto — erro de leitura não pode virar input ilegível.
 */
interface CamposObrigatoriosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A recusa que abriu este diálogo — argumentos originais + o que falta. */
  recusa: RecusaDeCampos | null;
  /** Envia o move de novo, com os valores coletados na MESMA escrita. */
  onConfirmar: (valores: { customFields: Record<string, unknown>; wonReason?: string }) => void;
  /** Enquanto o reenvio não responde, o botão fica travado. */
  isPending?: boolean;
}

/** `won_reason` NÃO é campo do funil: sai como parâmetro próprio do move. */
const CHAVE_DO_MOTIVO_DE_GANHO = "won_reason";

/**
 * O atalho de cada requisito — a porta para RESOLVER o que falta, em vez de só
 * ler que falta. Exportado para o teste conferir os destinos.
 */
export function atalhoDoRequisito(
  chave: string,
  leadId: string,
  t: (texto: string) => string = (texto) => texto,
): { href: string; rotulo: string } | null {
  switch (chave) {
    case "orcamento_vinculado":
      return {
        href: `/app/proposals/novo?lead_id=${encodeURIComponent(leadId)}`,
        rotulo: t("Criar orçamento"),
      };
    case "agendamento_marcado":
      return { href: "/app/agenda", rotulo: t("Agendar") };
    case "tarefa_concluida":
      // As tarefas do negócio moram na página inteira dele (bloco de tarefas).
      return { href: `/app/leads/${encodeURIComponent(leadId)}/pagina`, rotulo: t("Ver tarefas") };
    default:
      return null;
  }
}

/**
 * O nome da etapa de destino, lido do quadro que já está em cache — o título
 * "Para mover para Proposta enviada falta:" sem nova ida à rede. Fora do quadro
 * (página do negócio, teste sem provider) não há cache e o título fica genérico.
 */
function nomeDaEtapaNoCache(queryClient: QueryClient | undefined, stageId: string): string | null {
  if (!queryClient) return null;
  for (const [, dados] of queryClient.getQueriesData<BoardData>({ queryKey: ["board"] })) {
    const etapa = dados?.stages?.find((s) => s.id === stageId);
    if (etapa?.name) return etapa.name;
  }
  return null;
}

function inputHtmlParaTipo(tipo: string | undefined): string {
  switch (tipo) {
    case "date":
      return "date";
    case "number":
      return "number";
    case "currency":
      return "text";
    case "email":
      return "email";
    case "phone":
      return "tel";
    case "url":
      return "url";
    default:
      return "text";
  }
}

export function CamposObrigatoriosDialog({
  open,
  onOpenChange,
  recusa,
  onConfirmar,
  isPending = false,
}: CamposObrigatoriosDialogProps) {
  const t = useT();
  // O campo de moeda na moeda da organização, não em real fixo.
  const moeda = useMoedaDaOrgAtiva() ?? MOEDA_PADRAO;
  const [valores, setValores] = useState<Record<string, string>>({});
  const [forcando, setForcando] = useState(false);
  // `useContext` e não `useQueryClient`: este diálogo também é montado fora de
  // um provider (testes, telas sem quadro), e lá ele só perde o título com o
  // nome da etapa e a atualização do quadro — nunca quebra.
  const queryClient = useContext(QueryClientContext);

  // Troca de recusa zera o formulário: um diálogo reaproveitado com os valores
  // do card anterior pediria ao operador para confirmar dados que não são dele.
  useEffect(() => {
    if (open) setValores({});
  }, [open, recusa]);

  if (!recusa) return null;

  // As TRAVAS DE ETAPA (item 2.3) chegam na MESMA lista, com `tipo: "requisito"`:
  // não são input — são coisas que precisam existir (orçamento, agenda, tarefa).
  // Viram linha com atalho; o formulário continua só com os campos.
  const requisitos = recusa.faltando.filter((item) => item.tipo === TIPO_DO_ITEM_REQUISITO);
  const campos = recusa.faltando.filter((item) => item.tipo !== TIPO_DO_ITEM_REQUISITO);
  // Quem decide se a pessoa logada pode forçar é o servidor (funil + papel); a
  // tela só obedece à marca que ele pôs no item.
  // (`RecusaDeCampos` do hook não declara a marca — ela é aditiva no contrato.)
  const podeForcar = requisitos.some(
    (item) => (item as { pode_forcar?: unknown }).pode_forcar === true,
  );
  const leadId = recusa.args.leadId;
  const nomeDaEtapa = nomeDaEtapaNoCache(queryClient, recusa.args.stageId);

  const valido = campos.every((campo) => {
    if (campo.tipo === "boolean") return true;
    // Campo `file`: o valor aqui é só a CONTAGEM de anexos, para liberar o botão.
    if (campo.tipo === "file") return Number(valores[campo.chave] ?? 0) > 0;
    const valor = (valores[campo.chave] ?? "").trim();
    if (valor.length === 0) return false;
    if (campo.tipo === "number" && Number.isNaN(Number(valor))) return false;
    if (campo.tipo === "currency" && lerCampoDeMoeda(valor, moeda) === null) return false;
    if (campo.tipo === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) return false;
    if (campo.tipo === "url") {
      try {
        new URL(valor);
      } catch {
        return false;
      }
    }
    return true;
  });

  const valoresColetados = () => {
    const customFields: Record<string, unknown> = {};
    let wonReason: string | undefined;
    for (const campo of campos) {
      const bruto = valores[campo.chave] ?? "";
      const valor = bruto.trim();
      // O anexo já foi gravado em `crm_lead_attachments` pelo upload, e é lá que
      // o servidor confere; ele nunca vai em `custom_fields`.
      if (campo.tipo === "file") continue;
      if (campo.tipo === "boolean") {
        customFields[campo.chave] = bruto === "true";
        continue;
      }
      if (campo.tipo === "number") {
        customFields[campo.chave] = Number(valor);
        continue;
      }
      if (campo.tipo === "currency") {
        customFields[campo.chave] = (lerCampoDeMoeda(valor, moeda) ?? 0) / 100;
        continue;
      }
      if (campo.chave === CHAVE_DO_MOTIVO_DE_GANHO) {
        wonReason = valor;
        continue;
      }
      customFields[campo.chave] = valor;
    }
    return { customFields, ...(wonReason !== undefined ? { wonReason } : {}) };
  };

  const confirmar = () => {
    if (!valido || isPending || forcando) return;
    onConfirmar(valoresColetados());
  };

  /**
   * "MOVER MESMO ASSIM" — o diálogo reenvia o move ele mesmo, com `forcar: true`.
   *
   * Não passa pelo `onConfirmar` do pai de propósito: o hook do arrasto
   * (`useMoveCard`) não conhece `forcar`, e ensiná-lo seria abrir a chave para
   * todo consumidor do hook. Os campos preenchidos aqui vão JUNTO — forçar pula
   * só os requisitos, e o servidor recusa de novo se faltar campo.
   */
  const moverMesmoAssim = async () => {
    if (!valido || isPending || forcando) return;
    const { customFields, wonReason } = valoresColetados();
    const { args } = recusa;
    setForcando(true);
    try {
      await apiClient.post(`/api/v1/leads/${args.leadId}/move`, {
        stage_id: args.stageId,
        ...(args.positionInStage !== undefined ? { position_in_stage: args.positionInStage } : {}),
        expected_updated_at: args.expectedUpdatedAt,
        ...(Object.keys(customFields).length > 0 ? { custom_fields: customFields } : {}),
        ...(wonReason !== undefined ? { won_reason: wonReason } : {}),
        ...(args.lostReason !== undefined ? { lost_reason: args.lostReason } : {}),
        forcar: true,
      });
      await queryClient?.invalidateQueries({ queryKey: ["board"] });
      onOpenChange(false);
    } catch (erro) {
      showApiError(erro);
    } finally {
      setForcando(false);
    }
  };

  const ocupado = isPending || forcando;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {requisitos.length > 0
              ? nomeDaEtapa
                ? t("Para mover para {nome} falta:").replace("{nome}", nomeDaEtapa)
                : t("Para mover para esta etapa falta:")
              : t("Campos obrigatórios")}
          </DialogTitle>
          <DialogDescription>
            {requisitos.length > 0
              ? t("Resolva o que falta e arraste o negócio de novo.")
              : t(
                  "Este funil exige alguns dados antes de mover o negócio. Preencha o que falta para continuar.",
                )}
          </DialogDescription>
        </DialogHeader>

        {requisitos.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border" data-testid="requisitos-faltando">
            {requisitos.map((item) => {
              const atalho = atalhoDoRequisito(item.chave, leadId, t);
              return (
                <li
                  key={item.chave}
                  className="flex min-h-11 items-center justify-between gap-3 py-2"
                  data-testid={`requisito-${item.chave}`}
                >
                  <span className="flex items-center gap-2 text-sm text-text">
                    <Warning size={16} aria-hidden className="shrink-0 text-warning-fg" />
                    {t(item.rotulo)}
                  </span>
                  {atalho ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={atalho.href}>{atalho.rotulo}</Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="space-y-3">
          {campos.map((campo) => {
            const nome = campo.chave === "won_reason" ? t("Motivo do ganho") : campo.rotulo;
            const rotuloCampo = `${nome}${campo.tipo === "boolean" ? "" : " *"}`;
            if (campo.tipo === "boolean") {
              return (
                <div key={campo.chave} className="flex items-center gap-2">
                  <input
                    id={`campo-${campo.chave}`}
                    type="checkbox"
                    className="checkbox"
                    checked={(valores[campo.chave] ?? "") === "true"}
                    onChange={(e) =>
                      setValores((v) => ({
                        ...v,
                        [campo.chave]: e.target.checked ? "true" : "false",
                      }))
                    }
                  />
                  <Label htmlFor={`campo-${campo.chave}`} className="text-sm">
                    {rotuloCampo}
                  </Label>
                </div>
              );
            }
            if (campo.tipo === "file") {
              return (
                <FileUploadCustomField
                  key={campo.chave}
                  fieldKey={campo.chave}
                  label={nome}
                  required
                  leadId={recusa.args.leadId}
                  onChange={(files) =>
                    setValores((v) => ({ ...v, [campo.chave]: String(files.length) }))
                  }
                />
              );
            }
            if (
              (campo.tipo === "select" || campo.tipo === "searchable_select") &&
              campo.opcoes &&
              campo.opcoes.length > 0
            ) {
              return (
                <div key={campo.chave} className="space-y-1">
                  <Label className="text-xs">{rotuloCampo}</Label>
                  <Select
                    value={valores[campo.chave] ?? ""}
                    onValueChange={(valor) => setValores((v) => ({ ...v, [campo.chave]: valor }))}
                  >
                    <SelectTrigger aria-label={nome}>
                      <SelectValue placeholder={t("Selecione…")} />
                    </SelectTrigger>
                    <SelectContent>
                      {campo.opcoes.map((opcao) => (
                        <SelectItem key={opcao.value} value={opcao.value}>
                          {opcao.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            }
            if (campo.tipo === "textarea") {
              return (
                <div key={campo.chave} className="space-y-1">
                  <Label className="text-xs">{rotuloCampo}</Label>
                  <Textarea
                    aria-label={nome}
                    value={valores[campo.chave] ?? ""}
                    onChange={(e) => setValores((v) => ({ ...v, [campo.chave]: e.target.value }))}
                  />
                </div>
              );
            }
            return (
              <div key={campo.chave} className="space-y-1">
                <Label className="text-xs">{rotuloCampo}</Label>
                <Input
                  aria-label={nome}
                  type={inputHtmlParaTipo(campo.tipo)}
                  inputMode={campo.tipo === "currency" ? "decimal" : undefined}
                  placeholder={campo.tipo === "currency" ? exemploDoCampoDeMoeda(moeda, 1250) : undefined}
                  value={valores[campo.chave] ?? ""}
                  onChange={(e) => setValores((v) => ({ ...v, [campo.chave]: e.target.value }))}
                />
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ocupado}>
            {t("Cancelar")}
          </Button>
          {/* Com requisito na lista, "Mover agora" não resolveria nada: o
              servidor recusaria de novo. A saída é o atalho — ou forçar. */}
          {requisitos.length === 0 ? (
            <Button onClick={confirmar} disabled={!valido || ocupado}>
              {isPending ? t("Salvando…") : t("Mover agora")}
            </Button>
          ) : podeForcar ? (
            <Button
              variant="outline"
              onClick={moverMesmoAssim}
              disabled={!valido || ocupado}
              data-testid="mover-mesmo-assim"
            >
              {forcando ? t("Salvando…") : t("Mover mesmo assim")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
