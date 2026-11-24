"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { updatePipelineConfig } from "@/app/actions/settings/updatePipelineConfig";
import { useT } from "@/hooks/i18n/useT";
import { irAoDesafioDeMfa } from "@/lib/auth/ir-ao-desafio-de-mfa";
import {
  ROTULO_DO_REQUISITO,
  TIPOS_DE_REQUISITO_DA_ETAPA,
  permiteMoverMesmoAssim,
  requisitosPorEtapa,
  type TipoDeRequisitoDaEtapa,
} from "@/lib/leads/requisitos-da-etapa";

/**
 * AS TRAVAS DE ETAPA NA TELA DO FUNIL (fase 2, item 2.3).
 *
 * Cada etapa diz o que precisa EXISTIR para um negócio entrar nela (orçamento
 * enviado, agendamento, tarefa feita), e o funil diz se um gestor pode passar
 * por cima. As duas coisas moram em `crm_pipelines.settings` e são gravadas pela
 * MESMA porta do resto do funil (`updatePipelineConfig`) — por isso só quem
 * administra vê estes controles: a action recusa o resto, e mostrar um botão que
 * a gravação recusaria é mentir.
 *
 * Grava a cada clique, como o resto da seção de etapas (nome, chance, aviso na
 * Central). O mapa vai INTEIRO: a action grava como veio, e mandar só a etapa
 * mexida apagaria as outras.
 */

export interface TravasDoFunil {
  mapa: Record<string, TipoDeRequisitoDaEtapa[]>;
  permitir: boolean;
  salvando: boolean;
  alternarRequisito: (stageId: string, tipo: TipoDeRequisitoDaEtapa, ligado: boolean) => void;
  alternarPermitir: (ligado: boolean) => void;
}

/** O mapa com um requisito ligado ou desligado numa etapa — puro, para teste. */
export function mapaComRequisito(
  mapa: Record<string, TipoDeRequisitoDaEtapa[]>,
  stageId: string,
  tipo: TipoDeRequisitoDaEtapa,
  ligado: boolean,
): Record<string, TipoDeRequisitoDaEtapa[]> {
  const atuais = new Set(mapa[stageId] ?? []);
  if (ligado) atuais.add(tipo);
  else atuais.delete(tipo);
  const proximo = { ...mapa };
  const lista = TIPOS_DE_REQUISITO_DA_ETAPA.filter((x) => atuais.has(x));
  // Etapa sem requisito sai do mapa: o settings não acumula `[]` morto.
  if (lista.length > 0) proximo[stageId] = lista;
  else delete proximo[stageId];
  return proximo;
}

export function useTravasDoFunil(pipelineId: string, settings: unknown): TravasDoFunil {
  const t = useT();
  const [mapa, setMapa] = useState(() => requisitosPorEtapa(settings));
  const [permitir, setPermitir] = useState(() => permiteMoverMesmoAssim(settings));
  const [salvando, startTransition] = useTransition();

  function gravar(
    patch: { requisitos_por_etapa?: Record<string, { tipo: TipoDeRequisitoDaEtapa }[]>; permitir_mover_mesmo_assim?: boolean },
    desfazer: () => void,
  ) {
    startTransition(async () => {
      const r = await updatePipelineConfig(pipelineId, patch);
      if (r.ok) {
        toast.success(t("Etapa atualizada."));
        return;
      }
      desfazer();
      if (r.error === "mfa_required") irAoDesafioDeMfa();
      else toast.error(`${t("Erro:")} ${r.error}`);
    });
  }

  return {
    mapa,
    permitir,
    salvando,
    alternarRequisito(stageId, tipo, ligado) {
      const anterior = mapa;
      const proximo = mapaComRequisito(mapa, stageId, tipo, ligado);
      setMapa(proximo);
      gravar(
        {
          requisitos_por_etapa: Object.fromEntries(
            Object.entries(proximo).map(([id, tipos]) => [id, tipos.map((tipo) => ({ tipo }))]),
          ),
        },
        () => setMapa(anterior),
      );
    },
    alternarPermitir(ligado) {
      const anterior = permitir;
      setPermitir(ligado);
      gravar({ permitir_mover_mesmo_assim: ligado }, () => setPermitir(anterior));
    },
  };
}

/** "Exigir para entrar nesta etapa" — as três opções de uma etapa. */
export function RequisitosDaEtapa({
  stageId,
  nomeDaEtapa,
  travas,
  desabilitado,
}: {
  stageId: string;
  nomeDaEtapa: string;
  travas: TravasDoFunil;
  desabilitado: boolean;
}) {
  const t = useT();
  const marcados = new Set(travas.mapa[stageId] ?? []);
  return (
    <fieldset className="space-y-1" data-testid={`requisitos-${stageId}`}>
      <legend className="text-xs font-medium text-text-muted">
        {t("Exigir para entrar nesta etapa")}
      </legend>
      <div className="flex flex-col gap-x-4 sm:flex-row sm:flex-wrap">
        {TIPOS_DE_REQUISITO_DA_ETAPA.map((tipo) => (
          <label
            key={tipo}
            className="flex min-h-11 items-center gap-2 text-xs text-text lg:min-h-0"
          >
            <input
              type="checkbox"
              checked={marcados.has(tipo)}
              disabled={desabilitado || travas.salvando}
              aria-label={`${t(ROTULO_DO_REQUISITO[tipo])} — «${nomeDaEtapa}»`}
              data-testid={`requisito-${tipo}-${stageId}`}
              onChange={(e) => travas.alternarRequisito(stageId, tipo, e.target.checked)}
            />
            {t(ROTULO_DO_REQUISITO[tipo])}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** O interruptor do funil: gestor pode pular os requisitos (nunca os campos). */
export function PermitirMoverMesmoAssim({
  travas,
  desabilitado,
}: {
  travas: TravasDoFunil;
  desabilitado: boolean;
}) {
  const t = useT();
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
      <Switch
        checked={travas.permitir}
        onCheckedChange={(v) => travas.alternarPermitir(v)}
        disabled={desabilitado || travas.salvando}
        aria-label={t("Permitir que gestores movam mesmo assim")}
        data-testid="permitir-mover-mesmo-assim"
      />
      {t("Permitir que gestores movam mesmo assim")}
    </label>
  );
}
