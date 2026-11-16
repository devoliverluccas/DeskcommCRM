/**
 * OS SEGMENTOS SÃO DADOS, E DADO TORTO SÓ APARECE NA INSTALAÇÃO.
 *
 * Um segmento com uma automação que o schema recusa, uma cor fora da paleta ou
 * dois tipos de agendamento com o mesmo slug não quebra build nenhum: quebra o
 * primeiro passo de quem acabou de instalar. Este arquivo confere cada peça
 * contra a régua que a rota de verdade usa.
 */
import { describe, expect, it } from "vitest";

import { aplicarKitDoSegmento, slugDoTipo } from "@/lib/onboarding/aplicar-kit";
import { validarProposta } from "@/lib/onboarding/proposta-de-funil";
import { IDS_DE_SEGMENTO, SEGMENTOS, pacoteDoSegmento, segmentoPorId } from "@/lib/onboarding/segmentos";
import { welcomeSchema } from "@/lib/schemas/onboarding";
import { TAG_MAX } from "@/lib/schemas/tags";
import { createAutomationRuleSchema } from "@/lib/schemas/webhooks";
import { PALETA_DE_ETIQUETAS } from "@/lib/tags/cor-da-etiqueta";

const CATEGORIAS = ["consulta", "procedimento", "retorno", "visita", "vistoria", "reuniao", "call", "orcamento", "demonstracao", "outro"];
const LOCAIS = ["in_person", "phone", "whatsapp", "video_link", "google_meet"];

describe("os segmentos do onboarding", () => {
  it("são os oito combinados, com id único", () => {
    expect(SEGMENTOS.map((s) => s.id)).toEqual([
      "saude",
      "estetica",
      "energia",
      "imobiliario",
      "automotivo",
      "casa",
      "educacao",
      "ecommerce",
    ]);
    expect(new Set(IDS_DE_SEGMENTO).size).toBe(SEGMENTOS.length);
  });

  it("`segmentoPorId` não inventa segmento", () => {
    expect(segmentoPorId("saude")?.rotulo).toBe("Saúde");
    expect(segmentoPorId("nao-existe")).toBeNull();
    expect(segmentoPorId(undefined)).toBeNull();
  });

  it("o passo de boas-vindas aceita cada id e recusa o que não é segmento", () => {
    for (const id of IDS_DE_SEGMENTO) {
      expect(welcomeSchema.safeParse({ display_name: "Empresa", segmento: id }).success).toBe(true);
    }
    expect(welcomeSchema.safeParse({ display_name: "Empresa", segmento: "inventado" }).success).toBe(false);
    expect(welcomeSchema.safeParse({ display_name: "Empresa" }).success).toBe(true);
  });

  describe.each(SEGMENTOS.map((s) => [s.id, s] as const))("%s", (_id, segmento) => {
    it("o quadro passa na régua do passo do funil", () => {
      const veredito = validarProposta(segmento.funil);
      expect(veredito, JSON.stringify(veredito)).toMatchObject({ ok: true });
      expect(pacoteDoSegmento(segmento).proposta).toBe(segmento.funil);
    });

    it("toda etiqueta cabe no limite, usa um tom da paleta e não se repete", () => {
      const nomes = segmento.etiquetas.map((e) => e.tag.toLowerCase());
      expect(new Set(nomes).size).toBe(nomes.length);
      for (const e of segmento.etiquetas) {
        expect(e.tag.length).toBeLessThanOrEqual(TAG_MAX);
        expect(PALETA_DE_ETIQUETAS, e.tag).toContain(e.cor);
      }
    });

    it("toda resposta rápida tem título, texto e atalho, sem repetir título nem atalho", () => {
      const respostas = segmento.respostas.flatMap((g) => g.respostas);
      expect(respostas.length).toBeGreaterThan(0);
      expect(new Set(respostas.map((r) => r.title.toLowerCase())).size).toBe(respostas.length);
      expect(new Set(respostas.map((r) => r.shortcut)).size).toBe(respostas.length);
      for (const g of segmento.respostas) expect(g.grupo.trim().length).toBeGreaterThan(0);
      for (const r of respostas) {
        expect(r.body.trim().length).toBeGreaterThan(10);
        expect(r.shortcut).toMatch(/^[a-z]{2,40}$/);
      }
    });

    it("todo tipo de agendamento respeita as restrições da tabela e gera slug único", () => {
      const slugs = segmento.tiposDeAgendamento.map((t) => slugDoTipo(t.name));
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const t of segmento.tiposDeAgendamento) {
        expect(CATEGORIAS).toContain(t.category);
        expect(LOCAIS).toContain(t.location_kind);
        expect(t.duration_minutes).toBeGreaterThanOrEqual(5);
        expect(t.duration_minutes).toBeLessThanOrEqual(1440);
        expect(t.name.length).toBeGreaterThanOrEqual(2);
        expect(t.name.length).toBeLessThanOrEqual(80);
      }
    });

    it("toda automação passa no schema da rota de criação, e só etiqueta o que o segmento traz", () => {
      const etiquetas = new Set(segmento.etiquetas.map((e) => e.tag));
      for (const a of segmento.automacoes) {
        const lido = createAutomationRuleSchema.safeParse(a);
        expect(lido.success, JSON.stringify(lido.error?.issues)).toBe(true);
        // Nenhum dado do segmento pode pedir para a regra nascer ligada.
        expect(a).not.toHaveProperty("is_active");
        for (const acao of a.actions) {
          if (acao.type === "add_tag") for (const tag of acao.config.tags) expect(etiquetas, tag).toContain(tag);
        }
      }
    });

    it("as regras da casa não trazem preço, prazo nem promessa em número", () => {
      expect(segmento.regrasDaCasa.trim().length).toBeGreaterThan(0);
      expect(segmento.regrasDaCasa).not.toMatch(/R\$|\d+\s*%|\d+\s*(dias|horas)/i);
    });
  });
});

/**
 * Um banco em memória do tamanho exato do que o aplicador toca: `select` com
 * `eq`/`is`, `insert` (linha ou lista), `update().eq()`, `single()`.
 */
function bancoFalso(organizacaoId: string) {
  const tabelas: Record<string, Array<Record<string, unknown>>> = {
    organizations: [{ id: organizacaoId, settings: { tags: ["VIP"], outra: 1 } }],
    message_template_groups: [],
    message_templates: [],
    calendar_event_types: [],
    automation_rules: [],
  };
  let seq = 0;
  const from = (tabela: string) => {
    const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
    let modo: "select" | "update" = "select";
    let patch: Record<string, unknown> = {};
    let inseridas: Array<Record<string, unknown>> | null = null;
    const linhas = () => tabelas[tabela]!.filter((l) => filtros.every((f) => f(l)));
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push((l) => l[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      update: (p: Record<string, unknown>) => ((modo = "update"), (patch = p), q),
      insert: (dado: Record<string, unknown> | Array<Record<string, unknown>>) => {
        inseridas = (Array.isArray(dado) ? dado : [dado]).map((l) => ({ id: `id-${++seq}`, ...l }));
        tabelas[tabela]!.push(...inseridas);
        return q;
      },
      single: async () => ({ data: (inseridas ?? linhas())[0] ?? null, error: null }),
      then: (ok: (r: { data: unknown; error: null }) => unknown) => {
        if (modo === "update") linhas().forEach((l) => Object.assign(l, patch));
        return Promise.resolve({ data: inseridas ?? linhas(), error: null }).then(ok);
      },
    };
    return q;
  };
  return { admin: { from } as never, tabelas };
}

describe("aplicarKitDoSegmento", () => {
  const ORG = "org-1";
  const saude = segmentoPorId("saude")!;

  it("grava as quatro peças na organização certa, com a automação desligada", async () => {
    const { admin, tabelas } = bancoFalso(ORG);
    const r = await aplicarKitDoSegmento(admin, ORG, "user-1", saude);

    expect(r.falhas).toEqual([]);
    expect(r.etiquetas).toBe(saude.etiquetas.length);
    expect(r.respostas).toBe(saude.respostas.flatMap((g) => g.respostas).length);
    expect(r.tiposDeAgendamento).toBe(saude.tiposDeAgendamento.length);
    expect(r.automacoes).toBe(saude.automacoes.length);

    // o que já estava em `settings` continua lá, e a etiqueta antiga também
    const settings = tabelas.organizations![0]!.settings as { tags: unknown[]; outra: number };
    expect(settings.outra).toBe(1);
    expect(settings.tags[0]).toBe("VIP");

    for (const tabela of ["message_template_groups", "message_templates", "calendar_event_types", "automation_rules"]) {
      for (const linha of tabelas[tabela]!) expect(linha.organization_id, tabela).toBe(ORG);
    }
    for (const regra of tabelas.automation_rules!) expect(regra).not.toHaveProperty("is_active");
    for (const modelo of tabelas.message_templates!) expect(modelo.owner_user_id).toBeNull();
  });

  it("rodar de novo não duplica nada", async () => {
    const { admin, tabelas } = bancoFalso(ORG);
    await aplicarKitDoSegmento(admin, ORG, "user-1", saude);
    const antes = JSON.stringify(tabelas);
    const r = await aplicarKitDoSegmento(admin, ORG, "user-1", saude);
    expect(r).toEqual({ etiquetas: 0, respostas: 0, tiposDeAgendamento: 0, automacoes: 0, falhas: [] });
    expect(JSON.stringify(tabelas)).toBe(antes);
  });

  it("uma peça que falha não derruba as outras", async () => {
    const { admin, tabelas } = bancoFalso(ORG);
    delete tabelas.calendar_event_types;
    const r = await aplicarKitDoSegmento(admin, ORG, "user-1", saude);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0]).toMatch(/^tiposDeAgendamento:/);
    expect(r.etiquetas).toBeGreaterThan(0);
    expect(r.automacoes).toBeGreaterThan(0);
  });
});
