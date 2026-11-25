import type { ReactNode } from "react";

import { PainelDasConfiguracoes } from "./_components/PainelDasConfiguracoes";

/**
 * Configurações numa página só: o menu de seções à esquerda (seletor no
 * celular) e a tela aberta à direita. Quem decide as portas é o registro de
 * navegação, pelo mesmo contexto de sessão da barra lateral — ver
 * `lib/navigation/grupos-das-configuracoes.ts`.
 *
 * As URLs não mudam: cada tela continua no seu `page.tsx`, e o layout só a
 * emoldura.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <PainelDasConfiguracoes>{children}</PainelDasConfiguracoes>;
}
