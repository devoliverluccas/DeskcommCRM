import { CabecalhoDaSubTela } from "@/components/settings/CabecalhoDaSubTela";
import { traduzir } from "@/lib/i18n/dicionario";

import { PaginaDaConexaoDireta } from "../_paginaDaConexaoDireta";

/** Configurações › Conversões › Google Analytics 4 (9488). */
export const metadata = { title: "Google Analytics 4" };
export const dynamic = "force-dynamic";

/** Quem esta plataforma recebe — a regra de `lib/conversoes/analitica.handler.ts`. */
const QUEM_RECEBE =
  "O GA4 recebe toda venda (negócio ganho) e todo lead novo da organização, venha o contato de onde vier. Quando o formulário captura o cookie _ga, o evento fica ligado ao visitante do site.";

export default function Pagina() {
  return (
    <PaginaDaConexaoDireta
      plataforma="ga4"
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
