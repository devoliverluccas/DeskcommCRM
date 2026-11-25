-- manifest: **Saúde do número oficial (fase 5, item 5.5).** Quatro colunas em `channel_sessions`: `meta_quality_rating` (`GREEN|YELLOW|RED|UNKNOWN`, com CHECK — o código normaliza `HIGH/MEDIUM/LOW` e qualquer valor fora da lista para `UNKNOWN` antes de gravar), `meta_messaging_limit_tier` (`TIER_1K`… `TIER_UNLIMITED`, SEM CHECK: o vocabulário da Meta é aberto e já mudou — `TIER_50`, `TIER_250`, `TIER_2K` — e um CHECK faria o `update.sh` de um clone quebrar no dia em que ela criar outro degrau), `meta_account_event` (o último `account_update` da conta, vocabulário aberto, sem CHECK) e `meta_saude_atualizada_em`. Quem grava é o webhook do canal oficial (`phone_number_quality_update` e `account_update`) e a leitura pela Graph API ao abrir a tela (`lib/channels/meta/saude-do-numero.ts`); quem lê é a tela de Conexões e o resumo de campanha (`lib/campanhas/resumo-do-envio.ts`, o limite real de conversas). A queda para YELLOW/RED abre aviso `channel_number_alert` na Central (kind que já existe — sem mexer no CHECK de `agent_inbox_items`).
--
-- ─── Por que colunas, e não `channel_sessions.metadata` (DIRC) ─────────────
--
-- D (duplicar): vive aqui mesmo — é estado do NÚMERO, um por conexão, e a Meta
-- é a fonte; nós guardamos a última leitura, com a data. Não há outra tabela que
-- já saiba isso. I/R: nada a integrar nem referenciar. C (calcular): só pela
-- Graph, com credencial e rede — não dá para ler no resumo de campanha nem na
-- lista de conexões a cada render.
--
-- E não `metadata`: dois escritores concorrentes (webhook e tela) no mesmo jsonb
-- fariam read-modify-write e um apagaria o outro; e o resumo de campanha leria
-- um caminho de jsonb sem schema (anti-pattern 6). Coluna tipada resolve os dois
-- com o mesmo custo, no molde das `meta_webhook_override_*` vizinhas.
--
-- Aditiva e idempotente. Nada lê as colunas antes de o código novo subir, e o
-- código novo tolera a coluna ausente (clone que ainda não aplicou).

alter table public.channel_sessions add column if not exists meta_quality_rating text;
alter table public.channel_sessions add column if not exists meta_messaging_limit_tier text;
alter table public.channel_sessions add column if not exists meta_account_event text;
alter table public.channel_sessions add column if not exists meta_saude_atualizada_em timestamptz;

-- Auto-curativo antes da constraint: valor fora da lista vira UNKNOWN (o mesmo
-- que o código faria), e o ADD não falha num clone que gravou algo à mão.
update public.channel_sessions
   set meta_quality_rating = 'UNKNOWN'
 where meta_quality_rating is not null
   and meta_quality_rating not in ('GREEN', 'YELLOW', 'RED', 'UNKNOWN');

alter table public.channel_sessions drop constraint if exists channel_sessions_meta_quality_rating_check;
alter table public.channel_sessions add constraint channel_sessions_meta_quality_rating_check
  check (meta_quality_rating in ('GREEN', 'YELLOW', 'RED', 'UNKNOWN'));

comment on column public.channel_sessions.meta_quality_rating is
  'Qualidade do número oficial na Meta (GREEN/YELLOW/RED/UNKNOWN), última leitura (webhook phone_number_quality_update ou Graph API). Migration 9496.';
comment on column public.channel_sessions.meta_messaging_limit_tier is
  'Limite de conversas iniciadas pela empresa em 24h (messaging_limit_tier: TIER_1K, TIER_10K, TIER_100K, TIER_UNLIMITED...). Vocabulário aberto da Meta, sem CHECK. Migration 9496.';
comment on column public.channel_sessions.meta_account_event is
  'Último evento account_update da conta do WhatsApp Business (ex.: ACCOUNT_RESTRICTION). Vocabulário aberto, sem CHECK. Migration 9496.';
comment on column public.channel_sessions.meta_saude_atualizada_em is
  'Quando a saúde do número oficial foi lida pela última vez. Migration 9496.';

notify pgrst, 'reload schema';
