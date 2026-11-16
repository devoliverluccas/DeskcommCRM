import { requireAuth } from "@/lib/auth/server";
import { ConnectNuvemshopClient } from "./_client";
import { traduzir } from "@/lib/i18n/dicionario";
import { CabecalhoDoPasso } from "../_components/Passo";

export const dynamic = "force-dynamic";

export default async function ConnectNuvemshopPage() {
  const user = await requireAuth();
  const idioma = user.idioma;

  return (
    <div>
      <CabecalhoDoPasso
        titulo={traduzir("Conectar Nuvemshop", idioma)}
        subtitulo={traduzir("Importe pedidos, clientes e produtos da sua loja Nuvemshop.", idioma)}
      />
      <ConnectNuvemshopClient />
    </div>
  );
}
