import { emailConfigurado } from "@/lib/email/roteador";
import { InviteTeamForm } from "./_form";
import { requireAuth } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { AvisoDoPasso, CabecalhoDoPasso } from "../_components/Passo";

export const dynamic = "force-dynamic";

export default async function InviteTeamPage() {
  const user = await requireAuth();
  const idioma = user.idioma;
  const emailReady = await emailConfigurado();
  return (
    <div>
      <CabecalhoDoPasso
        titulo={traduzir("Quem trabalha com ele", idioma)}
        subtitulo={traduzir(
          "Seu funcionário não trabalha sozinho: quando ele passar uma conversa adiante, é uma dessas pessoas que atende.",
          idioma,
        )}
      />
      {!emailReady ? (
        <AvisoDoPasso tom="aviso" className="mb-8">
          <p className="font-medium">{traduzir("Esta instalação ainda não envia e-mail.", idioma)}</p>
          {/*
            A frase anterior dizia que os convites ficariam "registrados
            localmente" — e isso é falso: não existe tabela de convites, o
            convite É o link assinado. Quem confiasse na frase iria procurar
            depois uma lista de pendentes que nunca existiu. E o nome da
            variável de ambiente não ajuda quem só quer chamar um colega.
          */}
          <p>
            {traduzir(
              "Você recebe um link para cada pessoa e manda por onde quiser — WhatsApp, e-mail, o que preferir. O link é o convite: quem abrir entra na sua empresa.",
              idioma,
            )}
          </p>
        </AvisoDoPasso>
      ) : null}
      <InviteTeamForm />
    </div>
  );
}
