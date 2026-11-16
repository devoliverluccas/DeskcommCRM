"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAtritoMetrics, useSalvarReguaAbandono } from "@/hooks/metrics/useAtritoMetrics";
import { formatarMedida, type Medida, type Par } from "@/lib/metrics/atrito";
import { TituloDeSecao } from "./Secao";

/**
 * Índice de Atrito (spec 17) — a medida do PROPÓSITO.
 *
 * Desenho imposto pela doutrina §3.3: eficiência e dano ficam no MESMO bloco,
 * lado a lado. Não é preferência estética — separados (abas, seções, telas), a
 * métrica de eficiência vence sempre, porque é a que sobe e a que alguém pede
 * para ver. O tipo `Par` torna impossível renderizar uma eficiência sozinha.
 *
 * Fica ACIMA do funil e da performance por atendente de propósito (§3.6): é o
 * número que pertence ao sistema inteiro, e ao qual as métricas de área se
 * subordinam. Embaixo, viraria rodapé.
 */

function MedidaLinha({ m }: { m: Medida }) {
  // Os rótulos do Atrito nascem em `lib/metrics/atrito.ts`, que é lógica pura e
  // não conhece idioma. Traduzir no PONTO DE RENDERIZAÇÃO é o padrão adotado no
  // resto do produto: o texto fixo casa no dicionário, e o que traz número
  // interpolado degrada para português sem quebrar nada.
  const t = useT();
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm md:truncate">{t(m.rotulo)}</p>
        {m.nota ? <p className="mt-0.5 text-xs text-text-subtle">{t(m.nota)}</p> : null}
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{formatarMedida(m)}</span>
    </li>
  );
}

function ParCard({ par }: { par: Par }) {
  const t = useT();
  return (
    // Uma linha só: o número da eficiência à esquerda, o custo dele à direita.
    // Em tela estreita o custo desce, mas continua no mesmo bloco.
    <div className="grid gap-4 py-5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-10">
      {/* Eficiência — o que o sistema é empurrado a maximizar. */}
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{t(par.titulo)}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
          {formatarMedida(par.eficiencia)}
        </p>
        <p className="mt-1 text-sm">{t(par.eficiencia.rotulo)}</p>
        {par.eficiencia.nota ? (
          <p className="mt-1 text-xs text-text-subtle">{t(par.eficiencia.nota)}</p>
        ) : null}
      </div>

      {/* O custo disso. Mesmo bloco, sempre. */}
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{t("O que isso custou")}</p>
        <ul className="mt-1 divide-y divide-border">
          {par.danos.map((d) => (
            <MedidaLinha key={d.chave} m={d} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * A régua do abandono, VISÍVEL e editável ao lado do número que ela governa
 * (invariante 6: ver + mudar + falha visível; e cap. 3.4 regra 4: a régua viaja
 * com o número). Só manager+ edita — redefinir o que conta como perda é decisão
 * de quem responde pelo resultado, não de quem opera.
 */
function ReguaAbandono({ horas, padrao, podeEditar }: { horas: number; padrao: number; podeEditar: boolean }) {
  const t = useT();
  const [valor, setValor] = useState(String(horas));
  const salvar = useSalvarReguaAbandono();
  const n = Number(valor);
  const valido = Number.isInteger(n) && n >= 1 && n <= 24 * 90;
  const sujo = String(horas) !== valor.trim();

  if (!podeEditar) {
    return (
      <p className="text-xs text-text-muted">
        {t("Uma conversa conta como perdida no silêncio após")} <strong>{horas}h</strong>{" "}
        {t("sem resposta")}
        {horas === padrao ? ` ${t("(padrão do sistema)")}` : ""}.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <span>{t("Contar como perdida no silêncio após")}</span>
      <Input
        className="h-7 w-20 text-xs"
        value={valor}
        inputMode="numeric"
        aria-label={t("Horas de silêncio até considerar a conversa perdida")}
        onChange={(e) => setValor(e.target.value)}
      />
      <span>{t("horas sem resposta.")}</span>
      {sujo ? (
        <Button
          size="sm"
          variant="outline"
          className="md:h-7"
          disabled={!valido || salvar.isPending}
          onClick={() => salvar.mutate(n)}
        >
          {salvar.isPending ? t("Salvando…") : t("Salvar")}
        </Button>
      ) : null}
      {sujo && !valido ? (
        <span className="text-error-fg">{t("Use um número inteiro entre 1 e 2160.")}</span>
      ) : null}
      {/* Falha VISÍVEL: sem isto, um erro de escrita deixaria a tela mostrando o
          valor digitado como se tivesse sido salvo. */}
      {salvar.isError ? (
        <span className="text-error-fg">{t("Não foi possível salvar. Tente de novo.")}</span>
      ) : null}
      {horas === padrao && !sujo ? <span>{t("(padrão do sistema)")}</span> : null}
    </div>
  );
}

export function AtritoPanel({ podeEditarRegua }: { podeEditarRegua: boolean }) {
  const t = useT();
  const { data, isLoading, isError } = useAtritoMetrics();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label={t("Carregando o índice de atrito…")}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  // Falha aberta na informação: dizer que não carregou é melhor que sumir com a
  // seção — seção ausente lê-se como "não há atrito" (doutrina cap. 4.5).
  if (isError || !data) {
    return <p className="text-sm text-error-fg">{t("Erro ao carregar o índice de atrito.")}</p>;
  }

  const { escopo, pares, regua } = data.data;
  const temMedidaAusente = pares.some(
    (p) => p.eficiencia.valor === null || p.danos.some((d) => d.valor === null),
  );

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <TituloDeSecao
          titulo={t("Atrito")}
          descricao={
            <>
              {t("O que o resultado custou para os dois lados.")}{" "}
              {escopo.demandas === 0 ? (
                <>{t("Nenhuma demanda encerrada no período — os números abaixo ainda não têm base.")}</>
              ) : (
                <>
                  {t("Base:")} {escopo.demandas}{" "}
                  {escopo.demandas === 1 ? t("demanda encerrada") : t("demandas encerradas")}{" "}
                  {t("nos últimos 30 dias, e")} {escopo.demandas_abertas} {t("ainda abertas.")}
                </>
              )}
            </>
          }
        />
        {/* A régua fica AQUI, no cabeçalho, e não no rodapé da seção: o rótulo
            do dano interpola as horas ("após 72h") e quem lê o número precisa
            enxergar de onde ele veio sem rolar a tela (cap. 3.4, regra 4). */}
        <ReguaAbandono
          horas={regua.abandono_horas}
          padrao={regua.default}
          podeEditar={podeEditarRegua}
        />
      </div>

      <div className="flex flex-col divide-y divide-border">
        {pares.map((p) => (
          <ParCard key={p.chave} par={p} />
        ))}
      </div>

      {/* A legenda só existe se houver o que legendar. Explicar um símbolo que
          não está na tela é ruído, e ruído compete com o que importava. */}
      {temMedidaAusente ? (
        <p className="text-xs text-text-subtle">
          {t('"—" significa que não houve dado suficiente para medir, e não que o valor seja zero.')}
        </p>
      ) : null}
    </section>
  );
}
