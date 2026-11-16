"use client";
import { usePathname } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react";
import { useT } from "@/hooks/i18n/useT";
import { NAV_DESTINATIONS, NAV_GROUPS } from "@/lib/navigation/registry";
import { AlertsBell } from "./AlertsBell";
import { AvisoDePropostaEmDestaque } from "./AvisoDePropostaEmDestaque";
import { MobileSidebar } from "./MobileSidebar";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { SearchTrigger } from "./SearchTrigger";

/**
 * Onde a pessoa está: "Grupo › Tela", tirado do MESMO catálogo que desenha o
 * menu — o destino cujo `href` é o prefixo mais longo do caminho atual. Tela
 * fora do catálogo não ganha trilha (nada é inventado a partir da URL).
 */
function Trilha() {
  // O quadro de um funil mora em `/app/pipelines/[id]`, mas a porta dele no
  // catálogo é "Funis" (`/app/kanban`): sem esta ponte a tela mais usada do CRM
  // ficava sem trilha.
  const pathname = (usePathname() ?? "").replace(/^\/app\/pipelines(\/|$)/, "/app/kanban$1");
  const t = useT();
  const destino = NAV_DESTINATIONS.filter(
    (d) => pathname === d.href || pathname.startsWith(d.href + "/"),
  ).sort((a, b) => b.href.length - a.href.length)[0];
  if (!destino) return null;
  const grupo = NAV_GROUPS.find((g) => g.id === destino.group);
  return (
    <nav aria-label={t("Você está em")} className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
      {grupo && (
        <>
          <span className="shrink-0 text-text-subtle">{t(grupo.label)}</span>
          <CaretRight size={10} weight="bold" aria-hidden className="shrink-0 text-text-subtle" />
        </>
      )}
      <span className="truncate font-medium text-text">{t(destino.label)}</span>
    </nav>
  );
}

export function TopBar() {
  return (
    <header className="sticky top-[var(--faixas-de-cima,0px)] z-20 flex h-14 items-center justify-between gap-2 border-b bg-background px-3 md:gap-4 md:bg-surface md:px-4" data-casca="topo">
      <div className="flex min-w-0 items-center gap-3">
        <MobileSidebar />
        <TenantSwitcher />
        <Trilha />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SearchTrigger />
        <AlertsBell />
        <AvisoDePropostaEmDestaque />
        <UserMenu />
      </div>
    </header>
  );
}
