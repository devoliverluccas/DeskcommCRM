"use client";

/**
 * MONITORAMENTO (3.5): a fila de cada setor e quem está atendendo, em cima das
 * colunas do Painel. Atualiza sozinho a cada 30 s, como o resto do Painel
 * (que também sonda; não há canal de tempo real aqui).
 *
 * As contas moram em `./contas-do-monitoramento.ts`; os números vêm das rotas que o Inbox
 * e a Equipe já usam — nenhuma régua nova de "quem espera".
 *
 * Operadores é de quem GERENCIA: o roster existe para agent+ (o roteamento lê),
 * mas carga por pessoa é régua de gestão, e o atendente não precisa ver a
 * carteira do colega para trabalhar.
 */

import { useQueries, useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useSectors } from "@/hooks/team/useSectors";
import { apiClient } from "@/lib/api/client";
import { haQuantoTempo } from "@/lib/inbox/painel-de-atendimento";
import { rotuloDoMembro } from "@/lib/users/rotulo-do-atendente";

import { linhaDaFila, operadoresDoPainel, type ContagemDaFila, type OperadorDoRoster } from "./contas-do-monitoramento";

const A_CADA = 30_000;

function urlDaContagem(numero: string, setor?: string): string {
  const qs = new URLSearchParams();
  if (numero) qs.set("channel_session_id", numero);
  if (setor) qs.set("sector_id", setor);
  const s = qs.toString();
  return `/api/v1/conversations/counts${s ? `?${s}` : ""}`;
}

function LinhaDeSetor({
  nome,
  contagem,
  carregando,
  destaque,
}: {
  nome: string;
  contagem: ContagemDaFila | undefined;
  carregando: boolean;
  destaque?: boolean;
}) {
  const linha = linhaDaFila(contagem);
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className={`py-2 pr-3 text-left text-sm ${destaque ? "font-semibold" : "font-medium"}`}>
        {nome}
      </th>
      <td className="py-2 pr-3 text-right text-sm tabular-nums">
        {carregando ? "…" : (
          <span className={linha.naFila > 0 ? "rounded-sm bg-error-bg px-1.5 font-semibold text-error-fg" : ""}>
            {linha.naFila}
          </span>
        )}
      </td>
      <td className="py-2 pr-3 text-right text-xs tabular-nums text-text-muted">
        {carregando ? "…" : linha.esperaDesde ? haQuantoTempo(linha.esperaDesde) : "—"}
      </td>
      <td className="py-2 text-right text-sm tabular-nums">{carregando ? "…" : linha.emAtendimento}</td>
    </tr>
  );
}

function FilaPorSetor({ numero }: { numero: string }) {
  const t = useT();
  // Módulo de setores desligado: nem pergunta (a rota responderia 404) e sobra
  // a linha do total, que é a fila inteira.
  const { activeOrg } = useAuth();
  const setores = useSectors((activeOrg?.modulos_ligados ?? []).includes("setores"));
  const lista = setores.data?.data ?? [];

  const total = useQuery({
    queryKey: ["painel-monitoramento", "fila", numero, "total"],
    queryFn: () => apiClient.get<{ data: ContagemDaFila }>(urlDaContagem(numero)),
    refetchInterval: A_CADA,
  });
  const porSetor = useQueries({
    queries: lista.map((s) => ({
      queryKey: ["painel-monitoramento", "fila", numero, s.id],
      queryFn: () => apiClient.get<{ data: ContagemDaFila }>(urlDaContagem(numero, s.id)),
      refetchInterval: A_CADA,
    })),
  });

  return (
    <section className="flex min-w-0 flex-col" data-testid="painel-fila-por-setor">
      <header className="flex items-baseline gap-2 border-b border-border-strong px-1 pb-2.5">
        <h2 className="text-sm font-semibold">{t("Fila por setor")}</h2>
      </header>
      {total.isError ? (
        <p className="px-1 py-3 text-sm text-error-fg">{t("Não deu para carregar as conversas agora.")}</p>
      ) : (
        <div className="overflow-x-auto px-1">
          <table className="w-full min-w-[22rem]">
            <thead>
              <tr className="text-xs text-text-muted">
                <th scope="col" className="py-2 pr-3 text-left font-normal">{t("Setor")}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t("Na fila")}</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">{t("Espera da mais antiga")}</th>
                <th scope="col" className="py-2 text-right font-normal">{t("Em atendimento")}</th>
              </tr>
            </thead>
            <tbody>
              <LinhaDeSetor
                nome={t("Todos os setores")}
                contagem={total.data?.data}
                carregando={total.isLoading}
                destaque
              />
              {lista.map((s, i) => (
                <LinhaDeSetor
                  key={s.id}
                  nome={s.name}
                  contagem={porSetor[i]?.data?.data}
                  carregando={porSetor[i]?.isLoading ?? true}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Operadores() {
  const t = useT();
  const roster = useQuery({
    queryKey: ["painel-monitoramento", "operadores"],
    queryFn: () => apiClient.get<{ data: OperadorDoRoster[] }>("/api/v1/attendants/availability"),
    refetchInterval: A_CADA,
  });
  const operadores = operadoresDoPainel(roster.data?.data ?? []);
  const online = operadores.filter((o) => o.present).length;

  return (
    <section className="flex min-w-0 flex-col" data-testid="painel-operadores">
      <header className="flex items-baseline gap-2 border-b border-border-strong px-1 pb-2.5">
        <h2 className="text-sm font-semibold">{t("Operadores")}</h2>
        {roster.isSuccess && (
          <span className="text-sm tabular-nums text-text-muted">
            {online}/{operadores.length} {t("online")}
          </span>
        )}
      </header>
      {roster.isError ? (
        <p className="px-1 py-3 text-sm text-error-fg">{t("Não deu para carregar a equipe agora.")}</p>
      ) : roster.isLoading ? (
        <p className="px-1 py-3 text-sm text-text-muted">…</p>
      ) : operadores.length === 0 ? (
        <p className="px-1 py-3 text-sm text-text-muted">{t("Ninguém na equipe de atendimento.")}</p>
      ) : (
        <ul className="flex flex-col">
          {operadores.map((o) => (
            <li
              key={o.user_id}
              className="flex min-h-11 items-center gap-3 border-b border-border px-1 last:border-0 lg:min-h-9"
            >
              <span
                aria-hidden
                className={`size-2 shrink-0 rounded-full ${o.present ? "bg-success-fg" : "bg-border-strong"}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {rotuloDoMembro({ full_name: o.name, email: o.email, user_id: o.user_id }, t)}
              </span>
              <span className={`shrink-0 text-xs ${o.present ? "text-success-fg" : "text-text-subtle"}`}>
                {o.present ? t("Online") : t("Offline")}
              </span>
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-text-muted">
                {o.current_load} {o.current_load === 1 ? t("conversa aberta") : t("conversas abertas")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Monitoramento({ numero, verOperadores }: { numero: string; verOperadores: boolean }) {
  return (
    <div
      className={`grid shrink-0 grid-cols-1 gap-8 md:max-h-64 md:gap-6 md:overflow-y-auto ${
        verOperadores ? "md:grid-cols-2" : ""
      }`}
      data-testid="painel-monitoramento"
    >
      <FilaPorSetor numero={numero} />
      {verOperadores && <Operadores />}
    </div>
  );
}
