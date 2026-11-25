"use client";

/**
 * A LOJA DO ORÇAMENTO (item 5.4), logo abaixo do título da proposta.
 *
 * Só é montada quando o módulo `lojas` está instalado e ligado pela empresa
 * (a página passa as lojas; sem elas, nada é desenhado). A loja nasce
 * registrada na criação (a do número da conversa, senão a padrão); aqui se
 * corrige. Quem não pode editar a proposta só lê.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";

export function LojaDaProposta({
  propostaId,
  lojas,
  podeEditar,
}: {
  propostaId: string;
  lojas: Array<{ id: string; nome: string }>;
  podeEditar: boolean;
}) {
  const t = useT();
  const [loja, setLoja] = useState<string | null | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get<ApiSuccess<{ loja_id: string | null }>>(`/api/v1/lojas/propostas/${propostaId}`, {
        signal: controller.signal,
      })
      .then((res) => {
        if (!controller.signal.aborted) setLoja(res.data.loja_id);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoja(null);
      });
    return () => controller.abort();
  }, [propostaId]);

  async function trocar(valor: string) {
    const nova = valor === "" ? null : valor;
    const antes = loja;
    setLoja(nova);
    setSalvando(true);
    try {
      await apiClient.put(`/api/v1/lojas/propostas/${propostaId}`, { loja_id: nova });
      toast.success(t("Loja do orçamento salva."));
    } catch (e) {
      setLoja(antes);
      showApiError(e);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-text-muted">{t("Loja")}</span>
      <select
        value={loja ?? ""}
        disabled={!podeEditar || salvando || loja === undefined}
        onChange={(e) => void trocar(e.target.value)}
        className="h-11 min-w-44 rounded-md border border-border bg-surface px-2.5 text-sm disabled:opacity-60 lg:h-9"
        data-testid="proposta-loja"
      >
        <option value="">{t("Sem loja")}</option>
        {lojas.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
