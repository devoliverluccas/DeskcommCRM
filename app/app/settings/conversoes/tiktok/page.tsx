import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { traduzir } from "@/lib/i18n/dicionario";

import { PaginaDaConexaoDireta } from "../_paginaDaConexaoDireta";

/** Configurações › Conversões › TikTok Ads (9488). */
export const metadata = { title: "TikTok Ads" };
export const dynamic = "force-dynamic";

/** Quem esta plataforma recebe — a regra de `lib/conversoes/analitica.handler.ts`. */
const QUEM_RECEBE =
  "O TikTok recebe a venda e o lead novo de quem chegou por um clique de anúncio do TikTok (o ttclid capturado no formulário), mesmo quando a origem principal do contato é outra.";

export default function Pagina() {
  return (
    <PaginaDaConexaoDireta
      plataforma="tiktok"
      Cabecalho={({ children, ...props }) => (
        <CabecalhoDaSubTela {...props}>
          {children}
          <p className="mt-1 max-w-2xl text-sm text-text-muted" data-testid="quem-recebe">
            {traduzir(QUEM_RECEBE, props.idioma)}
          </p>
        </CabecalhoDaSubTela>
      )}
    />
  );
}
