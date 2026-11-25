import type { Metadata } from "next";

import { ResumoDasConfiguracoes } from "./_components/ResumoDasConfiguracoes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Configurações" };

/**
 * Índice de Configurações — o resumo de todas as seções, nos cinco grupos do
 * menu (`lib/navigation/grupos-das-configuracoes.ts`).
 *
 * O conteúdo vem do registro de navegação, como antes: a lista escrita à mão
 * que vivia aqui divergia do sidebar. A porta "Organizações clientes", que só a
 * agência vê, saiu do servidor e entrou no próprio menu — a regra é a mesma
 * (módulo `agencias` ligado, sem suporte, organização da agência), lida do
 * contexto de sessão que o layout de `/app` já entrega.
 *
 * O card-ponte para "Canal oficial (Meta) e templates" foi promovido há tempo:
 * o grupo CANAIS (agora também aqui) e o ⌘K acham "Conexões" por nome.
 */
export default function SettingsHubPage() {
  return <ResumoDasConfiguracoes />;
}
