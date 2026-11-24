-- manifest: conversões para GA4 e TikTok — a conexão de conversões aceita as plataformas `ga4` e `tiktok` (o CHECK de plataforma conhecida ganha os dois slugs) e cada conexão guarda o mapeamento evento da casa → evento da plataforma em `event_mapping` (jsonb objeto; o schema vive em lib/plataformas-de-anuncio/mapeamento-de-eventos.ts). As credenciais reusam `dataset_id` (measurement_id / pixel_code) e `access_token_encrypted` (api_secret / access token), cifradas como as da Meta.
--
-- Por que coluna em `ad_platform_connections` e não chave em `organizations.settings`:
-- o mapeamento é da CONEXÃO (uma por plataforma por organização), é gravado no mesmo
-- upsert da credencial e lido no mesmo select do envio. Em `settings` ele seria um
-- segundo escritor de um jsonb que outras telas reescrevem inteiro.
--
-- `ad_conversion_dispatches.platform` não tem CHECK (texto livre desde a 0213): o
-- livro-razão aceita os slugs novos sem migration. As tabelas do eixo de LEITURA
-- (`ad_insights_connections`, `ad_hierarchy_cache`) ficam como estão: GA4 e TikTok
-- não têm leitura de campanha nesta entrega.

alter table public.ad_platform_connections
  drop constraint if exists ad_platform_connections_platform_conhecida;
alter table public.ad_platform_connections
  add constraint ad_platform_connections_platform_conhecida
  check (platform in ('meta_ads', 'google_ads', 'ga4', 'tiktok'));

alter table public.ad_platform_connections
  add column if not exists event_mapping jsonb not null default '{}'::jsonb;

-- Auto-cura antes do CHECK: um clone que tenha gravado algo que não é objeto
-- (não deveria existir — a coluna nasce aqui) volta ao padrão em vez de quebrar
-- o `update.sh`.
update public.ad_platform_connections
   set event_mapping = '{}'::jsonb
 where jsonb_typeof(event_mapping) is distinct from 'object';

alter table public.ad_platform_connections
  drop constraint if exists ad_platform_connections_event_mapping_objeto;
alter table public.ad_platform_connections
  add constraint ad_platform_connections_event_mapping_objeto
  check (jsonb_typeof(event_mapping) = 'object');

comment on column public.ad_platform_connections.event_mapping is
  'Mapeamento evento da casa (Purchase, LeadSubmitted, QualifiedLead) para o nome do evento na plataforma (GA4/TikTok). null num evento = não enviar. Schema em lib/plataformas-de-anuncio/mapeamento-de-eventos.ts. Meta e Google não usam.';

notify pgrst, 'reload schema';
