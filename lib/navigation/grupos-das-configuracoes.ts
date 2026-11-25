import type { Role } from "@/lib/auth/types";
import type { ModuloOpcional } from "@/lib/instalacao/modulos";
import type { CapacidadeDaOrganizacao } from "@/lib/organizacao/capacidades";

import type { InterfaceSettings } from "./interface";
import { NAV_DESTINATIONS, searchable, type NavDestination } from "./registry";

/**
 * OS CINCO GRUPOS DO MENU DE CONFIGURAÇÕES — o mapeamento, num lugar só.
 *
 * ─── Por que um arquivo à parte ────────────────────────────────────────────
 *
 * O catálogo (`catalogo.ts`) agrupa por JORNADA dentro do grupo "organizacao":
 * "Sua conta", "Sua empresa", "Dados e acesso". "Sua empresa" virou o balde de
 * trinta telas — Tags, Marca, Plano e cobrança e Feriados lado a lado —, e um
 * menu lateral com trinta itens sem divisão é uma lista que ninguém lê.
 *
 * O menu de Configurações divide em cinco grupos por ASSUNTO. Em vez de
 * reescrever as seções do catálogo (que o hub, o ⌘K e outras telas leem), o
 * assunto é DERIVADO daqui: a seção dá o padrão, e o `href` refina as telas de
 * "Sua empresa" que são de atendimento, de canal ou de equipe.
 *
 * Quem decide o que cada pessoa VÊ continua sendo o registro (`searchable`):
 * papel, módulos da instalação, capacidades da organização e as áreas que a
 * empresa escolheu. Este arquivo só decide em que grupo a porta aparece.
 *
 * `tests/unit/grupos-das-configuracoes.test.ts` reprova a seção (ou a porta)
 * que não cair em grupo nenhum — tela nova no catálogo não some do menu.
 */

export type GrupoDasConfiguracoesId = "conta" | "atendimento" | "canais" | "empresa" | "equipe";

export interface GrupoDasConfiguracoes {
  id: GrupoDasConfiguracoesId;
  /** Chave do dicionário — quem desenha traduz. */
  label: string;
}

/** Na ordem do menu: o pessoal primeiro, o de quem administra por último. */
export const GRUPOS_DAS_CONFIGURACOES: readonly GrupoDasConfiguracoes[] = [
  { id: "conta", label: "Sua conta" },
  { id: "atendimento", label: "Atendimento" },
  { id: "canais", label: "Canais" },
  { id: "empresa", label: "Empresa" },
  { id: "equipe", label: "Equipe e segurança" },
];

/** O padrão: a seção do catálogo. Seção nova sem linha aqui reprova o teste. */
export const GRUPO_POR_SECAO: Readonly<Record<string, GrupoDasConfiguracoesId>> = {
  "Sua conta": "conta",
  Ajuda: "conta",
  "Sua empresa": "empresa",
  Empresa: "empresa",
  "Dados e acesso": "equipe",
  // Etapas do funil mora no grupo CRM, mas a tela é de Configurações.
  "Preparar a venda": "atendimento",
};

/**
 * O refinamento: telas cuja seção é larga demais. Só ENTRADAS QUE EXISTEM no
 * catálogo — o teste reprova `href` daqui que não aponte para uma porta.
 */
export const GRUPO_POR_HREF: Readonly<Record<string, GrupoDasConfiguracoesId>> = {
  // Segurança é pessoal (seu fator) e da empresa (a política de MFA).
  "/app/settings/security": "equipe",
  "/app/team": "equipe",

  "/app/settings/atendimento": "atendimento",
  "/app/settings/followup-por-etapa": "atendimento",
  "/app/settings/automacoes": "atendimento",
  "/app/settings/tags": "atendimento",
  "/app/settings/motivos-de-encerramento": "atendimento",
  "/app/settings/feriados": "atendimento",
  "/app/settings/pontuacao": "atendimento",
  "/app/settings/valores-personalizados": "atendimento",
  "/app/settings/links-de-saida": "atendimento",
  "/app/settings/links-de-contato": "atendimento",
  "/app/settings/cadencias": "atendimento",
  "/app/settings/metas": "atendimento",
  "/app/settings/tenant/agenda": "atendimento",
  "/app/agenda/avisos": "atendimento",

  "/app/settings/conversoes": "canais",
  "/app/settings/conversoes/ga4": "canais",
  "/app/settings/conversoes/tiktok": "canais",
  "/app/settings/meta-ads": "canais",
  "/app/settings/voip-trunk": "canais",
  "/app/settings/servidor-mcp-externo": "canais",
  "/app/integracao-dados": "canais",
  "/app/extensions": "canais",
};

/**
 * Entra no menu de Configurações? Toda porta do grupo "organizacao" (inclusive
 * Equipe e LGPD, que moram fora de `/app/settings`: o índice era a porta delas
 * e continua sendo), toda tela sob `/app/settings/`, e os canais.
 */
export function ehPortaDasConfiguracoes(d: Pick<NavDestination, "href" | "group">): boolean {
  return d.group === "organizacao" || d.group === "canais" || d.href.startsWith("/app/settings/");
}

export function grupoDaConfiguracao(
  d: Pick<NavDestination, "href" | "group" | "section">,
): GrupoDasConfiguracoesId | undefined {
  const porHref = GRUPO_POR_HREF[d.href];
  if (porHref) return porHref;
  if (d.group === "canais") return "canais";
  return d.section ? GRUPO_POR_SECAO[d.section] : undefined;
}

export interface GrupoDoMenu {
  grupo: GrupoDasConfiguracoes;
  itens: NavDestination[];
}

/**
 * As portas que ESTA pessoa vê, agrupadas e sem grupo vazio. A visibilidade é
 * a do ⌘K (`searchable`); `agencia` acrescenta "Organizações clientes", que o
 * registro deixa de fora para todo mundo e só a agência enxerga.
 */
export function menuDasConfiguracoes(opcoes: {
  isPlatformAdmin: boolean;
  role: Role | null;
  interfaceSettings?: InterfaceSettings;
  modulos: readonly ModuloOpcional[];
  capacidades?: readonly CapacidadeDaOrganizacao[];
  agencia?: boolean;
}): GrupoDoMenu[] {
  const visiveis = searchable(
    opcoes.isPlatformAdmin,
    opcoes.role,
    opcoes.interfaceSettings,
    opcoes.modulos,
    opcoes.capacidades,
  ).filter(ehPortaDasConfiguracoes);
  if (opcoes.agencia) {
    const porta = NAV_DESTINATIONS.find((d) => d.agenciaOnly && ehPortaDasConfiguracoes(d));
    if (porta && !visiveis.includes(porta)) visiveis.unshift(porta);
  }
  return GRUPOS_DAS_CONFIGURACOES.map((grupo) => ({
    grupo,
    itens: visiveis.filter((d) => grupoDaConfiguracao(d) === grupo.id),
  })).filter((g) => g.itens.length > 0);
}

/**
 * A porta ATIVA para um caminho: o prefixo mais longo. `/app/settings/tenant/agenda`
 * acende "Tipos de agendamento", não "Organização"; `/app/settings/tags?page=2`
 * e um detalhe `/…/modelos/abc` acendem a porta-mãe.
 */
export function portaAtiva(pathname: string, itens: readonly NavDestination[]): string | null {
  let melhor: string | null = null;
  for (const { href } of itens) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (!melhor || href.length > melhor.length) melhor = href;
  }
  return melhor;
}

/** Sem acento e sem caixa: "seguranca" acha "Segurança". */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * O destino do Enter na busca: o rótulo que COMEÇA pelo termo, depois o rótulo
 * que o contém, e só então a primeira linha (que pode ter casado só pela
 * descrição). "marca" abre Marca, não a primeira tela que cita marcação.
 */
export function primeiroResultado(
  grupos: readonly GrupoDoMenu[],
  termo: string,
  traduzir: (texto: string) => string,
): NavDestination | undefined {
  const busca = normalizar(termo);
  if (!busca) return undefined;
  const itens = filtrarMenu(grupos, termo, traduzir).flatMap((g) => g.itens);
  const rotulo = (d: NavDestination) => normalizar(traduzir(d.label));
  return (
    itens.find((d) => rotulo(d).startsWith(busca)) ??
    itens.find((d) => rotulo(d).includes(busca)) ??
    itens[0]
  );
}

/**
 * Filtra pelo rótulo e pela descrição, JÁ traduzidos (quem lê em espanhol busca
 * em espanhol), e pelo nome do grupo — "canais" mostra o grupo inteiro.
 */
export function filtrarMenu(
  grupos: readonly GrupoDoMenu[],
  termo: string,
  traduzir: (texto: string) => string,
): GrupoDoMenu[] {
  const busca = normalizar(termo);
  if (!busca) return [...grupos];
  return grupos
    .map(({ grupo, itens }) => {
      if (normalizar(traduzir(grupo.label)).includes(busca)) return { grupo, itens };
      return {
        grupo,
        itens: itens.filter(
          (d) =>
            normalizar(traduzir(d.label)).includes(busca) ||
            normalizar(traduzir(d.description)).includes(busca),
        ),
      };
    })
    .filter((g) => g.itens.length > 0);
}
