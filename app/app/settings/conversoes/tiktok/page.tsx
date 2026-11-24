import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";

import { PaginaDaConexaoDireta } from "../_paginaDaConexaoDireta";

/** Configurações › Conversões › TikTok Ads (9488). */
export const metadata = { title: "TikTok Ads" };
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaDaConexaoDireta
      plataforma="tiktok"
      Cabecalho={(props) => <CabecalhoDaSubTela {...props} />}
    />
  );
}
