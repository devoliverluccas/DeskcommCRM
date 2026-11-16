# 10 — Redesign v2 (ferramenta de precisão calma)

> **Status:** proposta implementada na branch `redesign/design-system`. Troca quatro das cinco
> escolhas travadas na v1.0 (paleta, fonte, densidade, raio) — pelo `00-overview.md`, isso pede RFC
> antes de entrar na `main` do produto.
>
> **Fonte da verdade dos valores:** `app/globals.css`. Para ler em vez de acreditar nesta página:
> `grep -nE -- '--(radius|density|shadow)-|--font-sans|--text-sm|--color-(hover|pressed)' app/globals.css`

## O que a auditoria mediu

Feita pela tela (Playwright, 1440 / 390, claro e escuro), não só pelo código:

1. **Peso sintetizado.** A Atkinson só tem 400 e 700; todo `font-medium` / `font-semibold`
   do produto (`grep -rE 'font-(medium|semibold)' app components | wc -l`) era peso falso do
   navegador, e o zero cortado dela aparecia em todo valor em dinheiro.
2. **A marca usada como neutro.** `accent` no shadcn é um cinza de hover; aqui é o Sage.
   Passar o mouse em qualquer item de menu, seletor ou linha pintava a cor da marca, e o
   item ativo da barra lateral era um bloco sólido — a ação primária da tela nunca ficava
   sozinha.
3. **Controles grandes, margens em dobro.** Botão e campo de 36–40px, e a página somando o
   `p-6` do `<main>` ao `p-6` da própria raiz (48px de margem).
4. **Cartão em volta de tudo.** Barra de filtro dentro de cartão, índice de configurações
   como mural de cartões (o anti-pattern 11 do próprio `09-anti-patterns.md`).

## O que mudou

| Eixo | v1 | v2 | Por quê |
|---|---|---|---|
| Paleta neutra | greige quente (`#faf9f6`, `#1c1a16`) | **cinza frio** (`#f7f7f8`, `#1a1a1e`; escuro `#0f0f11`) | Decisão do dono do fork: referência Linear/Attio |
| Destaque (accent) | Sage `#506d48` | **Sage, inalterado no código** | O motor de marca própria (`lib/branding`) é calibrado nessa rampa. Quem quer outro destaque usa Configurações › Marca ou `APP_ACCENT_HEX` — o fork usa cobalto `#2554e8` |
| Ação primária | accent | **tinta** (`bg-text text-bg`) | O ponto de maior contraste da tela nos dois temas |
| Casca | menu com borda + página contínua | **painel de conteúdo destacado** (`md+`): branco, raio 12, 8px de recuo; menu fundido ao fundo | `--casca-recuo` é descontado pelas telas que calculam altura |
| Barra do topo | busca ao centro | **trilha "Grupo › Tela"** à esquerda, busca à direita | Sai do catálogo de navegação |
| Fonte de interface | Atkinson Hyperlegible | **IBM Plex Sans** | Mesma família da Plex Mono dos dados; 500 e 600 reais. Continua fora de Inter/Geist. A Atkinson segue em Aparência |
| Corpo | `text-sm` 14px | **13px** (`--text-sm`) | Densidade de CRM. `text-base` fica 16px: é o que impede o zoom de foco do iOS |
| Raio | 4 / 8 / 12 / 16 | **4 / 6 / 8 / 12** | Selo / controle / superfície / modal |
| Linha de lista | 56px (Aerada) | **40px** (Equilibrada) | A lista cabe na tela sem perder o alvo do cursor |
| Controles (≥ `lg`) | 36px | **32px** (`sm` 28, `lg` 40) | Abaixo de `lg` seguem os 44px de toque |
| Hover / selecionado | accent | **`bg-hover` / `bg-pressed`** | Neutro derivado do texto do tema por `color-mix`; vale em claro, escuro e paletas |
| Cartão | borda + sombra | **só borda** | Sombra fica para o que flutua (menu, modal) |
| Cortina do modal | `black/80` | **`bg-overlay`** | O token já existia e ninguém usava |
| Dica (tooltip) | accent | **texto invertido** | Dica não é marca |

## Regras novas

- **A accent é para marca, ação primária e seleção de dado.** Estado de cursor é
  `hover:bg-hover`; item atual de navegação é `bg-pressed font-medium`.
- **Barra de filtro não tem moldura.** Campo e seletores direto na página.
- **Índice é lista, não mural.** Ver `components/shell/NavHub.tsx`.
- **Raiz de página usa `p-2`** — a margem é do `<main>` (`p-6`), a raiz só dá o respiro do
  foco. Título de página é `text-xl font-semibold tracking-tight`.

## O que NÃO mudou, de propósito

O mecanismo de marca própria e de Aparência, ícones Phosphor, a lei de movimento,
os alvos de 44px no toque, a altura da barra do topo (cinco telas calculam altura com
`3.5rem`) e o cartão do Kanban (altura fixa por contrato, medida por teste).

## O que supera

`03-typography.md` (família e pesos), `04-density-aerada.md` (linha e respiro) e a tabela de
raio de `01-foundation-tokens.md`. O resto daqueles documentos continua valendo.
