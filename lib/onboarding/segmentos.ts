/**
 * SEGMENTOS — o ponto de partida pronto de cada ramo.
 *
 * O onboarding já perguntava "O que vocês fazem?" em texto livre e, com isso,
 * montava o quadro de clientes. Faltava o resto: quem instala para uma clínica
 * terminava o wizard com o quadro certo e NADA mais — sem etiqueta, sem resposta
 * rápida, sem tipo de agendamento, sem uma automação sequer. O segmento escolhido
 * no primeiro passo traz esse conjunto de uma vez.
 *
 * ─── O que um segmento É, e o que ele NÃO é ───────────────────────────────
 *
 * É um conjunto de DADOS: nomes de coluna, etiquetas, textos e regras simples.
 * Não é regra de negócio do cliente — preço, prazo, política e horário não
 * estão aqui e não podem estar: quem sabe é o dono, e o que o funcionário
 * afirma sobre isso vem do conhecimento e da memória que o dono cadastra.
 *
 * As automações nascem DESLIGADAS (o banco já cria regra com `is_active=false`,
 * e a rota de criação nunca aceita o contrário): o dono lê e liga. Uma regra que
 * o sistema ligasse sozinho, no primeiro dia, mexendo no quadro de alguém que
 * ainda não sabe que ela existe, seria o oposto de "pronto".
 *
 * ─── Por que os funis reaproveitam `pacotes-de-funil.ts` ──────────────────
 *
 * Quatro segmentos já tinham quadro pronto lá (clínica, imobiliária, curso,
 * loja). Reescrever as mesmas colunas aqui criaria duas listas para manter, e a
 * segunda envelhece calada. Os quatro novos seguem a mesma forma: sete colunas,
 * uma por passo do funcionário, na palavra do dono.
 *
 * Quem aplica: `lib/onboarding/aplicar-kit.ts`. Quem confere a forma de cada
 * peça contra o schema da rota de verdade: `segmentos.test.ts`.
 */
import { PACOTES, type PacoteDeFunil } from "@/lib/onboarding/pacotes-de-funil";
import type { PropostaDeFunil } from "@/lib/onboarding/proposta-de-funil";

/** Os tons que `lib/tags/cor-da-etiqueta.ts` aceita (a paleta de etiquetas). */
const AMARELO = "#ffe629";
const AMBAR = "#ffb224";
const VERMELHO = "#cf3716";
const VERDE = "#00655a";
const AZUL = "#0091ff";
const INDIGO = "#3e63dd";
const ROXO = "#ab4aba";
const CINZA = "#6f6f6f";

export interface EtiquetaDoSegmento {
  tag: string;
  cor: string;
  descricao: string;
}

export interface RespostaRapidaDoSegmento {
  title: string;
  body: string;
  shortcut: string;
}

export interface GrupoDeRespostasDoSegmento {
  grupo: string;
  respostas: RespostaRapidaDoSegmento[];
}

export interface TipoDeAgendamentoDoSegmento {
  name: string;
  category:
    | "consulta"
    | "procedimento"
    | "retorno"
    | "visita"
    | "vistoria"
    | "reuniao"
    | "call"
    | "orcamento"
    | "demonstracao"
    | "outro";
  duration_minutes: number;
  location_kind: "in_person" | "phone" | "whatsapp" | "video_link" | "google_meet";
  description: string;
}

/** A forma que `createAutomationRuleSchema` (lib/schemas/webhooks.ts) aceita. */
export interface AutomacaoDoSegmento {
  name: string;
  trigger_event: "lead.created" | "lead.won" | "lead.lost";
  actions: Array<
    | {
        type: "create_task";
        config: {
          titulo: string;
          vence_em_dias: number;
          atribuir_a: "dono_do_lead";
          prioridade: "low" | "medium" | "high" | "urgent";
        };
      }
    | { type: "add_tag"; config: { tags: string[]; destino: "card" | "contato" } }
  >;
}

export interface Segmento {
  id: string;
  /** Como aparece no cartão do primeiro passo. */
  rotulo: string;
  /** Uma linha: quem se reconhece aqui. */
  descricao: string;
  funil: PropostaDeFunil;
  etiquetas: EtiquetaDoSegmento[];
  respostas: GrupoDeRespostasDoSegmento[];
  tiposDeAgendamento: TipoDeAgendamentoDoSegmento[];
  automacoes: AutomacaoDoSegmento[];
  /**
   * Vai PREENCHIDO no campo "As regras da casa" do passo do funcionário — e o
   * dono edita antes de continuar. Só comportamento; nenhum preço, prazo ou
   * promessa.
   */
  regrasDaCasa: string;
}

function funilDoPacote(id: string): PropostaDeFunil {
  const pacote = PACOTES.find((p) => p.id === id);
  if (!pacote) throw new Error(`pacote de funil desconhecido: ${id}`);
  return pacote.proposta;
}

/** As três etiquetas de origem valem para todo ramo que anuncia. */
const ORIGENS: EtiquetaDoSegmento[] = [
  { tag: "Instagram", cor: ROXO, descricao: "Chegou pelo Instagram." },
  { tag: "Indicação", cor: VERDE, descricao: "Veio por indicação de outro cliente." },
  { tag: "Anúncio", cor: INDIGO, descricao: "Chegou por anúncio pago." },
];

/** As três regras que todo segmento leva, com o texto do ramo. */
function automacoesBase(textos: {
  primeiroContato: string;
  posVenda: string;
  diasDoPosVenda: number;
}): AutomacaoDoSegmento[] {
  return [
    {
      name: "Primeiro contato no mesmo dia",
      trigger_event: "lead.created",
      actions: [
        {
          type: "create_task",
          config: {
            titulo: textos.primeiroContato,
            vence_em_dias: 0,
            atribuir_a: "dono_do_lead",
            prioridade: "high",
          },
        },
      ],
    },
    {
      name: "Acompanhar depois de fechar",
      trigger_event: "lead.won",
      actions: [
        {
          type: "create_task",
          config: {
            titulo: textos.posVenda,
            vence_em_dias: textos.diasDoPosVenda,
            atribuir_a: "dono_do_lead",
            prioridade: "medium",
          },
        },
      ],
    },
    {
      name: "Marcar para retomar quem não fechou",
      trigger_event: "lead.lost",
      actions: [{ type: "add_tag", config: { tags: ["Retomar depois"], destino: "contato" } }],
    },
  ];
}

const RETOMAR: EtiquetaDoSegmento = {
  tag: "Retomar depois",
  cor: AMBAR,
  descricao: "Não fechou agora; vale voltar a falar mais adiante.",
};

export const SEGMENTOS: readonly Segmento[] = [
  {
    id: "saude",
    rotulo: "Saúde",
    descricao: "Clínica, consultório, laboratório ou profissional de saúde.",
    funil: funilDoPacote("clinica"),
    etiquetas: [
      { tag: "Particular", cor: AZUL, descricao: "Atendimento particular." },
      { tag: "Convênio", cor: VERDE, descricao: "Atendimento por convênio." },
      { tag: "Primeira consulta", cor: AMARELO, descricao: "Ainda não foi atendido aqui." },
      { tag: "Retorno", cor: CINZA, descricao: "Já é paciente e está voltando." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Agendamento",
        respostas: [
          {
            title: "Pedir dados para agendar",
            shortcut: "agendar",
            body: "Para eu agendar, me confirma por favor: nome completo, data de nascimento e se o atendimento é particular ou por convênio.",
          },
          {
            title: "Confirmar consulta",
            shortcut: "confirmar",
            body: "Passando para confirmar a sua consulta. Você consegue comparecer no horário marcado? Se precisar remarcar, é só me avisar por aqui.",
          },
          {
            title: "Remarcar",
            shortcut: "remarcar",
            body: "Sem problema, vamos remarcar. Qual período fica melhor para você: manhã ou tarde? E em quais dias da semana?",
          },
        ],
      },
      {
        grupo: "Informações",
        respostas: [
          {
            title: "Endereço e como chegar",
            shortcut: "endereco",
            body: "Nosso endereço é: [preencha o endereço]. Se quiser, te mando a localização para abrir no mapa.",
          },
          {
            title: "Não é atendimento de urgência",
            shortcut: "urgencia",
            body: "Por aqui não conseguimos atender urgência. Se for algo que não pode esperar, procure o pronto-atendimento mais próximo.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Consulta", category: "consulta", duration_minutes: 30, location_kind: "in_person", description: "Primeira consulta ou consulta de rotina." },
      { name: "Retorno", category: "retorno", duration_minutes: 20, location_kind: "in_person", description: "Retorno de quem já foi atendido." },
      { name: "Exame", category: "procedimento", duration_minutes: 30, location_kind: "in_person", description: "Exame ou procedimento simples." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e oferecer horário",
      posVenda: "Saber como {{contact.name}} está depois da consulta",
      diasDoPosVenda: 3,
    }),
    regrasDaCasa: [
      "Nunca dê diagnóstico, não indique remédio e não interprete exame: isso é com o profissional, na consulta.",
      "Se a pessoa relatar dor forte ou urgência, oriente a procurar o pronto-atendimento e avise a equipe.",
      "Antes de agendar, confirme nome completo e se é particular ou convênio.",
      "Não informe preço nem convênio aceito sem conferir no que a clínica cadastrou.",
    ].join("\n"),
  },
  {
    id: "estetica",
    rotulo: "Estética e beleza",
    descricao: "Clínica de estética, salão, barbearia, spa ou estúdio.",
    funil: {
      nome: "Atendimentos",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o que quer", passo: "qualifying" },
        { nome: "Avaliação marcada", passo: "qualified" },
        { nome: "Orçamento enviado", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
    etiquetas: [
      { tag: "Facial", cor: ROXO, descricao: "Interesse em procedimento facial." },
      { tag: "Corporal", cor: AZUL, descricao: "Interesse em procedimento corporal." },
      { tag: "Cabelo", cor: AMARELO, descricao: "Interesse em cabelo." },
      { tag: "Pacote", cor: VERDE, descricao: "Fechou ou quer pacote de sessões." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Agendamento",
        respostas: [
          {
            title: "Convidar para avaliação",
            shortcut: "avaliacao",
            body: "O ideal é começar por uma avaliação, para a gente entender o que você busca e indicar o melhor caminho. Qual dia e período ficam bons para você?",
          },
          {
            title: "Confirmar horário",
            shortcut: "confirmar",
            body: "Passando para confirmar o seu horário. Tudo certo para você? Se precisar remarcar, me avisa por aqui.",
          },
        ],
      },
      {
        grupo: "Informações",
        respostas: [
          {
            title: "Sobre valores",
            shortcut: "valor",
            body: "O valor depende do que for indicado para o seu caso. Na avaliação a gente te passa certinho, sem compromisso.",
          },
          {
            title: "Cuidados depois do procedimento",
            shortcut: "cuidados",
            body: "Vou te mandar as orientações de cuidado depois do procedimento. Qualquer coisa diferente do esperado, me chama aqui.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Avaliação", category: "consulta", duration_minutes: 30, location_kind: "in_person", description: "Primeira conversa para entender o que a pessoa busca." },
      { name: "Sessão", category: "procedimento", duration_minutes: 60, location_kind: "in_person", description: "Sessão de procedimento ou serviço." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e convidar para avaliação",
      posVenda: "Perguntar a {{contact.name}} como foi o resultado",
      diasDoPosVenda: 7,
    }),
    regrasDaCasa: [
      "Não prometa resultado nem garanta efeito de procedimento.",
      "Não indique procedimento sem avaliação: convide para avaliar primeiro.",
      "Não informe preço que não esteja cadastrado; na dúvida, diga que o valor sai na avaliação.",
      "Se a pessoa relatar reação ou dor depois de um procedimento, avise a equipe na hora.",
    ].join("\n"),
  },
  {
    id: "energia",
    rotulo: "Energia",
    descricao: "Energia solar, eficiência energética ou instalações elétricas.",
    funil: {
      nome: "Projetos",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Analisando a conta de luz", passo: "qualifying" },
        { nome: "Proposta enviada", passo: "qualified" },
        { nome: "Visita técnica e ajustes", passo: "negotiating" },
        { nome: "Contrato fechado", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
    etiquetas: [
      { tag: "Residencial", cor: AZUL, descricao: "Instalação em casa." },
      { tag: "Comercial", cor: INDIGO, descricao: "Instalação em comércio ou empresa." },
      { tag: "Rural", cor: VERDE, descricao: "Instalação em propriedade rural." },
      { tag: "Financiamento", cor: AMARELO, descricao: "Quer financiar o projeto." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Qualificação",
        respostas: [
          {
            title: "Pedir a conta de luz",
            shortcut: "conta",
            body: "Para eu calcular o seu projeto, me manda por favor uma foto da última conta de luz (frente inteira, com o consumo dos últimos meses).",
          },
          {
            title: "Perguntas do projeto",
            shortcut: "projeto",
            body: "Me conta: a instalação é em casa, comércio ou área rural? E o telhado é de qual tipo (cerâmica, fibrocimento, metálico ou laje)?",
          },
        ],
      },
      {
        grupo: "Proposta",
        respostas: [
          {
            title: "Agendar visita técnica",
            shortcut: "visita",
            body: "O próximo passo é uma visita técnica para confirmar as medidas e a estrutura. Qual dia e período ficam bons para receber nosso técnico?",
          },
          {
            title: "Retomar proposta enviada",
            shortcut: "proposta",
            body: "Conseguiu olhar a proposta que te enviei? Se tiver alguma dúvida sobre o projeto ou sobre as formas de pagamento, me fala que eu explico.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Visita técnica", category: "vistoria", duration_minutes: 60, location_kind: "in_person", description: "Visita para medir e conferir a estrutura do local." },
      { name: "Apresentação da proposta", category: "reuniao", duration_minutes: 30, location_kind: "video_link", description: "Conversa para apresentar o projeto e os valores." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e pedir a conta de luz",
      posVenda: "Confirmar com {{contact.name}} se a instalação ficou em ordem",
      diasDoPosVenda: 15,
    }),
    regrasDaCasa: [
      "Não prometa economia, prazo de retorno nem valor de parcela sem a análise da conta de luz.",
      "Sempre peça a foto da última conta antes de falar em tamanho de sistema.",
      "Não confirme prazo de instalação nem de homologação: quem informa é a equipe técnica.",
    ].join("\n"),
  },
  {
    id: "imobiliario",
    rotulo: "Mercado imobiliário",
    descricao: "Imobiliária, corretor, incorporadora ou administradora.",
    funil: funilDoPacote("imobiliaria"),
    etiquetas: [
      { tag: "Compra", cor: AZUL, descricao: "Quer comprar." },
      { tag: "Locação", cor: VERDE, descricao: "Quer alugar." },
      { tag: "Investidor", cor: INDIGO, descricao: "Compra para investir." },
      { tag: "Financiamento", cor: AMARELO, descricao: "Depende de financiamento." },
      { tag: "Proprietário", cor: ROXO, descricao: "Quer anunciar um imóvel." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Qualificação",
        respostas: [
          {
            title: "Entender o que procura",
            shortcut: "perfil",
            body: "Para eu te mandar opções certeiras: é para comprar ou alugar? Em qual região? Quantos quartos e qual a faixa de valor que você considera?",
          },
          {
            title: "Sobre financiamento",
            shortcut: "financiamento",
            body: "Você pretende financiar ou comprar à vista? Se for financiar, já tem aprovação de crédito ou quer ajuda para simular?",
          },
        ],
      },
      {
        grupo: "Visita",
        respostas: [
          {
            title: "Agendar visita",
            shortcut: "visita",
            body: "Posso agendar uma visita para você conhecer o imóvel. Qual dia e horário ficam melhores?",
          },
          {
            title: "Depois da visita",
            shortcut: "retorno",
            body: "O que você achou do imóvel que visitamos? Se não for exatamente o que procura, me conta o que faltou que eu busco outras opções.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Visita ao imóvel", category: "visita", duration_minutes: 45, location_kind: "in_person", description: "Visita acompanhada ao imóvel." },
      { name: "Reunião de proposta", category: "reuniao", duration_minutes: 30, location_kind: "video_link", description: "Conversa para alinhar proposta e condições." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e entender o que procura",
      posVenda: "Acompanhar {{contact.name}} na entrega das chaves e documentação",
      diasDoPosVenda: 7,
    }),
    regrasDaCasa: [
      "Não confirme disponibilidade, valor nem condição de imóvel sem conferir no que a imobiliária cadastrou.",
      "Não prometa aprovação de financiamento.",
      "Antes de mandar opções, entenda região, número de quartos e faixa de valor.",
    ].join("\n"),
  },
  {
    id: "automotivo",
    rotulo: "Setor automotivo",
    descricao: "Concessionária, loja de veículos, oficina ou autopeças.",
    funil: {
      nome: "Negociações",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o interesse", passo: "qualifying" },
        { nome: "Test-drive ou avaliação", passo: "qualified" },
        { nome: "Proposta na mesa", passo: "negotiating" },
        { nome: "Vendido", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
    etiquetas: [
      { tag: "Novo", cor: AZUL, descricao: "Interesse em veículo novo." },
      { tag: "Seminovo", cor: INDIGO, descricao: "Interesse em seminovo." },
      { tag: "Troca", cor: AMARELO, descricao: "Tem veículo para dar na troca." },
      { tag: "Financiamento", cor: VERDE, descricao: "Quer financiar." },
      { tag: "Oficina", cor: CINZA, descricao: "Procura serviço ou revisão." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Qualificação",
        respostas: [
          {
            title: "Entender o interesse",
            shortcut: "interesse",
            body: "Me conta qual modelo você tem em mente e se pretende dar um veículo na troca. Assim eu já te passo as opções que fazem sentido.",
          },
          {
            title: "Avaliar o usado",
            shortcut: "troca",
            body: "Para avaliar o seu veículo, me passa: modelo, ano, quilometragem e algumas fotos (frente, traseira, laterais e interior).",
          },
        ],
      },
      {
        grupo: "Visita",
        respostas: [
          {
            title: "Agendar test-drive",
            shortcut: "testdrive",
            body: "Que tal um test-drive? Qual dia e horário ficam bons para você vir até a loja? Só precisa trazer a habilitação.",
          },
          {
            title: "Retomar proposta",
            shortcut: "proposta",
            body: "Conseguiu avaliar a proposta? Se quiser, revejo as condições de entrada e parcela para chegarmos num valor que caiba para você.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Test-drive", category: "demonstracao", duration_minutes: 30, location_kind: "in_person", description: "Test-drive acompanhado na loja." },
      { name: "Avaliação do usado", category: "vistoria", duration_minutes: 30, location_kind: "in_person", description: "Avaliação presencial do veículo da troca." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e entender o modelo de interesse",
      posVenda: "Saber de {{contact.name}} como está sendo com o veículo",
      diasDoPosVenda: 15,
    }),
    regrasDaCasa: [
      "Não confirme valor, estoque, cor nem prazo de entrega sem conferir no que a loja cadastrou.",
      "Não dê valor de avaliação do usado por mensagem: a avaliação é presencial.",
      "Não prometa aprovação de financiamento nem taxa.",
    ].join("\n"),
  },
  {
    id: "casa",
    rotulo: "Casa e decoração",
    descricao: "Móveis planejados, arquitetura, decoração, reforma ou marcenaria.",
    funil: {
      nome: "Projetos",
      etapas: [
        { nome: "Novo contato", passo: "new" },
        { nome: "Já respondi", passo: "contacted" },
        { nome: "Entendendo o ambiente", passo: "qualifying" },
        { nome: "Medição marcada", passo: "qualified" },
        { nome: "Orçamento enviado", passo: "negotiating" },
        { nome: "Fechou", passo: "won" },
        { nome: "Não fechou", passo: "lost" },
      ],
    },
    etiquetas: [
      { tag: "Cozinha", cor: AMARELO, descricao: "Projeto de cozinha." },
      { tag: "Quarto", cor: AZUL, descricao: "Projeto de quarto ou closet." },
      { tag: "Sala", cor: INDIGO, descricao: "Projeto de sala." },
      { tag: "Reforma", cor: VERMELHO, descricao: "Envolve obra ou reforma." },
      { tag: "Projeto completo", cor: VERDE, descricao: "Casa ou apartamento inteiro." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Briefing",
        respostas: [
          {
            title: "Entender o ambiente",
            shortcut: "briefing",
            body: "Me conta qual ambiente você quer fazer e se já tem a planta ou as medidas. Se tiver fotos do espaço e referências do que gosta, pode mandar também.",
          },
          {
            title: "Agendar medição",
            shortcut: "medicao",
            body: "O próximo passo é a medição no local, para o projeto sair certinho. Qual dia e período ficam bons para receber a gente?",
          },
        ],
      },
      {
        grupo: "Orçamento",
        respostas: [
          {
            title: "Retomar orçamento",
            shortcut: "orcamento",
            body: "Conseguiu olhar o orçamento? Se quiser ajustar material, acabamento ou dividir em etapas, me fala que a gente refaz.",
          },
          {
            title: "Prazo de entrega",
            shortcut: "prazo",
            body: "O prazo começa a contar depois da aprovação do projeto e da confirmação das medidas. Assim que fecharmos, te passo a data combinada.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Medição no local", category: "vistoria", duration_minutes: 60, location_kind: "in_person", description: "Visita para medir o ambiente." },
      { name: "Apresentação do projeto", category: "reuniao", duration_minutes: 60, location_kind: "in_person", description: "Apresentação do projeto e do orçamento." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e pedir medidas ou planta",
      posVenda: "Confirmar com {{contact.name}} se a entrega e a montagem ficaram em ordem",
      diasDoPosVenda: 7,
    }),
    regrasDaCasa: [
      "Não passe valor fechado sem as medidas do ambiente; no máximo explique como o orçamento é feito.",
      "Não prometa prazo de entrega ou montagem que não esteja cadastrado.",
      "Peça sempre planta, medidas ou fotos antes de falar em projeto.",
    ].join("\n"),
  },
  {
    id: "educacao",
    rotulo: "Educação e idiomas",
    descricao: "Escola, curso, escola de idiomas, mentoria ou reforço.",
    funil: funilDoPacote("curso"),
    etiquetas: [
      { tag: "Presencial", cor: AZUL, descricao: "Quer aula presencial." },
      { tag: "Online", cor: INDIGO, descricao: "Quer aula online." },
      { tag: "Aula experimental", cor: AMARELO, descricao: "Fez ou vai fazer aula experimental." },
      { tag: "Bolsa", cor: VERDE, descricao: "Pediu bolsa ou desconto." },
      { tag: "Responsável", cor: CINZA, descricao: "Quem fala é o responsável pelo aluno." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Matrícula",
        respostas: [
          {
            title: "Entender o objetivo",
            shortcut: "objetivo",
            body: "Para eu indicar a turma certa: qual é o seu objetivo com o curso e qual o seu nível hoje? Prefere aula presencial ou online?",
          },
          {
            title: "Convidar para aula experimental",
            shortcut: "experimental",
            body: "Que tal fazer uma aula experimental para conhecer o método e a turma? Qual dia e horário ficam bons para você?",
          },
          {
            title: "Documentos da matrícula",
            shortcut: "matricula",
            body: "Para concluir a matrícula eu preciso de: nome completo, CPF, data de nascimento e um e-mail para o acesso. Se o aluno for menor, os dados do responsável também.",
          },
        ],
      },
      {
        grupo: "Informações",
        respostas: [
          {
            title: "Horários e turmas",
            shortcut: "turmas",
            body: "Temos turmas em diferentes horários. Me diz qual período funciona melhor para você (manhã, tarde ou noite) que eu te mando as opções.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [
      { name: "Aula experimental", category: "demonstracao", duration_minutes: 60, location_kind: "in_person", description: "Aula para conhecer o método e a turma." },
      { name: "Teste de nivelamento", category: "consulta", duration_minutes: 30, location_kind: "video_link", description: "Conversa para definir o nível do aluno." },
    ],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e convidar para aula experimental",
      posVenda: "Saber de {{contact.name}} como foi a primeira semana de aula",
      diasDoPosVenda: 7,
    }),
    regrasDaCasa: [
      "Não prometa resultado, fluência nem prazo para aprender.",
      "Não informe mensalidade, bolsa ou desconto que não esteja cadastrado.",
      "Quando o aluno for menor de idade, trate a matrícula com o responsável.",
    ].join("\n"),
  },
  {
    id: "ecommerce",
    rotulo: "E-commerce",
    descricao: "Loja online, loja de rua que vende pelo WhatsApp ou marketplace.",
    funil: funilDoPacote("loja"),
    etiquetas: [
      { tag: "Primeira compra", cor: AMARELO, descricao: "Ainda não comprou aqui." },
      { tag: "Recompra", cor: VERDE, descricao: "Já comprou antes." },
      { tag: "Carrinho abandonado", cor: AMBAR, descricao: "Deixou o carrinho sem finalizar." },
      { tag: "Troca ou devolução", cor: VERMELHO, descricao: "Pediu troca ou devolução." },
      { tag: "Atacado", cor: INDIGO, descricao: "Compra em quantidade." },
      ...ORIGENS,
      RETOMAR,
    ],
    respostas: [
      {
        grupo: "Venda",
        respostas: [
          {
            title: "Ajudar a escolher",
            shortcut: "escolher",
            body: "Me conta o que você procura que eu te ajudo a escolher. Se for presente, me diz para quem é.",
          },
          {
            title: "Formas de pagamento",
            shortcut: "pagamento",
            body: "Aceitamos Pix, cartão de crédito e boleto. Quer que eu te mande o link para finalizar a compra?",
          },
          {
            title: "Carrinho esquecido",
            shortcut: "carrinho",
            body: "Vi que você separou alguns itens e não finalizou. Ficou com alguma dúvida sobre o produto, o frete ou o pagamento? Posso te ajudar.",
          },
        ],
      },
      {
        grupo: "Pós-venda",
        respostas: [
          {
            title: "Pedido a caminho",
            shortcut: "rastreio",
            body: "Seu pedido já saiu. Vou te mandar o código de rastreio para você acompanhar a entrega.",
          },
          {
            title: "Troca ou devolução",
            shortcut: "troca",
            body: "Sem problema, a gente resolve. Me passa o número do pedido e me conta o que aconteceu com o produto, de preferência com uma foto.",
          },
        ],
      },
    ],
    tiposDeAgendamento: [],
    automacoes: automacoesBase({
      primeiroContato: "Responder {{contact.name}} e ajudar a escolher",
      posVenda: "Perguntar a {{contact.name}} se o pedido chegou certo",
      diasDoPosVenda: 7,
    }),
    regrasDaCasa: [
      "Não informe preço, estoque nem prazo de entrega sem conferir no catálogo.",
      "Não prometa desconto que não esteja cadastrado.",
      "Em pedido de troca ou devolução, peça o número do pedido e avise a equipe.",
    ].join("\n"),
  },
];

export const IDS_DE_SEGMENTO = SEGMENTOS.map((s) => s.id) as [string, ...string[]];

export function segmentoPorId(id: unknown): Segmento | null {
  return typeof id === "string" ? (SEGMENTOS.find((s) => s.id === id) ?? null) : null;
}

/** O segmento como pacote de quadro — a forma que o passo do funil já entende. */
export function pacoteDoSegmento(segmento: Segmento): PacoteDeFunil {
  return { id: segmento.id, comoSeApresenta: segmento.rotulo, proposta: segmento.funil };
}
