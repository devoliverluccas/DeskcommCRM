"use client";

/**
 * RELATÓRIOS (3.6): um seletor de período e cinco abas, tudo na URL.
 *
 * O período (7/30/90 dias ou personalizado) é comum às abas e conta em dias
 * CIVIS no fuso da organização. Desempenho é a tela de `/app/metrics`
 * importada inteira (não uma cópia) — e por isso segue a janela própria dela,
 * os últimos 30 dias, como diz a nota da aba.
 *
 * SLA fica fora por enquanto: entra como aba quando a conta dele existir.
 */
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/hooks/i18n/useT";
import { MetricsClient } from "@/app/app/metrics/_components/MetricsClient";

import { abaDaUrl, abasVisiveis, periodoDaUrl, type Aba, type Preset } from "../_lib/periodo";
import { AbaAtendimentos } from "./AbaAtendimentos";
import { AbaAtribuicao } from "./AbaAtribuicao";
import { AbaOrigens } from "./AbaOrigens";
import { AbaSatisfacao } from "./AbaSatisfacao";
import { AbaSla } from "./AbaSla";

const ROTULO_DA_ABA: Record<Aba, string> = {
  desempenho: "Desempenho",
  atendimentos: "Atendimentos",
  sla: "SLA",
  satisfacao: "Satisfação",
  origens: "Origens",
  atribuicao: "Atribuição",
};

const ROTULO_DO_PRESET: Record<Preset, string> = {
  "7": "Últimos 7 dias",
  "30": "Últimos 30 dias",
  "90": "Últimos 90 dias",
  personalizado: "Personalizado",
};

const CAMPO =
  "h-11 rounded-md border border-border bg-surface px-2.5 text-sm transition-colors duration-fast hover:border-border-strong lg:h-8";

export function RelatoriosClient({
  podeGerenciar,
  currentUserId,
  fuso,
}: {
  podeGerenciar: boolean;
  currentUserId: string;
  fuso: string;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const aba = abaDaUrl(sp.get("aba"), podeGerenciar);
  // "Hoje" fixado por montagem: refazer a cada render trocaria a chave das
  // consultas na virada do minuto sem ninguém pedir.
  const [agora] = useState(() => new Date());
  const periodo = useMemo(() => periodoDaUrl(sp, agora, fuso), [sp, agora, fuso]);
  const [rascunho, setRascunho] = useState({ de: periodo.de, ate: periodo.ate });

  function trocar(mudancas: Record<string, string | null>) {
    const proxima = new URLSearchParams(sp.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    router.replace(`${pathname}?${proxima.toString()}`, { scroll: false });
  }

  function escolherPreset(valor: string) {
    if (valor === "personalizado") {
      setRascunho({ de: periodo.de, ate: periodo.ate });
      trocar({ p: "personalizado", de: periodo.de, ate: periodo.ate });
    } else {
      trocar({ p: valor, de: null, ate: null });
    }
  }

  const rascunhoValido = !!rascunho.de && !!rascunho.ate && rascunho.de <= rascunho.ate;

  return (
    <Tabs value={aba} onValueChange={(v) => trocar({ aba: v })} className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">{t("Período")}</span>
            <select
              value={periodo.preset}
              onChange={(e) => escolherPreset(e.target.value)}
              className={`${CAMPO} min-w-44`}
              data-testid="relatorios-periodo"
            >
              {(["7", "30", "90", "personalizado"] as Preset[]).map((p) => (
                <option key={p} value={p}>
                  {t(ROTULO_DO_PRESET[p])}
                </option>
              ))}
            </select>
          </label>
          {periodo.preset === "personalizado" && (
            <form
              className="flex flex-wrap items-end gap-x-3 gap-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (rascunhoValido) trocar({ p: "personalizado", de: rascunho.de, ate: rascunho.ate });
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">{t("De")}</span>
                <input
                  type="date"
                  value={rascunho.de}
                  max={rascunho.ate || undefined}
                  onChange={(e) => setRascunho((r) => ({ ...r, de: e.target.value }))}
                  className={CAMPO}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-muted">{t("Até")}</span>
                <input
                  type="date"
                  value={rascunho.ate}
                  min={rascunho.de || undefined}
                  onChange={(e) => setRascunho((r) => ({ ...r, ate: e.target.value }))}
                  className={CAMPO}
                />
              </label>
              <button
                type="submit"
                disabled={!rascunhoValido}
                className="inline-flex h-11 items-center rounded-md bg-text px-3 text-sm text-bg transition-colors duration-fast hover:bg-text/85 disabled:opacity-50 lg:h-8"
              >
                {t("Aplicar")}
              </button>
            </form>
          )}
        </div>

        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          {abasVisiveis(podeGerenciar).map((a) => (
            <TabsTrigger key={a} value={a} className="min-h-11 lg:min-h-0">
              {t(ROTULO_DA_ABA[a])}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="desempenho" className="mt-4">
        <p className="mb-2 text-xs text-text-muted">
          {t("Desempenho usa sempre os últimos 30 dias, independente do período escolhido acima.")}
        </p>
        <MetricsClient canCompare={podeGerenciar} currentUserId={currentUserId} />
      </TabsContent>
      <TabsContent value="atendimentos" className="mt-4">
        {aba === "atendimentos" && <AbaAtendimentos periodo={periodo} />}
      </TabsContent>
      {podeGerenciar && (
        <TabsContent value="sla" className="mt-4">
          {aba === "sla" && <AbaSla periodo={periodo} />}
        </TabsContent>
      )}
      {podeGerenciar && (
        <TabsContent value="satisfacao" className="mt-4">
          {aba === "satisfacao" && <AbaSatisfacao periodo={periodo} />}
        </TabsContent>
      )}
      <TabsContent value="origens" className="mt-4">
        {aba === "origens" && <AbaOrigens periodo={periodo} fuso={fuso} />}
      </TabsContent>
      {podeGerenciar && (
        <TabsContent value="atribuicao" className="mt-4">
          {aba === "atribuicao" && <AbaAtribuicao periodo={periodo} />}
        </TabsContent>
      )}
    </Tabs>
  );
}
