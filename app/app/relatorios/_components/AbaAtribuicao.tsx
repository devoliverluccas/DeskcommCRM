"use client";

/**
 * Aba "Atribuição" (3.6): os links rastreáveis no período — cliques, quantos
 * viraram contato, negócios, ganhos e conversões enviadas à plataforma de
 * anúncio. Só quem gerencia (a rota cobra `manager`).
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { CABECALHO_DE_CARTAO, TituloDeSecao } from "@/app/app/metrics/_components/Secao";
import type { JanelaDaResposta, LinhaDeAtribuicao } from "@/app/api/v1/relatorios/_tipos";

import type { Periodo } from "../_lib/periodo";
import { BotaoCsv, Carregando, ErroDaAba } from "./comum";

const CELULA = "text-right tabular-nums";

export function AbaAtribuicao({ periodo }: { periodo: Periodo }) {
  const t = useT();
  const consulta = useQuery({
    queryKey: ["relatorios", "atribuicao", periodo.de, periodo.ate],
    queryFn: () =>
      apiClient.get<{ data: { janela: JanelaDaResposta; links: LinhaDeAtribuicao[] } }>(
        `/api/v1/relatorios/atribuicao?de=${periodo.de}&ate=${periodo.ate}`,
      ),
  });

  if (consulta.isLoading) return <Carregando />;
  if (consulta.isError || !consulta.data) return <ErroDaAba tentar={() => void consulta.refetch()} />;
  const links = consulta.data.data.links;
  const nome = (l: LinhaDeAtribuicao) => (l.link_id ? (l.nome ?? t("Link removido")) : t("Página de captura (sem link)"));
  const taxa = (parte: number, todo: number) => (todo > 0 ? `${Math.round((parte / todo) * 100)}%` : "—");
  const cabecalho = [t("Link"), t("Cliques"), t("Viraram contato"), t("Negócios"), t("Ganhos"), t("Conversões enviadas")];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <p className="max-w-3xl text-xs text-text-muted">
        {t(
          "Cliques nos links rastreáveis no período. Um clique vira contato quando o cliente manda a mensagem com o código do link.",
        )}
      </p>
      <Card>
        <TituloDeSecao
          className={CABECALHO_DE_CARTAO}
          titulo={t("Links rastreáveis")}
          contagem={links.length}
          acao={
            <BotaoCsv
              nome={`atribuicao-${periodo.de}-${periodo.ate}`}
              cabecalho={cabecalho}
              linhas={links.map((l) => [nome(l), l.cliques, l.contatos, l.negocios, l.ganhos, l.conversoes])}
            />
          }
        />
        {links.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6">
            <p className="text-sm text-text-muted">{t("Nenhum clique em link rastreável no período.")}</p>
            <Link
              href="/app/settings/conversoes?aba=links"
              className="inline-flex h-11 items-center text-sm underline underline-offset-4 lg:h-8"
            >
              {t("Criar um link rastreável")}
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {cabecalho.map((c, i) => (
                    <TableHead key={c} className={i === 0 ? "pl-4" : `text-right ${i === cabecalho.length - 1 ? "pr-4" : ""}`}>
                      {c}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l) => (
                  <TableRow key={l.link_id ?? "sem-link"}>
                    <TableCell className="pl-4 font-medium">{nome(l)}</TableCell>
                    <TableCell className={CELULA}>{l.cliques}</TableCell>
                    <TableCell className={CELULA}>
                      {l.contatos} <span className="text-xs text-text-muted">({taxa(l.contatos, l.cliques)})</span>
                    </TableCell>
                    <TableCell className={CELULA}>{l.negocios}</TableCell>
                    <TableCell className={CELULA}>{l.ganhos}</TableCell>
                    <TableCell className={`${CELULA} pr-4`}>{l.conversoes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
