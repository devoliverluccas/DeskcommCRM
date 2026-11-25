"use client";

/**
 * ESTOQUE POR LOJA (item 5.4), dentro da edição do produto.
 *
 * Só existe com o módulo `lojas` instalado e ligado pela empresa (a página
 * decide; sem ele este componente nem é montado). Cada loja grava a sua
 * quantidade à parte (`PUT /api/v1/lojas/estoque`), sem passar pelo "Salvar
 * alterações" do produto: a quantidade total do catálogo não muda por aqui.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ApiSuccess } from "@/lib/api/wrappers";

interface LinhaDeEstoque {
  loja_id: string;
  nome: string;
  ativa: boolean;
  padrao: boolean;
  quantidade: number;
}

export function EstoquePorLoja({ productId, somenteLeitura }: { productId: string; somenteLeitura: boolean }) {
  const t = useT();
  const [linhas, setLinhas] = useState<LinhaDeEstoque[] | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [falhou, setFalhou] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get<ApiSuccess<LinhaDeEstoque[]>>(`/api/v1/lojas/estoque?produto=${productId}`, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        setLinhas(res.data);
        setRascunho(Object.fromEntries(res.data.map((l) => [l.loja_id, String(l.quantidade)])));
      })
      .catch(() => {
        if (!controller.signal.aborted) setFalhou(true);
      });
    return () => controller.abort();
  }, [productId]);

  async function gravar(linha: LinhaDeEstoque) {
    const texto = (rascunho[linha.loja_id] ?? "").trim();
    const quantidade = Number(texto);
    if (texto === "" || !Number.isInteger(quantidade) || quantidade < 0) {
      toast.error(t("Quantidade inválida."));
      return;
    }
    setSalvando(linha.loja_id);
    try {
      await apiClient.put("/api/v1/lojas/estoque", { loja_id: linha.loja_id, product_id: productId, quantidade });
      setLinhas((atual) => atual?.map((l) => (l.loja_id === linha.loja_id ? { ...l, quantidade } : l)) ?? null);
      toast.success(t("Estoque da loja salvo."));
    } catch (e) {
      showApiError(e);
    } finally {
      setSalvando(null);
    }
  }

  return (
    <section className="mt-4 border-t border-border pt-3" data-testid="estoque-por-loja">
      <h3 className="text-sm font-medium">{t("Estoque por loja")}</h3>
      {falhou ? (
        <p className="mt-1 text-sm text-error-fg">{t("Não consegui carregar as lojas.")}</p>
      ) : linhas === null ? (
        <p role="status" className="mt-1 text-sm text-text-muted">
          {t("Carregando…")}
        </p>
      ) : linhas.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">{t("Nenhuma loja cadastrada. Cadastre em Configurações › Lojas.")}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border">
          {linhas.map((l) => {
            const mudou = rascunho[l.loja_id] !== String(l.quantidade);
            return (
              <li key={l.loja_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {l.nome}
                  {l.padrao ? <span className="ml-2 text-xs text-text-muted">{t("Padrão")}</span> : null}
                  {!l.ativa ? <span className="ml-2 text-xs text-text-subtle">{t("Inativa")}</span> : null}
                </span>
                <input
                  value={rascunho[l.loja_id] ?? ""}
                  onChange={(e) => setRascunho((r) => ({ ...r, [l.loja_id]: e.target.value }))}
                  inputMode="numeric"
                  aria-label={`${t("Quantidade")} — ${l.nome}`}
                  className="h-11 w-24 rounded-md border border-border bg-surface px-3 text-right text-sm tabular-nums lg:h-9"
                  disabled={somenteLeitura || salvando === l.loja_id}
                  data-testid={`estoque-loja-${l.loja_id}`}
                />
                {somenteLeitura ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 lg:min-h-0"
                    disabled={!mudou || salvando === l.loja_id}
                    onClick={() => void gravar(l)}
                  >
                    {t("Salvar")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
