"use client";

/**
 * Os cinco nós do fluxo de mensagens que entraram juntos (4.3) — Botões, Lista,
 * Webhook, Transferir e Passar para a IA. Num arquivo só porque são o mesmo
 * cartão (`NodeCard`) com o visual e as saídas de cada tipo; um arquivo por nó
 * repetiria vinte linhas idênticas cinco vezes.
 *
 * As SAÍDAS ficam visíveis no desenho: cada opção de Botões/Lista é uma linha
 * com a sua bolinha, além de "Sem resposta" e "Outros casos"; o Webhook mostra
 * "Sucesso" e "Erro". "Passar para a IA" é terminal e não tem bolinha de saída.
 */
import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { nodeBranches } from "@/lib/followup/graph-schema";
import { useT } from "@/hooks/i18n/useT";
import type { ConfigOf } from "../forms/shared";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";

export function ButtonsNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.buttons}
      label={data.label}
      subtitle={describeNodeConfig("buttons", data.config, t)}
      selected={selected}
      errors={data.errors}
      branches={nodeBranches({ type: "buttons", config: data.config as ConfigOf<"buttons"> })}
    />
  );
}

export function ListNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.list}
      label={data.label}
      subtitle={describeNodeConfig("list", data.config, t)}
      selected={selected}
      errors={data.errors}
      branches={nodeBranches({ type: "list", config: data.config as ConfigOf<"list"> })}
    />
  );
}

export function WebhookNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.webhook}
      label={data.label}
      subtitle={describeNodeConfig("webhook", data.config, t)}
      selected={selected}
      errors={data.errors}
      branches={nodeBranches({ type: "webhook", config: data.config as ConfigOf<"webhook"> })}
    />
  );
}

export function TransferNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.transfer}
      label={data.label}
      subtitle={describeNodeConfig("transfer", data.config, t)}
      selected={selected}
      errors={data.errors}
    />
  );
}

export function HandoffAiNode({ id, data, selected }: NodeProps<RFNode>) {
  const t = useT();
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.handoff_ai}
      label={data.label}
      subtitle={describeNodeConfig("handoff_ai", data.config, t)}
      selected={selected}
      errors={data.errors}
      showSource={false}
    />
  );
}
