"use client";

/**
 * METAS DE SLA (fase 3, item 3.3) — primeira resposta em minutos, resolução em
 * horas, e opcionalmente um par próprio por setor.
 *
 * Em branco é "sem meta", e sem meta nenhuma a lista de conversas fica como era:
 * nenhum selo. O tempo fora do horário do setor não conta (o horário é o da fila,
 * em Equipe › Setores). Salva o bloco inteiro de uma vez, pelo `PATCH
 * /api/v1/settings/sla` (manager+, o piso desta tela).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";
import {
  SLA_PRIMEIRA_RESPOSTA_MAX_MIN,
  SLA_RESOLUCAO_MAX_HORAS,
  type MetasDoPar,
  type MetasDoSla,
} from "@/lib/schemas/settings";

interface Par {
  primeira: string;
  resolucao: string;
}

const paraTexto = (p: MetasDoPar): Par => ({
  primeira: p.primeira_resposta_min == null ? "" : String(p.primeira_resposta_min),
  resolucao: p.resolucao_horas == null ? "" : String(p.resolucao_horas),
});

/** "" = sem meta; número inteiro positivo = meta; o resto é `undefined` (inválido). */
function paraNumero(texto: string, max: number): number | null | undefined {
  const v = texto.trim();
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) return undefined;
  return n;
}

export function MetasDoSlaForm({
  initial,
  setores,
  idioma,
}: {
  initial: MetasDoSla;
  /** Os setores da organização; vazio (ou módulo desligado) esconde a parte por setor. */
  setores: Array<{ id: string; name: string }>;
  idioma: Idioma;
}) {
  const t = (texto: string) => traduzir(texto, idioma);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [org, setOrg] = useState<Par>(paraTexto(initial));
  const [porSetor, setPorSetor] = useState<Record<string, Par>>(() =>
    Object.fromEntries(Object.entries(initial.por_setor).map(([id, p]) => [id, paraTexto(p)])),
  );

  function par(p: Par): MetasDoPar | null {
    const primeira = paraNumero(p.primeira, SLA_PRIMEIRA_RESPOSTA_MAX_MIN);
    const resolucao = paraNumero(p.resolucao, SLA_RESOLUCAO_MAX_HORAS);
    if (primeira === undefined || resolucao === undefined) return null;
    return { primeira_resposta_min: primeira, resolucao_horas: resolucao };
  }

  function salvar() {
    const daOrg = par(org);
    const doSetor: Record<string, MetasDoPar> = {};
    let valido = daOrg !== null;
    for (const [id, p] of Object.entries(porSetor)) {
      const lido = par(p);
      if (!lido) valido = false;
      else doSetor[id] = lido;
    }
    if (!valido || !daOrg) {
      toast.error(t("Use números inteiros maiores que zero, ou deixe em branco para não ter meta."));
      return;
    }
    startTransition(async () => {
      try {
        await apiClient.patch("/api/v1/settings/sla", { ...daOrg, por_setor: doSetor });
        toast.success(t("Metas salvas."));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? t(err.message) : t("Não consegui salvar agora."));
      }
    });
  }

  function campos(p: Par, mudar: (novo: Par) => void, prefixo: string) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${prefixo}-primeira`}>{t("Primeira resposta (minutos)")}</Label>
          <Input
            id={`${prefixo}-primeira`}
            inputMode="numeric"
            placeholder={t("Sem meta")}
            value={p.primeira}
            onChange={(e) => mudar({ ...p, primeira: e.target.value })}
            className="max-w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${prefixo}-resolucao`}>{t("Resolução (horas)")}</Label>
          <Input
            id={`${prefixo}-resolucao`}
            inputMode="numeric"
            placeholder={t("Sem meta")}
            value={p.resolucao}
            onChange={(e) => mudar({ ...p, resolucao: e.target.value })}
            className="max-w-40"
          />
        </div>
      </div>
    );
  }

  return (
    <Card className="p-6" data-testid="metas-de-sla">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{t("Metas de SLA")}</h2>
        <p className="max-w-2xl text-xs text-text-muted">
          {t(
            "Quanto tempo a equipe tem para dar a primeira resposta e para resolver o atendimento. A conversa perto do prazo ou atrasada ganha um selo na lista. O tempo fora do horário do setor não conta. Em branco, sem meta.",
          )}
        </p>
      </div>

      <div className="mt-4">{campos(org, setOrg, "sla-org")}</div>

      {setores.length > 0 && (
        <div className="mt-6 flex flex-col gap-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium">{t("Meta própria por setor")}</h3>
          <ul className="flex flex-col gap-4">
            {setores.map((s) => {
              const proprio = porSetor[s.id];
              return (
                <li key={s.id} className="flex flex-col gap-3">
                  <div className="flex min-h-11 items-center justify-between gap-4 lg:min-h-0">
                    <Label htmlFor={`sla-setor-${s.id}`} className="font-normal">
                      {s.name}
                    </Label>
                    <Switch
                      id={`sla-setor-${s.id}`}
                      checked={proprio !== undefined}
                      onCheckedChange={(ligado) =>
                        setPorSetor((atual) => {
                          const proximo = { ...atual };
                          if (ligado) proximo[s.id] = { ...org };
                          else delete proximo[s.id];
                          return proximo;
                        })
                      }
                    />
                  </div>
                  {proprio ? (
                    campos(proprio, (novo) => setPorSetor((atual) => ({ ...atual, [s.id]: novo })), `sla-setor-${s.id}`)
                  ) : (
                    <p className="text-xs text-text-muted">{t("Usa as metas da organização.")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6">
        <Button onClick={salvar} disabled={isPending}>
          {isPending ? t("Salvando…") : t("Salvar metas")}
        </Button>
      </div>
    </Card>
  );
}
