"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/hooks/i18n/useT";
import { DotsThree } from "@/lib/ui/icons";

/** Uma ação que no celular se recolhe ao "⋯". Já traduzida por quem chama. */
export interface AcaoSecundaria {
  label: string;
  icon?: PhosphorIcon;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  /** Vai só no botão (`md+`): o item do menu existe só com o menu aberto. */
  testId?: string;
  /** Vira um botão com menu (`md+`) e itens soltos no "⋯" do celular. */
  items?: { label: string; onSelect: () => void }[];
}

interface Props {
  title: string;
  subtitle?: ReactNode;
  /** Ação primária e as que aparecem em toda largura. */
  actions?: ReactNode;
  secondaryActions?: AcaoSecundaria[];
}

/**
 * Cabeçalho de página: título, subtítulo e ações numa faixa que quebra sem
 * espremer o título (nada de `shrink-0` na fila de ações; título com `min-w-0`).
 * De `md` para cima as secundárias são botões; abaixo, um "⋯" de 44px, para a
 * primária ficar sozinha antes do primeiro dado.
 */
export function PageHeader({ title, subtitle, actions, secondaryActions = [] }: Props) {
  const t = useT();
  const temSecundarias = secondaryActions.length > 0;

  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="text-xl font-semibold tracking-tight break-words text-text">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-text-muted">{subtitle}</div> : null}
      </div>
      {(actions || temSecundarias) && (
        <div className="flex flex-wrap items-center gap-2">
          {secondaryActions.map((acao) => (
            <BotaoSecundario key={acao.label} acao={acao} />
          ))}
          {actions}
          {temSecundarias && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="md:hidden"
                  aria-label={t("Mais ações")}
                >
                  <DotsThree size={20} weight="bold" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {secondaryActions.map((acao, i) =>
                  acao.items ? (
                    <Fragment key={acao.label}>
                      {i > 0 && <DropdownMenuSeparator />}
                      {acao.items.map((item) => (
                        <DropdownMenuItem
                          key={item.label}
                          disabled={acao.disabled}
                          className="min-h-11"
                          onSelect={item.onSelect}
                        >
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                    </Fragment>
                  ) : (
                    <ItemDoMenu key={acao.label} acao={acao} />
                  ),
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </header>
  );
}

function BotaoSecundario({ acao }: { acao: AcaoSecundaria }) {
  const Icone = acao.icon;
  const conteudo = (
    <>
      {Icone && <Icone size={16} weight="bold" aria-hidden />}
      <span>{acao.label}</span>
    </>
  );
  const classe = "max-md:hidden";

  if (acao.items) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            className={classe}
            disabled={acao.disabled}
            data-testid={acao.testId}
          >
            {conteudo}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {acao.items.map((item) => (
            <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (acao.href && !acao.disabled) {
    return (
      <Button variant="secondary" className={classe} asChild>
        <Link href={acao.href} data-testid={acao.testId}>
          {conteudo}
        </Link>
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      className={classe}
      disabled={acao.disabled}
      data-testid={acao.testId}
      onClick={acao.onSelect}
    >
      {conteudo}
    </Button>
  );
}

function ItemDoMenu({ acao }: { acao: AcaoSecundaria }) {
  const Icone = acao.icon;
  const conteudo = (
    <>
      {Icone && <Icone size={16} weight="bold" aria-hidden className="mr-2" />}
      {acao.label}
    </>
  );
  if (acao.href && !acao.disabled) {
    return (
      <DropdownMenuItem asChild className="min-h-11">
        <Link href={acao.href}>{conteudo}</Link>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem disabled={acao.disabled} className="min-h-11" onSelect={acao.onSelect}>
      {conteudo}
    </DropdownMenuItem>
  );
}
