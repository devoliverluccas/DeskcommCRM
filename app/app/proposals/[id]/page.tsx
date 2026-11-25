import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { LojaDaProposta } from "@/components/lojas/LojaDaProposta";
import { lojasDaTela } from "@/lib/lojas/leitura";
import { createAdminClient } from "@/lib/supabase/admin";

import { ProposalEditorClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editor de Proposta" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const { id } = await params;

  const suporteLiberaEscrita =
    !user.support || (user.support.status === "active" && user.support.access_mode === "full");
  const podeEditar = roleAtLeast(activeOrg.role, "agent") && suporteLiberaEscrita;
  // O documento só é editável por manager+ — o mesmo papel que a rota PATCH /documento exige.
  const podeRevisar = roleAtLeast(activeOrg.role, "manager") && suporteLiberaEscrita;

  // A loja do orçamento (item 5.4): sem o módulo `lojas`, nenhuma loja e nada desenhado.
  const lojas = await lojasDaTela(createAdminClient(), activeOrg.orgId);
  const lojaDoOrcamento =
    lojas.length > 0 ? (
      <LojaDaProposta
        propostaId={id}
        lojas={lojas.map((l) => ({ id: l.id, nome: l.nome }))}
        podeEditar={podeEditar}
      />
    ) : null;

  return (
    <ProposalEditorClient
      id={id}
      podeEditar={podeEditar}
      podeRevisar={podeRevisar}
      abaixoDoTitulo={lojaDoOrcamento}
    />
  );
}
