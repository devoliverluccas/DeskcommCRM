/**
 * O QUE SÓ O ENVIO RESOLVE — fase 4, itens 4.4 e 4.6.
 *
 * Duas marcações não têm como sair prontas da tela:
 *
 *   - `{{empresa.<chave>}}` — a tela pode não ter lido os valores da empresa
 *     (o compositor do Inbox, a prévia da campanha, o follow-up do motor); o
 *     resolvedor deixa o token como foi escrito, e quem troca é o envio, com o
 *     valor salvo NA HORA de mandar.
 *   - `{{link:https://…}}` — a URL curta é UMA POR CONTATO, e só o envio sabe
 *     para quem a mensagem vai.
 *
 * Chamado UMA vez, em `sendMessageHandler` (a porta de saída de Inbox,
 * campanha, automação, follow-up, MCP e agente), antes de a linha da mensagem
 * nascer: o que fica gravado em `messages.body` é o que o cliente recebeu.
 *
 * Nunca trava o envio: valor que não existe fica literal; link que não pôde
 * ser criado sai como a URL original, sem rastreio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { linkDeSaida, urlCurta } from "@/lib/plataformas-de-anuncio/rastreio/links-de-saida";

import { temMarcacaoDeLink, trocarLinks } from "./link";
import { resolverValoresDaEmpresa, temValorDaEmpresa } from "./resolvedor";
import { lerValoresDaEmpresa } from "./valores-da-empresa";

export interface DestinoDoEnvio {
  organizationId: string;
  /** O contato CONHECIDO da conversa; `null` (grupo) = o link sai sem rastreio. */
  contactId: string | null;
}

/** Barato e sem banco: o texto tem algo que só o envio resolve? */
export function precisaResolverNoEnvio(texto: string | null | undefined): boolean {
  return typeof texto === "string" && (temValorDaEmpresa(texto) || temMarcacaoDeLink(texto));
}

/** O corpo ou algum valor de parâmetro do modelo pede o envio? Sem banco. */
export function conteudoPrecisaDoEnvio(conteudo: {
  body?: string | null;
  template_values?: Record<string, string> | null;
}): boolean {
  return (
    precisaResolverNoEnvio(conteudo.body) ||
    Object.values(conteudo.template_values ?? {}).some((v) => precisaResolverNoEnvio(v))
  );
}

/** Lê os valores uma vez por envio; falha de leitura vira mapa vazio (o token fica literal). */
function leitorDeValores(admin: SupabaseClient, organizationId: string) {
  let pendente: Promise<Record<string, string>> | null = null;
  return () => {
    pendente ??= lerValoresDaEmpresa(admin, organizationId).catch((erro: unknown) => {
      logger.error("[no-envio] valores da empresa indisponíveis; tokens ficam literais", {
        organizationId,
        motivo: erro instanceof Error ? erro.message : String(erro),
      });
      return {};
    });
    return pendente;
  };
}

async function resolverUm(
  admin: SupabaseClient,
  destino: DestinoDoEnvio,
  texto: string,
  valores: () => Promise<Record<string, string>>,
  base: string,
): Promise<string> {
  let saida = texto;
  // Empresa ANTES do link: um valor pode ser ele mesmo um `{{link:…}}`
  // (`{{empresa.site}}` = `{{link:https://loja.exemplo}}`) e precisa ser rastreado.
  if (temValorDaEmpresa(saida)) {
    saida = resolverValoresDaEmpresa(saida, await valores()).texto;
  }
  if (temMarcacaoDeLink(saida)) {
    saida = await trocarLinks(saida, async ({ destino: url, rotulo }) => {
      if (destino.contactId === null || base.trim() === "") return url;
      const link = await linkDeSaida(admin, {
        organizationId: destino.organizationId,
        contactId: destino.contactId,
        destino: url,
        rotulo,
      });
      return link ? urlCurta(base, link.codigo) : url;
    });
  }
  return saida;
}

/**
 * O corpo (e, num modelo aprovado, os valores dos parâmetros) com
 * `{{empresa.*}}` e `{{link:…}}` resolvidos. Sem marcação nenhuma devolve o
 * MESMO objeto e não toca no banco — o caminho de sempre fica byte a byte igual.
 */
export async function resolverNoEnvio<
  T extends { body?: string | null; template_values?: Record<string, string> | null },
>(
  admin: SupabaseClient,
  destino: DestinoDoEnvio,
  conteudo: T,
  /** A origem pública do CRM; padrão `NEXT_PUBLIC_APP_URL` (lido só quando há link a criar). */
  base?: string,
): Promise<T> {
  const valoresDoModelo = conteudo.template_values ?? null;
  const corpoPrecisa = precisaResolverNoEnvio(conteudo.body);
  const modeloPrecisa =
    valoresDoModelo !== null && Object.values(valoresDoModelo).some((v) => precisaResolverNoEnvio(v));
  if (!corpoPrecisa && !modeloPrecisa) return conteudo;

  const valores = leitorDeValores(admin, destino.organizationId);
  const raiz = base ?? (await import("@/lib/env")).env.NEXT_PUBLIC_APP_URL ?? "";
  const resultado: T = { ...conteudo };
  if (corpoPrecisa && typeof conteudo.body === "string") {
    resultado.body = await resolverUm(admin, destino, conteudo.body, valores, raiz);
  }
  if (modeloPrecisa && valoresDoModelo !== null) {
    const novos: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(valoresDoModelo)) {
      // Parâmetro de modelo não aceita quebra de linha nem espaço em excesso —
      // a mesma regra de `valorParaParametro` (variaveis-do-fluxo).
      novos[chave] = precisaResolverNoEnvio(valor)
        ? (await resolverUm(admin, destino, valor, valores, raiz)).replace(/\s+/g, " ").trim().slice(0, 200)
        : valor;
    }
    resultado.template_values = novos;
  }
  return resultado;
}
