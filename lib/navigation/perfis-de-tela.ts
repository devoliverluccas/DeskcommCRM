/**
 * PERFIS DE TELA (item 5.6) — o que um membro VÊ, sobre o que o papel permite.
 *
 * ─── O que é, e o que NÃO é ────────────────────────────────────────────────
 *
 * Um perfil é um nome e uma lista de portas do catálogo (`NAV_CATALOG`). Quem
 * administra cria perfis ("Vendas", "Recepção") e atribui a membros; o menu, o
 * hub e a busca desse membro passam a mostrar só as portas do perfil.
 *
 * É APRESENTAÇÃO, como a interface da empresa e a do vínculo
 * (`./interface.ts`): o resultado é uma INTERSEÇÃO, nunca uma soma. O perfil não
 * abre porta que o papel não dá, não abre porta que a empresa escondeu e não
 * nega rota — quem digita o endereço de uma tela fora do perfil chega a ela se o
 * PAPEL deixar. A tela de perfis diz isso com todas as letras.
 *
 * ─── Por que quem administra não recebe perfil ─────────────────────────────
 *
 * Um admin com perfil esconderia de si a tela que desfaz o perfil. As portas
 * essenciais seguram Equipe e Organização, mas não a tela de perfis — e trancar
 * a porta de saída é o defeito que `PORTAS_ESSENCIAIS` existe para impedir. Por
 * isso a rota recusa atribuir perfil a admin, e `aplicarPerfilDeTela` ignora o
 * perfil de quem é admin (vínculo que mudou de papel depois da atribuição).
 */
import { z } from "zod";

import type { Role } from "@/lib/auth/types";

import { NAV_CATALOG, type NavDestinationId } from "./catalogo";
import { PORTAS_ESSENCIAIS, combinarInterfaces, type InterfaceSettings } from "./interface";

const IDS = NAV_CATALOG.map((d) => d.href) as readonly NavDestinationId[];

/** Teto de perfis por organização — a tela é uma lista, não um cadastro em massa. */
export const MAXIMO_DE_PERFIS = 50;

export const COLUNAS_DO_PERFIL = "id, nome, destinos, created_at, updated_at";

export interface PerfilDeTela {
  id: string;
  nome: string;
  destinos: string[];
  created_at: string;
  updated_at: string;
}

const destinosSchema = z
  .array(z.enum(IDS as unknown as [NavDestinationId, ...NavDestinationId[]]))
  .min(1)
  .max(IDS.length)
  // Ordem do catálogo e sem repetição: a lista gravada é sempre a mesma para a
  // mesma escolha, e a comparação de "mudou?" não depende de clique.
  .transform((valores) => IDS.filter((id) => valores.includes(id)));

export const criarPerfilSchema = z
  .object({
    nome: z.string().trim().min(1).max(60),
    destinos: destinosSchema,
  })
  .strict();

export const editarPerfilSchema = z
  .object({
    nome: z.string().trim().min(1).max(60).optional(),
    destinos: destinosSchema.optional(),
  })
  .strict()
  .refine((v) => v.nome !== undefined || v.destinos !== undefined, { message: "nada a alterar" });

export const atribuirPerfilSchema = z
  .object({ perfil_de_tela_id: z.string().uuid().nullable() })
  .strict();

/** Portas essenciais que o catálogo conhece — o piso quando nada do perfil sobra. */
const ESSENCIAIS: readonly NavDestinationId[] = IDS.filter((id) =>
  (PORTAS_ESSENCIAIS as readonly string[]).includes(id),
);

/**
 * As portas que um perfil guardado significa HOJE. Tolera o que vem do banco:
 * href que saiu do catálogo é descartado (porta removida não quebra o menu);
 * valor que não é lista = sem perfil (`null`).
 */
export function destinosDoPerfil(raw: unknown): NavDestinationId[] | null {
  if (!Array.isArray(raw)) return null;
  return IDS.filter((id) => raw.includes(id));
}

/**
 * O embed do PostgREST (`perfil_de_tela:perfis_de_tela!…(destinos)`) chega como
 * objeto ou lista de um, conforme a versão — e `null` quando o vínculo não tem
 * perfil. Devolve as portas, ou `null` = sem perfil.
 */
export function destinosDoEmbed(embed: unknown): NavDestinationId[] | null {
  const linha = Array.isArray(embed) ? embed[0] : embed;
  if (!linha || typeof linha !== "object") return null;
  return destinosDoPerfil((linha as { destinos?: unknown }).destinos);
}

/**
 * A interface que a pessoa vê DEPOIS do perfil: (empresa ∩ vínculo) ∩ perfil.
 *
 * - sem perfil (`null`/`undefined`) → a interface de sempre, intocada;
 * - admin → a interface de sempre (ver o cabeçalho);
 * - perfil cujas portas sumiram todas do catálogo → só as essenciais. Nunca a
 *   interface completa: perfil existe para estreitar, e "não sobrou nada" não
 *   pode virar "abre tudo" (`lerInterface` trataria lista vazia como completa).
 *
 * A trava de assumir (`bloquearAteAssumir`), as colunas de compra e a tela
 * inicial atravessam: `combinarInterfaces` as tira do primeiro argumento, que é
 * a interface já combinada.
 */
export function aplicarPerfilDeTela(
  settings: InterfaceSettings,
  destinos: readonly string[] | null | undefined,
  role: Role | null,
): InterfaceSettings {
  if (destinos == null || role === "admin") return settings;
  const validos = IDS.filter((id) => destinos.includes(id));
  return combinarInterfaces(settings, {
    preset: "completa",
    destinos: validos.length > 0 ? validos : [...ESSENCIAIS],
  });
}
