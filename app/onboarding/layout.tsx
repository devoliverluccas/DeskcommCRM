import { redirect } from "next/navigation";

import { exigirProvaDeMfa, requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { ProgressoCompacto, Stepper } from "./_components/Stepper";
import { OutrasOrganizacoes } from "./_components/OutrasOrganizacoes";
import { SkipToEnd } from "./_components/SkipToEnd";
import { SimboloDoProduto } from "@/components/branding/MarcaDoProduto";
import { marcaEhADoProduto } from "@/lib/branding";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";
import { ICONE_DESENHADO, iconeDaAba } from "@/lib/branding/icone";
import { marcaDaSaida } from "@/lib/branding/saida";
import { baseDoStorage } from "@/lib/branding/logo";
import { passosVisiveis } from "@/lib/onboarding/passos";
import { env } from "@/lib/env";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  // Acompanhamento observa a organização incompleta no shell com saída explícita.
  if (user.support) redirect("/app/inbox");
  // Sem organização o onboarding não tem o que mostrar — mas mandar para
  // `/login` fechava o círculo: quem entrasse de novo voltaria para cá. A saída
  // é a tela que CRIA a organização que falta.
  if (!activeOrg) redirect("/get-started");

  const { state, onboardedAt } = await loadOnboardingState(activeOrg.orgId);
  if (onboardedAt) redirect("/app/inbox");
  // A mesma regra de sessão do layout de `/app`: quem tem fator prova antes do
  // wizard. Depois dos redirects, para só quem vai VER o wizard pagar a leitura.
  await exigirProvaDeMfa();

  // Os passos que ESTA instalação oferece, com o que já foi resolvido. O
  // indicador não decide mais nada sozinho — ele desenha o que recebe.
  const passos = passosVisiveis({ lojaLigada: env.NUVEMSHOP_ENABLED }).map((p) => ({
    segmento: p.segmento,
    rotulo: p.rotulo,
    cumprido: p.cumprido(state),
  }));

  const isDev = process.env.NODE_ENV !== "production";
  // Ícone pequeno de REFORÇO, nunca o logotipo completo: o nome já é escrito
  // como legenda ao lado (`marca.name`), então usar o logo inteiro aqui duplica
  // a marca em dois formatos ao mesmo tempo. `iconeDaAba` é a mesma resolução
  // de `app/icon.tsx` — arquivo subido em Marca › ícone da aba, com fallback
  // para o ladrilho desenhado quando não há upload.
  //
  // Sem ícone subido e sem marca própria, o `/icon` desenharia o símbolo do
  // produto num PNG sempre claro. Aí vale o SVG inline, que acompanha o tema:
  // a marca padrão não muda de cara. A condição é a MESMA de `app/icon.tsx`
  // (`marcaDaSaida(null)`, banco acima do `.env`). Nenhuma das duas lança.
  const linhaDaMarca = await marcaDaInstalacao();
  const iconeUrl = iconeDaAba(linhaDaMarca?.favicon_path, baseDoStorage());
  const marcaDoIcone = await marcaDaSaida(null);
  const simboloDoProduto =
    iconeUrl === ICONE_DESENHADO &&
    marcaEhADoProduto({ name: marcaDoIcone.nome, logoUrl: marcaDoIcone.logoUrl });

  return (
    <IdiomaProvider locale={user.idioma}>
      <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/*
          O PRIMEIRO <header> do DOM, com o nome da organização — é o que
          `wizard-do-funcionario.spec.ts` lê. Uma árvore só para os dois
          tamanhos, para nenhum `data-testid` existir duas vezes:
          - abaixo de `lg`, faixa no topo: marca | saída, e o progresso embaixo;
          - de `lg` para cima, trilho lateral fixo: marca, passos, saída no pé.
        */}
        <header data-theme="dark" className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-bg lg:h-dvh lg:self-start lg:grid-cols-1 lg:grid-rows-[auto_minmax(0,1fr)_auto] lg:items-stretch lg:border-b-0">
          <div className="flex min-w-0 items-center gap-3 px-4 py-3 lg:px-6 lg:pb-8 lg:pt-7">
            {/* O nome está escrito logo abaixo — o símbolo é reforço, não legenda. */}
            {simboloDoProduto ? (
              <SimboloDoProduto nome={marcaDoIcone.nome} decorativo className="h-8 w-8 shrink-0" />
            ) : (
              // <img> em vez de next/image de propósito, mesmo motivo de
              // `components/shell/Sidebar.tsx`: a URL vem de quem hospeda (banco),
              // fora da allowlist de domínios fechada no build da imagem pré-buildada.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconeUrl}
                alt=""
                aria-hidden
                decoding="async"
                className="h-8 w-8 shrink-0 rounded-md object-contain"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-xs text-text-muted">{marcaDoIcone.nome}</p>
              <h1 className="truncate text-sm font-semibold tracking-tight text-text">{activeOrg.name}</h1>
            </div>
          </div>

          {/*
            A SAÍDA, para quem tem outra organização. Ver o cabeçalho de
            `OutrasOrganizacoes`: sem ela, trocar de organização pelo seletor
            do topo levava a um wizard sem porta de volta — o layout de `/app`
            sai da árvore e leva o `TenantSwitcher` junto.
          */}
          <div className="flex items-center gap-1 pr-2 lg:col-start-1 lg:row-start-3 lg:flex-col lg:items-stretch lg:gap-0.5 lg:px-3 lg:py-4 empty:hidden">
            <OutrasOrganizacoes
              outras={user.organizations
                .filter((o) => o.organization_id !== activeOrg.orgId)
                .map((o) => ({ id: o.organization_id, nome: o.organization_name }))}
            />
            {isDev ? <SkipToEnd /> : null}
          </div>

          <div className="col-span-2 lg:hidden">
            <ProgressoCompacto passos={passos} />
          </div>

          <nav className="hidden lg:col-start-1 lg:row-start-2 lg:block lg:overflow-y-auto lg:px-3">
            <Stepper passos={passos} />
          </nav>
        </header>

        {/*
          O painel de conteúdo: o mesmo branco destacado da casca do app
          (`data-casca="conteudo"` faz `bg-bg` virar superfície aqui dentro).
        */}
        <main
          data-casca="conteudo"
          className="bg-surface px-4 pb-16 pt-8 sm:px-8 lg:my-2 lg:mr-2 lg:min-h-[calc(100dvh-1rem)] lg:rounded-xl lg:border lg:border-border lg:px-12 lg:pt-14"
        >
          <div className="mx-auto w-full max-w-2xl">{children}</div>
        </main>
      </div>
    </IdiomaProvider>
  );
}
