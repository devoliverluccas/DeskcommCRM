-- manifest: o chat do site entra no seam de canais como provedor `webchat` — a sessão guarda a chave PÚBLICA que o snippet leva (`webchat_public_key`) e a configuração da janela (`webchat_config`: nome, saudação, cor, posição, domínios, ligado); `'webchat'` entra no vocabulário de `channel_sessions.provider`, no ramo do `channel_sessions_provider_ref_check` e em `conversations_channel_check`. Fase 5, item 5.3.
--
-- ─── O que entra ───────────────────────────────────────────────────────────
--
--   1. Duas colunas em `channel_sessions`:
--      • `webchat_public_key` — a chave que vai no `<script data-chave="…">`
--        colado no site. É PÚBLICA por natureza (qualquer visitante a lê no HTML),
--        por isso não é cifrada; ela só identifica a conexão. O que protege é o
--        servidor: Origin conferido contra os domínios permitidos, limite por IP
--        e por visitante, e nenhuma leitura sem o token do visitante.
--      • `webchat_config` — jsonb com schema CENTRAL em
--        `lib/channels/webchat/config.ts` (Zod). Ninguém lê path solto: quem lê
--        passa pelo parse, e um valor fora do schema cai no padrão.
--   2. `'webchat'` no vocabulário de `channel_sessions.provider` e no ramo do
--      `channel_sessions_provider_ref_check` (esta linha exige a chave pública).
--   3. `'webchat'` em `conversations_channel_check` — a ingestão grava o canal
--      na conversa; sem o valor o UPDATE volta 23514.
--   4. Índice único da chave pública: duas conexões com a mesma chave fariam o
--      visitante de um site cair na caixa de entrada de outra organização.
--
-- ─── Por que NÃO há tabela de visitantes ───────────────────────────────────
--
-- DIRC: o visitante é um CONTATO sem telefone, identificado por
-- `contacts.social_identity` (`webchat:<sessão>:<hash do token>`) no molde da
-- 0368/9342. O token cru vive só no localStorage do navegador do visitante; o
-- banco guarda o SHA-256 dele. Conversa, mensagens, anonimização (LGPD) e
-- fusão de fichas já funcionam por contato — uma tabela à parte duplicaria a
-- identidade sem dono declarado.
--
-- ─── Reaplicação ───────────────────────────────────────────────────────────
--
-- `add column if not exists`; constraints trocadas dentro de bloco `do` (com o
-- `update.sh` sem `ON_ERROR_STOP`, `drop` e `add` soltos deixariam a tabela SEM
-- guarda se o `add` falhasse); `create index if not exists`. Alargamento puro
-- dos vocabulários: nenhuma linha que passava pela lista antiga falha na nova,
-- então não há backfill.

alter table public.channel_sessions
  add column if not exists webchat_public_key text,
  add column if not exists webchat_config jsonb;

-- Forma da chave e do jsonb. Nasce num bloco só (drop + add): reaplicar não
-- duplica, e um add que falhe não deixa a coluna sem guarda.
do $webchat_forma$
begin
  alter table public.channel_sessions drop constraint if exists channel_sessions_webchat_forma_check;
  alter table public.channel_sessions add constraint channel_sessions_webchat_forma_check check (
    (webchat_public_key is null or webchat_public_key ~ '^[A-Za-z0-9_-]{32,64}$')
    and (webchat_config is null or jsonb_typeof(webchat_config) = 'object')
  );
end
$webchat_forma$;

do $$
begin
  if to_regclass('public.channel_sessions') is not null then
    comment on column public.channel_sessions.webchat_public_key is
      'Chave PÚBLICA do chat do site (vai no data-chave do snippet). Só identifica a conexão; a proteção é Origin conferido + limite por IP/visitante. Lida por lib/channels/webchat/sessao.ts.';
    comment on column public.channel_sessions.webchat_config is
      'Configuração do chat do site (nome, saudação, cor, posição, domínios permitidos, ligado). Schema central em lib/channels/webchat/config.ts; ninguém lê path solto.';
  end if;
end
$$;

-- ─── Vocabulário do provider ───────────────────────────────────────────────
do $$
begin
  alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
  alter table public.channel_sessions add constraint channel_sessions_provider_check
    check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text,
                                 'wacalls'::text, 'zernio_social'::text, 'datafy'::text,
                                 'telegram'::text, 'webchat'::text]));

  alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
  alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls'    and wacalls_session_id    is not null) or
    (provider = 'datafy'     and datafy_phone_number_id is not null) or
    (provider = 'telegram'   and telegram_bot_id      is not null) or
    (provider = 'webchat'    and webchat_public_key   is not null)
  );
end
$$;

-- ─── Vocabulário do canal da conversa ──────────────────────────────────────
do $$
begin
  alter table public.conversations drop constraint if exists conversations_channel_check;
  alter table public.conversations add constraint conversations_channel_check
    check (channel in ('whatsapp', 'instagram', 'facebook', 'telegram', 'webchat'));
end
$$;

-- ─── Uma chave, uma conexão ────────────────────────────────────────────────
create unique index if not exists channel_sessions_webchat_public_key_unique
  on public.channel_sessions (webchat_public_key)
  where webchat_public_key is not null;

notify pgrst, 'reload schema';
