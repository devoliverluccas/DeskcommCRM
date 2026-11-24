"use client";

/**
 * O RESUMO ANTES DE ENVIAR (fase 4, item 4.7) — a última seção da página ÚNICA
 * de criar campanha, logo acima de "Salvar rascunho".
 *
 * Não vira passo de assistente: a página continua uma só (o cabeçalho de
 * `new/_client.tsx` registra a recusa do wizard). O resumo é a conferência que o
 * wizard daria, no lugar em que o operador já está.
 *
 * Quem conta é o SERVIDOR (`POST /api/v1/campaigns/resumo`), pela mesma régua
 * da preparação — a tela não refaz conta nenhuma, só formata.
 *
 * Sem `useMutation` de propósito: a página é testada sem `QueryClientProvider`,
 * e este bloco é estado local de uma conferência, não cache de servidor.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { CategoriaDoModelo, ResumoDoEnvio as Resumo } from "@/lib/campanhas/resumo-do-envio";
import { cn } from "@/lib/utils";

const ROTULO_DA_CATEGORIA: Record<CategoriaDoModelo, string> = {
  marketing: "Marketing",
  utilidade: "Utilidade",
  autenticacao: "Autenticação",
  outra: "Outra categoria",
};

const ROTULO_DO_RITMO: Record<Resumo["velocidade"], string> = {
  gradual: "Uma mensagem por minuto por número.",
  rapida: "Envio rápido: várias por segundo, só com modelo aprovado.",
  transmissao: "Broadcast: a lista inteira vai para o provedor de uma vez.",
};

function duracaoLegivel(minutos: number, t: (s: string) => string): string {
  if (minutos < 60) return t("cerca de {n} min").replace("{n}", String(minutos));
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0
    ? t("cerca de {h} h").replace("{h}", String(h))
    : t("cerca de {h} h {m} min").replace("{h}", String(h)).replace("{m}", String(m));
}

export function ResumoDoEnvio({ pedido }: { pedido: Record<string, unknown> | null }) {
  const t = useT();
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [pedidoDoResumo, setPedidoDoResumo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const chave = pedido ? JSON.stringify(pedido) : null;
  const desatualizado = resumo !== null && chave !== pedidoDoResumo;

  async function conferir() {
    if (!pedido) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiClient.post<{ data: Resumo }>("/api/v1/campaigns/resumo", pedido);
      setResumo(r.data);
      setPedidoDoResumo(chave);
    } catch (err) {
      setErro(err instanceof Error && err.message ? t(err.message) : t("Não foi possível montar o resumo agora."));
    } finally {
      setCarregando(false);
    }
  }

  const a = resumo?.audiencia;
  const n = resumo?.numero;
  const d = resumo?.duracao;

  return (
    <section className="space-y-4 border-t border-border pt-6" data-testid="resumo-do-envio">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold text-text">{t("Resumo do envio")}</h2>
          <p className="text-sm text-text-muted">
            {t("Quantos recebem, o limite do número e quanto tempo leva — contado pela mesma régua do envio.")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 lg:min-h-9"
          disabled={!pedido || carregando}
          onClick={() => void conferir()}
        >
          {carregando ? t("Contando…") : resumo ? t("Atualizar o resumo") : t("Ver o resumo do envio")}
        </Button>
      </div>

      {!pedido && <p className="text-sm text-text-subtle">{t("Escolha pelo menos um critério de público.")}</p>}
      {erro && (
        <p role="alert" className="rounded-md bg-error-bg p-3 text-sm text-error-fg">
          {erro}
        </p>
      )}
      {desatualizado && (
        <p className="rounded-md bg-warning-bg p-3 text-sm text-warning-fg" data-testid="resumo-desatualizado">
          {t("O formulário mudou depois do resumo. Atualize para conferir de novo.")}
        </p>
      )}

      {resumo && a && (
        <dl className={cn("divide-y divide-border border-y border-border text-sm", desatualizado && "opacity-60")}>
          <Linha rotulo={t("Recebem")}>
            <p>
              <strong className="text-lg font-semibold tabular-nums text-text">{a.elegiveis}</strong>{" "}
              {a.elegiveis === 1 ? t("pessoa") : t("pessoas")}
              <span className="text-text-muted">
                {" "}
                · {t("de {n} no recorte").replace("{n}", String(a.total))}
              </span>
            </p>
            {a.excluidos > 0 && (
              <ul className="mt-1 space-y-0.5 text-text-muted" data-testid="resumo-exclusoes">
                {Object.entries(a.motivos).map(([motivo, quantos]) => (
                  <li key={motivo}>
                    <span className="tabular-nums">{quantos}</span> — {t(a.legenda[motivo as keyof typeof a.legenda] ?? motivo)}
                  </li>
                ))}
              </ul>
            )}
            {a.truncado && (
              <p className="mt-1 text-warning-fg">
                {t(
                  "O recorte bateu o teto de 20.000 negócios desta prévia — a lista pode estar incompleta. Refine o filtro para ver o todo.",
                )}
              </p>
            )}
          </Linha>

          {resumo.modelo && (
            <Linha rotulo={t("Modelo")}>
              <p>
                <span className="text-text">{resumo.modelo.nome}</span>
                <span className="text-text-muted">
                  {" "}
                  · {resumo.modelo.categoria ? t(ROTULO_DA_CATEGORIA[resumo.modelo.categoria]) : t("categoria não informada")}
                </span>
              </p>
              {resumo.modelo.categoria === "marketing" && (
                <p className="mt-0.5 text-text-muted">
                  {t("A plataforma cobra e limita modelo de marketing de forma diferente do de utilidade.")}
                </p>
              )}
            </Linha>
          )}

          <Linha rotulo={t("Custo estimado")}>
            <p className="text-text-muted">
              {t("Não estimado: não há tabela de preço por mensagem configurada neste sistema.")}
            </p>
          </Linha>

          {n && (
            <>
              <Linha rotulo={t("Limite do número hoje")}>
                <p>
                  {n.limiteDoDia === null ? (
                    t("Sem limite diário")
                  ) : (
                    <>
                      <strong className="tabular-nums text-text">{n.limiteDoDia}</strong>{" "}
                      {t("mensagens por número")}
                      <span className="text-text-muted">
                        {" "}
                        ·{" "}
                        {n.origemDoLimite === "aquecimento"
                          ? t("aquecimento: número com {n} dia(s) de uso").replace("{n}", String(n.idadeEmDias))
                          : t("teto diário do número")}
                      </span>
                    </>
                  )}
                </p>
                {n.numeros > 1 && (
                  <p className="mt-0.5 text-text-muted">
                    {t("{n} números no rodízio.").replace("{n}", String(n.numeros))}
                  </p>
                )}
              </Linha>
              <Linha rotulo={t("Janela de disparo")}>
                {n.janela.horas > 0 ? (
                  <p>
                    {n.janela.inicio}h–{n.janela.fim}h <span className="text-text-muted">· {n.fuso}</span>
                  </p>
                ) : (
                  <p className="text-warning-fg">
                    {t("As janelas do número e da campanha não se cruzam: nada sai.")}
                  </p>
                )}
              </Linha>
              <Linha rotulo={t("Ritmo")}>
                <p>{t(ROTULO_DO_RITMO[resumo.velocidade])}</p>
              </Linha>
              <Linha rotulo={t("Duração estimada")}>
                {d && d.dias !== null ? (
                  <p data-testid="resumo-duracao">
                    {d.dias <= 1 && d.minutos !== null
                      ? duracaoLegivel(d.minutos, t)
                      : t("cerca de {n} dias").replace("{n}", String(d.dias))}
                    {d.porDia !== null && d.dias > 1 && (
                      <span className="text-text-muted">
                        {" "}
                        · {t("até {n} por dia").replace("{n}", String(d.porDia))}
                      </span>
                    )}
                    <span className="block text-text-subtle">
                      {t("Dentro da janela, sem contar a espera até ela abrir.")}
                    </span>
                  </p>
                ) : (
                  <p className="text-warning-fg">{t("Com as regras de agora, nada sai.")}</p>
                )}
              </Linha>
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-text-muted">{rotulo}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
