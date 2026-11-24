"use client";

import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { useT } from "@/hooks/i18n/useT";
import { useAttendants, useUpdateAvailability } from "@/hooks/team/useAttendants";
import { roleAtLeast } from "@/lib/auth/types";
import { cn } from "@/lib/utils";

/**
 * "● Online / ○ Offline" no rodapé do menu: a chave de plantão da PRÓPRIA pessoa.
 *
 * É a mesma chave da tela Equipe (`is_available`, `PATCH
 * /api/v1/attendants/availability/[user_id]`), pelos mesmos hooks e pela mesma
 * chave de cache — ligar aqui aparece lá, e o contrário. Ela diz a INTENÇÃO
 * ("estou atendendo"); a jornada publicada continua limitando o plantão no
 * roteador (`estaDePlantao`), e a presença do navegador é outra coisa.
 *
 * Só para quem atende (agent+): é o piso da rota que grava. Recolhido o menu
 * (64px), vira só a bolinha, com o estado no `title`.
 */
export function SeletorDeStatus({ collapsed }: { collapsed: boolean }) {
  const { activeOrg } = useAuth();
  // O menu também é desenhado sem cliente de consultas (prévias da marca, testes
  // do menu). Um controle opcional do rodapé não pode derrubar o menu inteiro:
  // sem cliente, ele simplesmente não aparece.
  const temCliente = useContext(QueryClientContext) !== undefined;
  if (!temCliente || !roleAtLeast(activeOrg?.role, "agent")) return null;
  return <SeletorDeQuemAtende collapsed={collapsed} />;
}

function SeletorDeQuemAtende({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const { user } = useAuth();
  const roster = useAttendants();
  const atualizar = useUpdateAvailability();

  const eu = roster.data?.data.find((a) => a.user_id === user.id);
  // Sem a resposta ainda (ou fora do roster), não desenha um estado chutado:
  // "Offline" piscando para quem está online ensina a desconfiar da chave.
  if (!eu) return null;

  const online = eu.is_available;
  const rotulo = online ? t("Online") : t("Offline");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label={t("Online")}
      title={rotulo}
      data-testid="seletor-de-status"
      disabled={atualizar.isPending}
      onClick={() => atualizar.mutate({ userId: user.id, patch: { is_available: !online } })}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-text-muted transition-colors duration-fast hover:bg-hover hover:text-text disabled:opacity-60 lg:h-6",
        collapsed && "w-full justify-center px-0",
      )}
    >
      <span
        aria-hidden
        data-status={online ? "online" : "offline"}
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          online ? "bg-success" : "border border-text-subtle",
        )}
      />
      {!collapsed && <span className={cn(online && "text-text")}>{rotulo}</span>}
    </button>
  );
}
