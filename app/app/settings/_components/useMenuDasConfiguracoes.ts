"use client";

import { useMemo } from "react";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { menuDasConfiguracoes, type GrupoDoMenu } from "@/lib/navigation/grupos-das-configuracoes";

/**
 * O menu de Configurações desta sessão. Lê o mesmo contexto que a barra
 * lateral (`useAuth`), então papel, módulos, capacidades e áreas da empresa
 * valem aqui exatamente como lá — nenhuma consulta nova.
 */
export function useMenuDasConfiguracoes(): GrupoDoMenu[] {
  const { user, activeOrg } = useAuth();
  return useMemo(() => {
    const modulos = activeOrg?.modulos_ligados ?? [];
    // A mesma regra que o índice aplicava no servidor para a porta da agência.
    const agencia =
      !!activeOrg &&
      modulos.includes("agencias") &&
      !user.support &&
      (user.agency_org_ids ?? []).includes(activeOrg.orgId);
    return menuDasConfiguracoes({
      isPlatformAdmin: user.is_platform_admin && !user.support,
      role: activeOrg?.role ?? null,
      interfaceSettings: activeOrg?.interface_settings,
      modulos,
      capacidades: activeOrg?.capacidades_ligadas ?? [],
      agencia,
    });
  }, [user, activeOrg]);
}
