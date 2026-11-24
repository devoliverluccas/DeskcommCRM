import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";

import { PaginaDaConexaoDireta } from "../_paginaDaConexaoDireta";

/** Configurações › Conversões › Google Analytics 4 (9488). */
export const metadata = { title: "Google Analytics 4" };
export const dynamic = "force-dynamic";

export default function Pagina() {
  return (
    <PaginaDaConexaoDireta
      plataforma="ga4"
      Cabecalho={(props) => <CabecalhoDaSubTela {...props} />}
    />
  );
}
