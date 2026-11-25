"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useT } from "@/hooks/i18n/useT";
import { portaAtiva } from "@/lib/navigation/grupos-das-configuracoes";
import { CaretDown } from "@/lib/ui/icons";

import { MenuDasConfiguracoes } from "./MenuDasConfiguracoes";
import { useMenuDasConfiguracoes } from "./useMenuDasConfiguracoes";

/** O índice: ali o resumo já é o menu inteiro, com descrição. */
const INDICE = "/app/settings";

/**
 * A casca de TODA tela de Configurações: menu à esquerda, a tela à direita.
 *
 * ─── Por que o índice não ganha a coluna ────────────────────────────────────
 *
 * Em `/app/settings` o conteúdo É o menu (o resumo, com a frase de cada tela).
 * Pôr a coluna ao lado repetiria cada porta duas vezes na mesma tela — e o
 * leitor de tela leria a lista duas vezes.
 *
 * ─── O "← Voltar para Configurações" ────────────────────────────────────────
 *
 * Cada subtela desenha o caminho de volta por `CabecalhoDaSubTela`, e a cerca
 * `volta-das-subtelas-de-configuracoes` cobra que continue desenhando: é a rede
 * para a tela que um dia rodar fora desta casca. Dentro dela o menu já é o
 * caminho, então ele é escondido AQUI, pelo `data-testid` do componente — sem
 * editar as dezenas de páginas.
 */
export function PainelDasConfiguracoes({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = usePathname() ?? INDICE;
  const grupos = useMenuDasConfiguracoes();
  const itens = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  const ativo = portaAtiva(pathname, itens);
  const atual = itens.find((d) => d.href === ativo);
  const [folhaAberta, setFolhaAberta] = useState(false);

  // Voltar/avançar do navegador também troca de tela: a folha não fica aberta
  // por cima. Ajuste durante o render, não em efeito (sem pintura intermediária).
  const [caminhoDaFolha, setCaminhoDaFolha] = useState(pathname);
  if (caminhoDaFolha !== pathname) {
    setCaminhoDaFolha(pathname);
    setFolhaAberta(false);
  }

  if (pathname === INDICE) return <>{children}</>;

  return (
    <div className="lg:flex lg:items-start lg:gap-8" data-testid="configuracoes-com-menu">
      <aside
        aria-label={t("Configurações")}
        className="hidden w-60 shrink-0 lg:sticky lg:top-0 lg:block lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:border-r lg:border-border lg:pr-4"
      >
        <MenuDasConfiguracoes grupos={grupos} ativo={ativo} idDaBusca="menu-configuracoes-lateral" />
      </aside>

      <div className="mb-4 lg:hidden">
        <Sheet open={folhaAberta} onOpenChange={setFolhaAberta}>
          <SheetTrigger asChild>
            <button
              type="button"
              data-testid="seletor-das-configuracoes"
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 text-left transition-colors duration-fast hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden"
            >
              <span className="min-w-0">
                <span className="block text-xs text-text-subtle">{t("Configurações")}</span>
                <span className="block truncate text-sm font-medium text-text">
                  {atual ? t(atual.label) : t("Configurações")}
                </span>
              </span>
              <CaretDown size={16} aria-hidden className="shrink-0 text-text-muted" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            className="max-h-[85dvh] overflow-y-auto rounded-t-xl p-4 pb-area-segura"
          >
            <SheetTitle className="mb-3 pr-10">{t("Configurações")}</SheetTitle>
            <MenuDasConfiguracoes
              grupos={grupos}
              ativo={ativo}
              aoNavegar={() => setFolhaAberta(false)}
              idDaBusca="menu-configuracoes-folha"
            />
          </SheetContent>
        </Sheet>
      </div>

      <div className="min-w-0 flex-1 [&_[data-testid=voltar-para-configuracoes]]:hidden">{children}</div>
    </div>
  );
}
