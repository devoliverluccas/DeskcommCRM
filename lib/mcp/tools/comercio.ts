/**
 * Capacidades de COMÉRCIO — o que o cliente já comprou e o que existe à venda.
 *
 * Ficou de fora do épico até ser cobrado, e era a lacuna mais direta do pilar 1:
 * um agente de vendas que não enxerga o catálogo nem o histórico de pedidos
 * negocia no escuro — promete o que não existe, ou repete uma oferta que o
 * cliente já comprou.
 *
 * Service role bypassa RLS: TODA query filtra `organization_id` manualmente, e a
 * fonte é sempre `ctx.organizationId` (token/cookie), NUNCA o input.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";
import { buscarComRelaxamento } from "@/lib/catalogo/busca";
import { CANDIDATOS_DA_BUSCA, candidatosDaBusca } from "@/lib/catalogo/busca-no-banco";
import { emPromocao, precoVigente } from "@/lib/catalogo/preco";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { formatCents } from "@/lib/money";

// ---------------------------------------------------------------------------
// pedidos de um cliente
// ---------------------------------------------------------------------------

const pedidosInputShape = {
  contact_id: z.string().uuid().describe("O cliente cujos pedidos se quer ver."),
  limite: z.number().int().min(1).max(20).optional().default(10),
};

export const crmListContactOrders: McpToolDefinition<typeof pedidosInputShape> = {
  name: "crm_list_contact_orders",
  description:
    "Lista os pedidos de um contato, do mais recente para o mais antigo, com status, valor, " +
    "forma de pagamento, situação de entrega e código de rastreio. Use antes de prometer prazo " +
    "ou repetir oferta: o cliente pode já ter comprado." +
    " Em conversa de atendimento, devolve apenas os pedidos do contato desta conversa.",
  inputSchema: pedidosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    // ── OS PEDIDOS DE QUEM NÃO É DESTA CONVERSA NÃO SÃO DESTA LEITURA (#2178) ─
    //
    // A mesma recusa de `crm_get_contact` (#2158), e ANTES da consulta: a
    // chamada é por `contact_id`, então o pedido de OUTRO cliente da mesma
    // organização é recusado com motivo em texto e a linha nunca sai do
    // banco. Pedidos são valor, entrega e rastreio — dado que, uma vez lido,
    // vai para o WhatsApp do cliente A encaminhável, sem volta.
    //
    // RECUSA, e não tradução: trocar o `contact_id` pelo do turno faria o
    // modelo perguntar pelo pedido de um cliente e receber o de outro.
    //
    // `ctx.contatoDoTurno` é contexto de CONFIANÇA (injetado por
    // `lib/ai/runtime/tools.ts`, nunca escrito pelo modelo); sem ele — rota
    // HTTP, MCP externo, agente sem conversa — os pedidos de qualquer
    // contato da organização seguem vindo como antes. O Operador recebe o
    // contato do turno e também fica escopado.
    if (ctx.contatoDoTurno && input.contact_id !== ctx.contatoDoTurno) {
      return {
        permitido: false,
        motivo: "fora_da_conversa",
        mensagem:
          "esta conversa é com outra pessoa — os pedidos de um cliente que não é o desta " +
          "conversa não são seus para ver; siga a conversa com quem está falando.",
      };
    }
    const { data, error } = await ctx.supabase
      .from("orders")
      .select(
        "id, external_id, external_provider, status, total_cents, currency, payment_method, fulfillment_status, tracking_code, ordered_at, is_anonymized",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("contact_id", input.contact_id)
      .order("ordered_at", { ascending: false, nullsFirst: false })
      .limit(input.limite);

    if (error) throw new Error(`listar_pedidos_falhou: ${error.message}`);

    return {
      pedidos: (data ?? []).map((p) => ({
        ...p,
        // Pedido anonimizado por LGPD continua contando para histórico, mas o
        // conteúdo não volta: dizer isso é melhor que devolver campos vazios e
        // deixar o modelo concluir que o cliente nunca comprou.
        ...(p.is_anonymized ? { aviso: "pedido anonimizado a pedido do titular" } : {}),
      })),
    };
  },
};

// ---------------------------------------------------------------------------
// buscar no catálogo
// ---------------------------------------------------------------------------

const produtosInputShape = {
  termo: z
    .string()
    .trim()
    .min(2)
    .describe("o que a pessoa disse — pode ser o nome, a marca, o código ou tudo junto"),
  limite: z.number().int().min(1).max(20).optional().default(8),
  somente_disponiveis: z.boolean().optional().default(true),
};

/**
 * O aviso que a busca manda junto com o resultado.
 *
 * ⚠️ OS DOIS SOMAM, NÃO SE EXCLUEM — e a ordem importa. Eram `if/else` com o
 * empate ganhando, e a precedência reabria justamente o buraco que o
 * relaxamento veio fechar. Medido: "iphone 15 pro 512" numa loja sem nenhum 512
 * relaxa, acha o 128 e o 256, os dois empatam em 1.000 — e o agente recebia
 * "pergunte qual é" em vez de "não há 512 aqui". Ele perguntaria "128 ou 256?"
 * a quem pediu 512.
 *
 * E não é coincidência rara: os dois coincidem SEMPRE que a variante ausente
 * empata os candidatos restantes, que é o formato do caso.
 *
 * O relaxamento vem primeiro porque é a restrição mais forte: saber que a loja
 * não tem o que foi pedido muda a resposta inteira; saber qual dos dois é
 * apenas a próxima pergunta.
 */
/**
 * As colunas que a busca lê. `preco_promocional_cents` entra porque o preço que
 * o agente responde é o VIGENTE (`precoVigente`), o mesmo do orçamento.
 */
const COLUNAS_DA_BUSCA =
  "id, codigo, nome, descricao, marca, categoria, capacidade, preco_cents, preco_promocional_cents, " +
  "moeda, controla_estoque, quantidade, ativo, fotos";

export function avisosDaBusca(input: { empate: boolean; ignorados: readonly string[] }): string {
  const avisos: string[] = [];
  if (input.ignorados.length > 0) {
    avisos.push(
      `não há produto com ${input.ignorados.join(" nem ")} no catálogo desta loja. ` +
        "O que está aqui foi encontrado IGNORANDO esse número. Se ele era a capacidade, o " +
        "tamanho ou o modelo que a pessoa pediu, diga que a loja não tem essa opção — " +
        "NÃO responda o preço destes como se fossem o que ela pediu. Se era quantidade ou " +
        "orçamento, siga normalmente.",
    );
  }
  if (input.empate) {
    avisos.push(
      "mais de um produto casa igualmente o que a pessoa disse, e o preço deles é diferente. " +
        "Pergunte qual é antes de responder valor.",
    );
  }
  return avisos.join(" ");
}

/**
 * O vocabulário fechado do vazio desta busca. Quem contar "não achei" depois —
 * por loja, por termo — conta por estes valores, não por texto de mensagem.
 *
 * `varredura_parcial` não é mais emitido (migration 9481: os candidatos vêm do
 * catálogo inteiro, não há teto a estourar). Fica no vocabulário porque a
 * auditoria já gravada o tem, e quem lê o histórico precisa reconhecê-lo.
 */
export type MotivoDeVazio = "sem_estoque" | "varredura_parcial" | "nao_encontrado";

/**
 * "Não achei" NÃO é sucesso.
 *
 * A busca já sabe distinguir "não achei" de "falhei" — é o que as três respostas
 * vazias dizem ao modelo. O que faltava era DIZER ISSO À AUDITORIA: a chamada
 * terminava bem, `metadata.success` virava `true`, e o painel de capacidades
 * (`fn_agent_tool_usage`) contava `falhas: 0` enquanto o agente nunca achava um
 * produto e o dono lia "nenhuma falha" (issue #484). A busca que não acha nada é
 * exatamente a que o dono precisa ver.
 *
 * Quem lê este predicado é a auditoria em `lib/ai/runtime/tools.ts`. Vazio
 * declarado = o vazio que carrega `motivo`; resposta com item = sucesso, como
 * sempre foi.
 */
export function motivoDoVazioDaBusca(resultado: unknown): string | null {
  if (resultado === null || typeof resultado !== "object") return null;
  const r = resultado as { produtos?: unknown; motivo?: unknown };
  if (!Array.isArray(r.produtos) || r.produtos.length > 0) return null;
  return typeof r.motivo === "string" && r.motivo.length > 0 ? r.motivo : null;
}

export const crmSearchProducts: McpToolDefinition<typeof produtosInputShape> = {
  name: "crm_search_products",
  description:
    "Busca no catálogo da loja e devolve o PREÇO EXATO, o que está disponível e o código de cada " +
    "produto. Use SEMPRE que a pessoa perguntar preço, e responda com o valor que voltar aqui — " +
    "nunca com um valor que você lembra ou estima: preço errado dito a um cliente é promessa que a " +
    "loja terá de cumprir ou desfazer. " +
    "Passe o que a pessoa escreveu, do jeito que ela escreveu: a busca entende erro de digitação " +
    "('ifone') e acha por marca, categoria ou código. " +
    "⚠️ SE VOLTAR MAIS DE UM produto com `empate: true`, NÃO escolha por conta própria — os dois " +
    "casam igualmente o que ela disse, e a diferença entre eles é de preço. Pergunte qual é. " +
    "A busca olha o catálogo INTEIRO. Lista vazia quer dizer que nada no catálogo se parece com o " +
    "que a pessoa disse (ou que o que existe está sem estoque — a resposta diz qual dos dois): não " +
    "invente preço e nunca use um valor que você lembra; diga que vai confirmar com a equipe. " +
    "Produto com `preco_original` está em promoção: `preco` é o promocional, o que vale agora. " +
    "Produto com `fotos` tem foto cadastrada: ao apresentá-lo, passe o `codigo` dele em " +
    "`produto_codigo` no send_message, e a foto vai junto com o texto.",
  inputSchema: produtosInputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  // Vazio aqui não é sucesso: `produtos: []` com motivo é "não achei" e passa a
  // ser auditado como falha, para o painel parar de dizer "nenhuma falha"
  // enquanto ninguém acha nada (#484). Tool sem este campo segue tratando vazio
  // como sucesso — agenda vazia numa janela é resposta, não falha.
  motivoDoVazio: motivoDoVazioDaBusca,
  // O que a pessoa escreveu vai junto do registro: é o que deixa o painel
  // contar "não achei POR TERMO" — a lista de compras do dono da loja (issue
  // #484, caminho 2). O termo já viaja em `args`, mas declarado aqui sobe para
  // `metadata.termo`, chave única que a leitura no banco lê sem conhecer tool.
  termoBuscado: (input) => (input.termo.trim().length > 0 ? input.termo.trim() : null),
  handler: async (input, ctx) => {
    // ─── Os candidatos vêm do BANCO, do catálogo inteiro (migration 9481) ────
    //
    // Antes: os ativos da org em páginas de 1000, até 10 páginas, pontuados em
    // memória. Teto de 10 mil itens — num catálogo de 77 mil, o produto que
    // existe "não era encontrado", e a busca só conseguia dizer
    // `varredura_parcial`. Agora `fn_buscar_produtos` devolve os mais
    // parecidos do catálogo INTEIRO, e a pontuação de `lib/catalogo/busca.ts`
    // roda em cima deles: a régua (palavra difusa, número exato), o empate e o
    // relaxamento são os mesmos. Ver `lib/catalogo/busca-no-banco.ts`.
    //
    // A org é `ctx.organizationId` (token/cookie), NUNCA o input: o service
    // role bypassa a RLS, e quem corta é o `p_org` da função.

    type Linha = {
      id: string;
      codigo: string;
      nome: string;
      descricao: string | null;
      marca: string | null;
      categoria: string | null;
      capacidade: string | null;
      preco_cents: number;
      preco_promocional_cents?: number | null;
      moeda: string;
      controla_estoque: boolean;
      quantidade: number;
      fotos: string[] | null;
    };

    // Desligada na empresa, a capacidade guardada não pontua nem sai na resposta.
    const capacidadeLigada = (await capacidadesDaOrganizacao(ctx.supabase, ctx.organizationId)).includes(
      "capacidade_do_produto",
    );
    const preparar = (linhas: Linha[]): Linha[] =>
      capacidadeLigada ? linhas : linhas.map((linha) => ({ ...linha, capacidade: null }));

    // `controla_estoque` é o conserto de uma armadilha da versão anterior, que
    // filtrava por quantidade sempre: numa loja que não conta estoque (decant de
    // perfume, item sob encomenda) o catálogo INTEIRO ficava invisível.
    const vendavel = (p: Linha) => !p.controla_estoque || p.quantidade > 0;

    // Os candidatos chegam SEM o filtro de estoque, de propósito: "existe mas
    // está sem estoque" e "não existe" são vazios diferentes, e o relaxamento
    // de número precisa enxergar o produto esgotado para não dizer "não há 512
    // aqui" a quem pediu um 512 que só acabou.
    const candidatos = preparar(
      await candidatosDaBusca<Linha>(ctx.supabase, ctx.organizationId, input.termo, {
        colunas: COLUNAS_DA_BUSCA,
      }),
    );
    let { achados, ignorados } = buscarComRelaxamento(candidatos, input.termo);
    let disponiveis = input.somente_disponiveis ? achados.filter((a) => vendavel(a.produto)) : achados;

    // Os 200 candidatos são os mais PARECIDOS, sem olhar estoque. Numa loja em
    // que os 200 mais parecidos estão esgotados, um vendável pode estar logo
    // depois — então, quando o lote veio cheio e faltou vendável, pede-se de
    // novo SÓ os vendáveis, e a nota roda sobre a união.
    if (
      input.somente_disponiveis &&
      disponiveis.length < input.limite &&
      candidatos.length >= CANDIDATOS_DA_BUSCA
    ) {
      const soVendaveis = preparar(
        await candidatosDaBusca<Linha>(ctx.supabase, ctx.organizationId, input.termo, {
          colunas: COLUNAS_DA_BUSCA,
          somenteDisponiveis: true,
        }),
      );
      const vistos = new Set(candidatos.map((c) => c.id));
      const uniao = [...candidatos, ...soVendaveis.filter((c) => !vistos.has(c.id))];
      ({ achados, ignorados } = buscarComRelaxamento(uniao, input.termo));
      disponiveis = achados.filter((a) => vendavel(a.produto));
    }

    const topo = disponiveis.slice(0, input.limite);

    if (topo.length === 0) {
      if (achados.length > 0) {
        return {
          produtos: [],
          // Existe, mas ninguém pode comprar. Para a auditoria isto é vazio
          // declarado — "não achei um produto que dê para vender" —, não sucesso.
          motivo: "sem_estoque" satisfies MotivoDeVazio,
          mensagem:
            "esse produto existe no catálogo, mas está sem estoque. Não prometa: ofereça avisar quando chegar.",
        };
      }
      // A busca olhou o catálogo INTEIRO (não há mais teto de varredura): o
      // vazio aqui é ausência, e afirmá-la é informação útil ao cliente.
      return {
        produtos: [],
        motivo: "nao_encontrado" satisfies MotivoDeVazio,
        mensagem:
          "não há nada com esse nome no catálogo da loja. Não invente preço — diga que vai confirmar com a equipe.",
      };
    }

    // Empate é o sinal de que a pessoa precisa escolher. Ex.: "iphone 15 pro 256"
    // casa o Pro e o Pro Max igualmente, e a diferença entre eles é o preço.
    const empate = topo.length > 1 && topo[0]!.nota === topo[1]!.nota;

    const mensagem = avisosDaBusca({ empate, ignorados });

    return {
      produtos: topo.map(({ produto }) => {
        // O preço que vale AGORA — o mesmo que o orçamento usa (`precoVigente`).
        const vigente = precoVigente(produto);
        return {
          codigo: produto.codigo,
          nome: produto.nome,
          preco: formatCents(vigente, produto.moeda),
          preco_cents: vigente,
          // Em promoção, o de antes vai junto: o agente pode dizer "de X por Y",
          // e nunca confunde qual dos dois cobrar.
          ...(emPromocao(produto)
            ? { preco_original: formatCents(produto.preco_cents, produto.moeda), em_promocao: true }
            : {}),
          ...(produto.marca ? { marca: produto.marca } : {}),
          ...(produto.descricao ? { descricao: produto.descricao } : {}),
          ...(produto.capacidade ? { capacidade: produto.capacidade } : {}),
          disponivel: vendavel(produto),
          // Quantas fotos, e não quais: o caminho é vocabulário interno e a URL
          // assinada expira. Quem manda a foto é o `send_message` do agente, com
          // `produto_codigo` — ele acha as fotos pelo código (migration 0390).
          ...(produto.fotos && produto.fotos.length > 0 ? { fotos: produto.fotos.length } : {}),
        };
      }),
      empate,
      // Relaxamento é o irmão do empate: nos dois a busca sabe que a resposta
      // NÃO é exatamente o que foi pedido, e nos dois quem decide é a pessoa.
      // A diferença é o que falta — no empate, qual das opções; aqui, se o
      // número que sumiu importava.
      ...(ignorados.length > 0 ? { numeros_ignorados: ignorados } : {}),
      ...(mensagem ? { mensagem } : {}),
    };
  },
};
