/**
 * APLICAR O KIT DO SEGMENTO — etiquetas, respostas rápidas, tipos de agendamento
 * e automações do ramo escolhido no primeiro passo do onboarding.
 *
 * ─── As quatro garantias ────────────────────────────────────────────────
 *
 * 1. SÓ ACRESCENTA. Cada peça é conferida pelo nome antes de gravar: o que já
 *    existe na organização fica como está, e rodar duas vezes não duplica nada.
 *    Quem voltou um passo, trocou de segmento e avançou de novo recebe as peças
 *    do segundo ao lado das do primeiro — nunca perde o que já editou.
 *
 * 2. NUNCA LIGA AUTOMAÇÃO. A regra é gravada sem `is_active` — o padrão da
 *    coluna é `false`, o mesmo contrato da rota `POST /api/v1/automation-rules`,
 *    que "NUNCA aceita is_active". Quem liga é o dono, depois de ler.
 *
 * 3. A ORGANIZAÇÃO VEM DE QUEM CHAMA, e quem chama a resolve da sessão
 *    (`requireOnboardingCtx`). O cliente aqui é o de service role, que ignora
 *    RLS: toda leitura e toda escrita filtra `organization_id` na mão.
 *
 * 4. UMA PEÇA QUE FALHA NÃO DERRUBA AS OUTRAS, e nenhuma derruba o onboarding.
 *    O kit é conveniência: a pessoa termina o wizard com ou sem ele, e o que
 *    não entrou aparece no retorno (`falhas`) para o chamador registrar.
 *
 * Cada automação passa por `createAutomationRuleSchema` — o schema da rota de
 * verdade — antes de ir ao banco. `segmentos.test.ts` faz a mesma conferência
 * em todo segmento, então um dado torto reprova no teste, não na instalação.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAutomationRuleSchema } from "@/lib/schemas/webhooks";
import type { Segmento } from "@/lib/onboarding/segmentos";

export interface ResultadoDoKit {
  etiquetas: number;
  respostas: number;
  tiposDeAgendamento: number;
  automacoes: number;
  /** O que não entrou, e por quê. Vazio é o esperado. */
  falhas: string[];
}

/**
 * O mesmo slug que `app/api/v1/agenda/tipos/route.ts` grava (`slugDe`). Arquivo
 * de rota do Next só pode exportar os handlers, então a função é repetida aqui;
 * `segmentos.test.ts` confere que todo tipo de um segmento gera slug distinto.
 */
export function slugDoTipo(nome: string): string {
  return (
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "tipo"
  );
}

const chave = (texto: string) => texto.trim().toLowerCase();

async function aplicarEtiquetas(admin: SupabaseClient, orgId: string, segmento: Segmento): Promise<number> {
  const { data, error } = await admin.from("organizations").select("settings").eq("id", orgId).single();
  if (error) throw new Error(error.message);
  const settings = ((data?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  // `settings.tags` é o vocabulário curado: aceita string ("vip") e objeto
  // (`{ tag, cor, descricao }`) — as duas formas existem no banco, e a função
  // `fn_vocabulario_de_tags_operar` grava a segunda. Lista torta vira vazia,
  // como ela faz.
  const atuais = Array.isArray(settings.tags) ? (settings.tags as unknown[]) : [];
  const jaTem = new Set(
    atuais
      .map((e) => (typeof e === "string" ? e : (e as { tag?: unknown } | null)?.tag))
      .filter((t): t is string => typeof t === "string")
      .map(chave),
  );
  const novas = segmento.etiquetas.filter((e) => !jaTem.has(chave(e.tag)));
  if (novas.length === 0) return 0;
  const { error: erroDeEscrita } = await admin
    .from("organizations")
    .update({ settings: { ...settings, tags: [...atuais, ...novas] } })
    .eq("id", orgId);
  if (erroDeEscrita) throw new Error(erroDeEscrita.message);
  return novas.length;
}

async function aplicarRespostas(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  segmento: Segmento,
): Promise<number> {
  const [{ data: grupos, error: erroDosGrupos }, { data: modelos, error: erroDosModelos }] = await Promise.all([
    admin.from("message_template_groups").select("id, name, ordem").eq("organization_id", orgId),
    admin.from("message_templates").select("title, ordem").eq("organization_id", orgId).is("owner_user_id", null),
  ]);
  if (erroDosGrupos) throw new Error(erroDosGrupos.message);
  if (erroDosModelos) throw new Error(erroDosModelos.message);

  const grupoPorNome = new Map((grupos ?? []).map((g) => [chave(String(g.name)), String(g.id)]));
  const titulos = new Set((modelos ?? []).map((m) => chave(String(m.title))));
  let ordemDoGrupo = Math.max(0, ...(grupos ?? []).map((g) => Number(g.ordem) || 0));
  let ordemDoModelo = Math.max(0, ...(modelos ?? []).map((m) => Number(m.ordem) || 0));
  let criadas = 0;

  for (const grupo of segmento.respostas) {
    let grupoId = grupoPorNome.get(chave(grupo.grupo));
    if (!grupoId) {
      ordemDoGrupo += 1000;
      const { data, error } = await admin
        .from("message_template_groups")
        .insert({ organization_id: orgId, name: grupo.grupo, ordem: ordemDoGrupo })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      grupoId = String(data.id);
      grupoPorNome.set(chave(grupo.grupo), grupoId);
    }
    const novas = grupo.respostas.filter((r) => !titulos.has(chave(r.title)));
    if (novas.length === 0) continue;
    const { error } = await admin.from("message_templates").insert(
      novas.map((r) => {
        ordemDoModelo += 1000;
        return {
          organization_id: orgId,
          // `owner_user_id` nulo = resposta da EQUIPE (o `shared=true` da rota).
          owner_user_id: null,
          created_by_user_id: userId,
          title: r.title,
          body: r.body,
          shortcut: r.shortcut,
          grupo_id: grupoId,
          ordem: ordemDoModelo,
        };
      }),
    );
    if (error) throw new Error(error.message);
    novas.forEach((r) => titulos.add(chave(r.title)));
    criadas += novas.length;
  }
  return criadas;
}

async function aplicarTiposDeAgendamento(admin: SupabaseClient, orgId: string, segmento: Segmento): Promise<number> {
  if (segmento.tiposDeAgendamento.length === 0) return 0;
  const { data, error } = await admin.from("calendar_event_types").select("slug").eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  const slugs = new Set((data ?? []).map((t) => String(t.slug)));
  const novos = segmento.tiposDeAgendamento.filter((t) => !slugs.has(slugDoTipo(t.name)));
  if (novos.length === 0) return 0;
  const { error: erroDeEscrita } = await admin
    .from("calendar_event_types")
    .insert(novos.map((t) => ({ ...t, organization_id: orgId, slug: slugDoTipo(t.name) })));
  if (erroDeEscrita) throw new Error(erroDeEscrita.message);
  return novos.length;
}

async function aplicarAutomacoes(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  segmento: Segmento,
): Promise<number> {
  const { data, error } = await admin.from("automation_rules").select("name").eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  const nomes = new Set((data ?? []).map((r) => chave(String(r.name))));
  const novas = segmento.automacoes
    .filter((a) => !nomes.has(chave(a.name)))
    .map((a) => createAutomationRuleSchema.parse(a));
  if (novas.length === 0) return 0;
  const { error: erroDeEscrita } = await admin.from("automation_rules").insert(
    novas.map((a) => ({
      organization_id: orgId,
      created_by_user_id: userId,
      name: a.name,
      trigger_event: a.trigger_event,
      conditions: a.conditions,
      actions: a.actions,
      trigger_config: a.trigger_config ?? {},
      // sem `is_active`: nasce desligada (padrão da coluna).
    })),
  );
  if (erroDeEscrita) throw new Error(erroDeEscrita.message);
  return novas.length;
}

export async function aplicarKitDoSegmento(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  segmento: Segmento,
): Promise<ResultadoDoKit> {
  const resultado: ResultadoDoKit = { etiquetas: 0, respostas: 0, tiposDeAgendamento: 0, automacoes: 0, falhas: [] };
  const pecas: Array<[keyof Omit<ResultadoDoKit, "falhas">, () => Promise<number>]> = [
    ["etiquetas", () => aplicarEtiquetas(admin, orgId, segmento)],
    ["respostas", () => aplicarRespostas(admin, orgId, userId, segmento)],
    ["tiposDeAgendamento", () => aplicarTiposDeAgendamento(admin, orgId, segmento)],
    ["automacoes", () => aplicarAutomacoes(admin, orgId, userId, segmento)],
  ];
  for (const [nome, aplicar] of pecas) {
    try {
      resultado[nome] = await aplicar();
    } catch (err) {
      resultado.falhas.push(`${nome}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return resultado;
}
