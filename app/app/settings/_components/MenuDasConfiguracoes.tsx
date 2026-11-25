"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { usePrefetchPorIntencao } from "@/hooks/navigation/prefetchPorIntencao";
import { filtrarMenu, primeiroResultado, type GrupoDoMenu } from "@/lib/navigation/grupos-das-configuracoes";
import { MagnifyingGlass } from "@/lib/ui/icons";

/**
 * A lista do menu de Configurações: busca no topo, os cinco grupos embaixo.
 *
 * Desenhada UMA vez e montada em dois lugares — a coluna lateral (`lg+`) e a
 * folha do celular —, para o celular não ganhar uma segunda lista que diverge.
 *
 * Grupo é rótulo, não cabeçalho (`<p>` + `role="group"`): os `<h1>`/`<h2>` da
 * página são da tela aberta, e um "Atendimento" de menu competindo com eles
 * confundiria o leitor de tela e as buscas por cabeçalho.
 */
export function MenuDasConfiguracoes({
  grupos,
  ativo,
  aoNavegar,
  idDaBusca,
}: {
  grupos: readonly GrupoDoMenu[];
  /** `href` da porta acesa, ou `null` (no índice, ou numa tela sem porta própria). */
  ativo: string | null;
  /** A folha do celular fecha ao navegar. */
  aoNavegar?: () => void;
  /** Ids distintos por instância: a lateral e a folha podem coexistir no DOM. */
  idDaBusca?: string;
}) {
  const t = useT();
  const router = useRouter();
  const intencao = usePrefetchPorIntencao();
  const idGerado = useId();
  const idBase = idDaBusca ?? idGerado;
  const [termo, setTermo] = useState("");
  const filtrados = useMemo(() => filtrarMenu(grupos, termo, t), [grupos, termo, t]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <MagnifyingGlass
          size={14}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-subtle"
        />
        <Input
          type="search"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            // Enter abre o primeiro resultado: buscar e não poder ir é meio caminho.
            if (e.key !== "Enter") return;
            const primeiro = primeiroResultado(grupos, termo, t);
            if (!primeiro) return;
            e.preventDefault();
            router.push(primeiro.href);
            setTermo("");
            aoNavegar?.();
          }}
          placeholder={t("Buscar seção")}
          aria-label={t("Buscar seção")}
          aria-controls={`${idBase}-lista`}
          className="pl-8"
        />
      </div>

      <nav id={`${idBase}-lista`} aria-label={t("Configurações")} className="flex flex-col gap-4">
        {filtrados.length === 0 ? (
          <p role="status" className="px-2 text-sm text-text-muted">
            {t("Nenhum resultado")}
          </p>
        ) : (
          filtrados.map(({ grupo, itens }) => (
            <div key={grupo.id} role="group" aria-labelledby={`${idBase}-${grupo.id}`}>
              <p id={`${idBase}-${grupo.id}`} className="px-2 pb-1 text-xs font-medium text-text-subtle">
                {t(grupo.label)}
              </p>
              <ul className="flex flex-col gap-px">
                {itens.map((item) => {
                  const Icone = item.icon;
                  const aceso = item.href === ativo;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        {...intencao(item.href)}
                        onClick={() => {
                          setTermo("");
                          aoNavegar?.();
                        }}
                        aria-current={aceso ? "page" : undefined}
                        data-ativo={aceso ? "" : undefined}
                        className={[
                          "flex min-h-11 items-center gap-2 rounded-md px-2 text-sm transition-colors duration-fast lg:min-h-8",
                          "focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden",
                          aceso
                            ? "bg-pressed font-medium text-text"
                            : "text-text-muted hover:bg-hover hover:text-text",
                        ].join(" ")}
                      >
                        <Icone size={16} aria-hidden className="shrink-0" />
                        <span className="truncate">{t(item.label)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
