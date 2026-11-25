"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { useT } from "@/hooks/i18n/useT";
import { usePrefetchPorIntencao } from "@/hooks/navigation/prefetchPorIntencao";
import { filtrarMenu, primeiroResultado } from "@/lib/navigation/grupos-das-configuracoes";
import { MagnifyingGlass } from "@/lib/ui/icons";

import { useMenuDasConfiguracoes } from "./useMenuDasConfiguracoes";

/**
 * `/app/settings` sem subcaminho: o RESUMO.
 *
 * Decidido contra "abrir a primeira seção": quem chega aqui pelo menu ainda
 * não sabe o que procura, e a frase de cada tela é o que responde "onde se
 * muda isto?". No celular ele é também a lista que o seletor abriria.
 *
 * Mesmas portas e mesmos grupos do menu lateral (`useMenuDasConfiguracoes`) —
 * o resumo é o menu com descrição, não uma segunda lista.
 */
export function ResumoDasConfiguracoes() {
  const t = useT();
  const router = useRouter();
  const intencao = usePrefetchPorIntencao();
  const grupos = useMenuDasConfiguracoes();
  const [termo, setTermo] = useState("");
  const filtrados = useMemo(() => filtrarMenu(grupos, termo, t), [grupos, termo, t]);

  return (
    <div className="flex flex-col gap-6 p-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("Configurações")}</h1>
          <p className="text-sm text-text-muted">
            {t("Sua conta, os dados da empresa e quem tem acesso ao quê.")}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
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
              if (e.key !== "Enter") return;
              const primeiro = primeiroResultado(grupos, termo, t);
              if (!primeiro) return;
              e.preventDefault();
              router.push(primeiro.href);
            }}
            placeholder={t("Buscar seção")}
            aria-label={t("Buscar seção")}
            className="pl-8"
          />
        </div>
      </header>

      {filtrados.length === 0 ? (
        <p role="status" className="text-sm text-text-muted">
          {t("Nenhum resultado")}
        </p>
      ) : (
        filtrados.map(({ grupo, itens }) => (
          <section key={grupo.id} aria-labelledby={`resumo-configuracoes-${grupo.id}`} className="space-y-2">
            <h2 id={`resumo-configuracoes-${grupo.id}`} className="text-xs font-medium text-text-subtle">
              {t(grupo.label)}
            </h2>
            {/* Índice é lista, não mural: linhas em coluna, a borda só no ícone. */}
            <div className="-mx-2 grid grid-cols-1 gap-x-2 gap-y-px md:grid-cols-2 xl:grid-cols-3">
              {itens.map((item) => {
                const Icone = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    {...intencao(item.href)}
                    className="group flex min-h-11 gap-3 rounded-md p-2 transition-colors duration-fast hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-hidden"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors duration-fast group-hover:text-text">
                      <Icone size={16} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text">{t(item.label)}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-text-muted">
                        {t(item.description)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
