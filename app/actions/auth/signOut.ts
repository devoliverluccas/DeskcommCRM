"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { createClient } from "@/lib/supabase/server";
import {
  invalidarSessao,
  invalidarUsuario,
  sessaoDosCookies,
  type SessaoDosCookies,
} from "@/lib/auth/cache-curto";
import { audit } from "@/lib/audit";
import { encerrarPushDeTodosOsAparelhos } from "@/lib/notifications/encerrar-push-de-todos-os-aparelhos";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  // `signOut()` sem `scope` é `global` no auth-js: desconecta TODOS os
  // aparelhos da pessoa. Os avisos acompanham a sessão — senão um aparelho já
  // deslogado segue recebendo push da empresa.
  if (user) await encerrarPushDeTodosOsAparelhos(user.id, requestId);

  let sessao: SessaoDosCookies | null = null;
  try {
    sessao = sessaoDosCookies((await cookies()).getAll());
  } catch {
    // Fora de escopo de requisição não há cookie para esquecer; a saída acontece
    // e o cache da pessoa cai pelo `invalidarUsuario` abaixo.
  }
  await supabase.auth.signOut();

  // #3696: saída é revogação. O token pode continuar no cookie de outra aba, e
  // o cache curto não pode devolver esta sessão depois do signOut.
  if (user) invalidarUsuario(user.id);
  if (sessao) invalidarSessao(sessao.chave);

  // A auditoria ANTES de apagar o `active_org`: é por ele que `audit()` sabe em
  // qual empresa a sessão estava (registro de acessos, `lib/audit/org-do-acesso.ts`).
  // Apagado antes, a saída de quem tem duas empresas cairia na primeira delas.
  if (user) {
    await audit({
      action: "auth.logout",
      actorUserId: user.id,
      requestId,
      ip: ipDoCliente(hdrs),
      userAgent: hdrs.get("user-agent") ?? null,
      metadata: { scope: "global" },
    });
  }

  // Clear active_org cookie too.
  const store = await cookies();
  store.delete("active_org");

  redirect("/login");
}
