-- manifest: Lojas e filiais como módulo oficial de tabela (ADR-0002, item 5.4): cria só FUNÇÕES — `fn_lojas_provisionar()` (lojas, estoque_por_loja, loja_do_numero, proposta_da_loja, nascem só onde o módulo é instalado), o gatilho que confere a proposta da mesma organização, a troca atômica da loja padrão, a chave da empresa (`settings.lojas.enabled`) e o relatório de atendimentos recortado por loja. Nenhuma tabela do núcleo muda e nenhuma instalação muda sozinha.
--
-- 9495 — LOJAS E FILIAIS (módulo oficial de tabela, ADR-0002 D2/D3/D7).
--
-- Quem tem mais de um ponto de venda precisa dizer QUAL loja atende cada número,
-- quanto de cada produto há em cada loja e de qual loja saiu cada orçamento. Quem
-- tem uma loja só não carrega nada disso: as quatro tabelas nascem em
-- `fn_modulo_instalar('lojas', …)`, e a empresa ainda liga o uso dela em
-- Configurações › Lojas (`settings.lojas.enabled`, como `cadencias`).
--
-- Esta migration cria FUNÇÕES e tabela nenhuma. As funções de negócio são
-- PL/pgSQL e compilam sem as tabelas (D7): o PL/pgSQL só resolve a relação ao
-- executar, e cada uma confere `to_regclass` antes de usá-la.
--
-- ─── Por que a proposta tem tabela própria, e não coluna em `crm_proposals` ──
-- Coluna nova no núcleo para um módulo é exatamente o que a ADR proíbe (D4: a
-- provisionadora não mexe em tabela de fora). `metadata` não existe em
-- `crm_proposals`. A ligação mora em `proposta_da_loja`, 1:1 com a proposta,
-- criada pela provisionadora. Sem o módulo a proposta é a mesma de sempre.
--
-- ─── Escrita só pelo servidor ───────────────────────────────────────────────
-- `authenticated` lê a própria organização (`tenant_isolation_<t>_all`, por
-- `fn_user_org_ids()`) e NÃO tem grant de escrita: quem grava são as rotas de
-- `app/api/v1/lojas/**`, com o papel conferido e a organização da sessão. Sem
-- isso um `viewer` mudaria o estoque pelo PostgREST, passando por cima da regra
-- de papel. Como o módulo liga a RLS por conta própria, a rotina de proteção da
-- 0325 não sobrescreve a decisão (ela só enxerga tabela com RLS desligada), e a
-- trava do suporte trata a tabela como server-only (sem grant de escrita).

-- ─── 1 · a proposta é da mesma organização ─────────────────────────────────
-- `crm_proposals` não tem chave (organization_id, id), e a provisionadora não
-- pode acrescentá-la ao núcleo (D4). A conferência é gatilho na tabela do módulo.
create or replace function public.fn_lojas_conferir_proposta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if tg_op = 'UPDATE' and row(new.organization_id, new.proposal_id)
       is distinct from row(old.organization_id, old.proposal_id) then
    raise exception 'lojas_vinculo_imutavel' using errcode = '23514';
  end if;
  if not exists (select 1 from public.crm_proposals
                  where organization_id = new.organization_id and id = new.proposal_id) then
    raise exception 'lojas_vinculo_invalido' using errcode = '23503';
  end if;
  return new;
end $f$;
revoke execute on function public.fn_lojas_conferir_proposta() from public, anon, authenticated, service_role;

-- ─── 2 · a provisionadora (ADR-0002, D2) ───────────────────────────────────
-- Sem parâmetro, idempotente, só `service_role`.
create or replace function public.fn_lojas_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.lojas (
    id uuid not null default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    nome text not null,
    codigo text,
    endereco text,
    telefone text,
    ativa boolean not null default true,
    -- A loja que vale quando nada mais diz qual é. No máximo uma por
    -- organização (índice parcial abaixo); trocar é `fn_lojas_definir_padrao`.
    padrao boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint lojas_pkey primary key (id),
    -- Alvo das chaves compostas: estoque, número e proposta nunca apontam para
    -- loja de outra organização.
    constraint lojas_org_id_key unique (organization_id, id),
    constraint lojas_nome_check check (length(btrim(nome)) between 1 and 120),
    constraint lojas_codigo_check check (codigo is null or length(btrim(codigo)) between 1 and 40),
    constraint lojas_endereco_check check (endereco is null or length(endereco) <= 300),
    constraint lojas_telefone_check check (telefone is null or length(telefone) <= 40),
    -- Loja padrão desativada mandaria orçamento para um lugar que não atende.
    constraint lojas_padrao_ativa_check check (not padrao or ativa)
  );
  create unique index if not exists lojas_uma_padrao_por_org
    on public.lojas (organization_id) where padrao;
  create unique index if not exists lojas_codigo_por_org
    on public.lojas (organization_id, lower(codigo)) where codigo is not null;
  create unique index if not exists lojas_nome_por_org
    on public.lojas (organization_id, lower(nome));

  create table if not exists public.estoque_por_loja (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    loja_id uuid not null,
    product_id uuid not null,
    quantidade integer not null default 0,
    updated_at timestamptz not null default now(),
    constraint estoque_por_loja_pkey primary key (loja_id, product_id),
    constraint estoque_por_loja_loja_fkey foreign key (organization_id, loja_id)
      references public.lojas (organization_id, id) on delete cascade,
    -- `catalog_products_org_id_key` (organization_id, id) já existe no núcleo.
    constraint estoque_por_loja_produto_fkey foreign key (organization_id, product_id)
      references public.catalog_products (organization_id, id) on delete cascade,
    constraint estoque_por_loja_quantidade_check check (quantidade >= 0)
  );
  create index if not exists estoque_por_loja_produto_idx
    on public.estoque_por_loja (organization_id, product_id);

  create table if not exists public.loja_do_numero (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    channel_session_id uuid not null,
    loja_id uuid not null,
    updated_at timestamptz not null default now(),
    constraint loja_do_numero_pkey primary key (channel_session_id),
    -- `channel_sessions_org_id_unique` (organization_id, id) já existe no núcleo.
    constraint loja_do_numero_numero_fkey foreign key (organization_id, channel_session_id)
      references public.channel_sessions (organization_id, id) on delete cascade,
    constraint loja_do_numero_loja_fkey foreign key (organization_id, loja_id)
      references public.lojas (organization_id, id) on delete cascade
  );
  create index if not exists loja_do_numero_loja_idx
    on public.loja_do_numero (organization_id, loja_id);

  create table if not exists public.proposta_da_loja (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    proposal_id uuid not null references public.crm_proposals(id) on delete cascade,
    loja_id uuid not null,
    updated_at timestamptz not null default now(),
    constraint proposta_da_loja_pkey primary key (proposal_id),
    -- RESTRICT: apagar a loja apagaria de onde saíram os orçamentos dela. A
    -- tela oferece desativar; excluir só a loja que nunca orçou.
    constraint proposta_da_loja_loja_fkey foreign key (organization_id, loja_id)
      references public.lojas (organization_id, id) on delete restrict
  );
  create index if not exists proposta_da_loja_loja_idx
    on public.proposta_da_loja (organization_id, loja_id);

  drop trigger if exists trg_lojas_conferir_proposta on public.proposta_da_loja;
  create trigger trg_lojas_conferir_proposta
    before insert or update on public.proposta_da_loja
    for each row execute function public.fn_lojas_conferir_proposta();

  -- RLS por organização; leitura da sessão, escrita só do servidor.
  alter table public.lojas enable row level security;
  execute format('drop policy if exists %I on public.%I', 'tenant_isolation_' || 'lojas' || '_all', 'lojas');
  execute format('create policy %I on public.%I for all using (organization_id in (select * from public.fn_user_org_ids())) with check (organization_id in (select * from public.fn_user_org_ids()))', 'tenant_isolation_' || 'lojas' || '_all', 'lojas');
  revoke all on table public.lojas from anon, authenticated, service_role;
  grant select on table public.lojas to authenticated;
  grant select, insert, update, delete on table public.lojas to service_role;

  alter table public.estoque_por_loja enable row level security;
  execute format('drop policy if exists %I on public.%I', 'tenant_isolation_' || 'estoque_por_loja' || '_all', 'estoque_por_loja');
  execute format('create policy %I on public.%I for all using (organization_id in (select * from public.fn_user_org_ids())) with check (organization_id in (select * from public.fn_user_org_ids()))', 'tenant_isolation_' || 'estoque_por_loja' || '_all', 'estoque_por_loja');
  revoke all on table public.estoque_por_loja from anon, authenticated, service_role;
  grant select on table public.estoque_por_loja to authenticated;
  grant select, insert, update, delete on table public.estoque_por_loja to service_role;

  alter table public.loja_do_numero enable row level security;
  execute format('drop policy if exists %I on public.%I', 'tenant_isolation_' || 'loja_do_numero' || '_all', 'loja_do_numero');
  execute format('create policy %I on public.%I for all using (organization_id in (select * from public.fn_user_org_ids())) with check (organization_id in (select * from public.fn_user_org_ids()))', 'tenant_isolation_' || 'loja_do_numero' || '_all', 'loja_do_numero');
  revoke all on table public.loja_do_numero from anon, authenticated, service_role;
  grant select on table public.loja_do_numero to authenticated;
  grant select, insert, update, delete on table public.loja_do_numero to service_role;

  alter table public.proposta_da_loja enable row level security;
  execute format('drop policy if exists %I on public.%I', 'tenant_isolation_' || 'proposta_da_loja' || '_all', 'proposta_da_loja');
  execute format('create policy %I on public.%I for all using (organization_id in (select * from public.fn_user_org_ids())) with check (organization_id in (select * from public.fn_user_org_ids()))', 'tenant_isolation_' || 'proposta_da_loja' || '_all', 'proposta_da_loja');
  revoke all on table public.proposta_da_loja from anon, authenticated, service_role;
  grant select on table public.proposta_da_loja to authenticated;
  grant select, insert, update, delete on table public.proposta_da_loja to service_role;

  comment on table public.lojas is
    'Lojas e filiais (módulo opcional, ADR-0002): os pontos de venda da organização, com no máximo uma padrão.';
  comment on table public.estoque_por_loja is
    'Lojas e filiais: quantidade de cada produto do catálogo em cada loja. O total do catálogo segue em catalog_products.quantidade.';
  comment on table public.loja_do_numero is
    'Lojas e filiais: qual loja atende cada número conectado (channel_sessions). Sem linha, vale a loja padrão.';
  comment on table public.proposta_da_loja is
    'Lojas e filiais: de qual loja saiu cada orçamento (crm_proposals), 1:1.';

  perform public.fn_proteger_modulo_provisionado();
end
$f$;
revoke execute on function public.fn_lojas_provisionar() from public, anon, authenticated;
grant execute on function public.fn_lojas_provisionar() to service_role;

-- ─── 3 · a loja padrão troca numa transação só ─────────────────────────────
-- O índice parcial aceita uma padrão por organização; trocar em dois UPDATEs
-- soltos deixaria a organização sem padrão se o segundo falhasse. Aqui a
-- antiga sai e a nova entra juntas, e só loja ATIVA da organização vira padrão.
-- `p_loja` nulo tira a padrão. A organização vem do servidor (cookie validado).
create or replace function public.fn_lojas_definir_padrao(p_org uuid, p_loja uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if to_regclass('public.lojas') is null then
    raise exception 'lojas_nao_instalado' using errcode = 'P0002';
  end if;
  if p_loja is not null and not exists (
    select 1 from public.lojas where organization_id = p_org and id = p_loja and ativa
  ) then
    return false;
  end if;
  update public.lojas set padrao = false, updated_at = now()
   where organization_id = p_org and padrao and (p_loja is null or id <> p_loja);
  if p_loja is not null then
    update public.lojas set padrao = true, updated_at = now()
     where organization_id = p_org and id = p_loja and not padrao;
  end if;
  return true;
end $f$;
revoke execute on function public.fn_lojas_definir_padrao(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_lojas_definir_padrao(uuid, uuid) to service_role;

-- ─── 4 · a chave da empresa ────────────────────────────────────────────────
-- Escrita atômica de `settings.lojas.enabled`, sem sobrescrever o resto do
-- `settings` — o mesmo desenho de `fn_cadencias_configurar`.
create or replace function public.fn_lojas_configurar(p_organization_id uuid, p_enabled boolean)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  if p_enabled is null then raise exception 'lojas_configuracao_invalida'; end if;
  update public.organizations set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{lojas}',
    (case when jsonb_typeof(settings->'lojas') = 'object' then settings->'lojas' else '{}'::jsonb end)
      || jsonb_build_object('enabled', p_enabled), true)
   where id = p_organization_id;
  return found;
end $f$;
revoke execute on function public.fn_lojas_configurar(uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_lojas_configurar(uuid, boolean) to service_role;

-- ─── 5 · o relatório de atendimentos de UMA loja ───────────────────────────
-- A mesma conta de `fn_relatorio_atendimentos` (migration 9484), recortada às
-- conversas dos números da loja (`loja_do_numero`). SECURITY INVOKER, chamada
-- com o client da SESSÃO: a RLS de conversas, mensagens, demandas e do módulo
-- decide o escopo, como no relatório do núcleo, e `p_org` filtra junto.
--
-- Desfechos e motivos: `demandas` não aponta para a conversa, então a demanda
-- conta para a loja quando o CONTATO dela conversou num número da loja.
--
-- ⚠️ É cópia do corpo do núcleo com o recorte. Quando `fn_relatorio_atendimentos`
-- mudar a régua, esta muda junto (o teste `lib/lojas/relatorio.test.ts` confere
-- que as chaves da resposta são as mesmas).
create or replace function public.fn_lojas_relatorio_atendimentos(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_fuso text,
  p_loja uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $f$
declare
  v jsonb;
begin
  if to_regclass('public.loja_do_numero') is null then
    raise exception 'lojas_nao_instalado' using errcode = 'P0002';
  end if;
  with
  numeros as (
    select n.channel_session_id
      from public.loja_do_numero n
     where n.organization_id = p_org and n.loja_id = p_loja
  ),
  abertas as (
    select c.id, c.contact_id, c.sector_id, c.assigned_to_user_id,
           coalesce(c.service_started_at, c.created_at) as inicio
      from public.conversations c
     where c.organization_id = p_org
       and not c.is_group
       and c.channel_session_id in (select channel_session_id from numeros)
       and coalesce(c.service_started_at, c.created_at) >= p_de
       and coalesce(c.service_started_at, c.created_at) < p_ate
  ),
  encerradas as (
    select c.id, c.contact_id, c.sector_id, c.assigned_to_user_id,
           coalesce(c.service_started_at, c.created_at) as inicio,
           c.service_closed_at as fim
      from public.conversations c
     where c.organization_id = p_org
       and not c.is_group
       and c.channel_session_id in (select channel_session_id from numeros)
       and c.service_closed_at >= p_de
       and c.service_closed_at < p_ate
  ),
  primeira as (
    select a.id, a.sector_id, a.assigned_to_user_id,
           extract(epoch from (s.saida - e.entrada))::numeric as segundos
      from abertas a
      cross join lateral (
        select min(m.sent_at) as entrada
          from public.messages m
         where m.organization_id = p_org
           and m.conversation_id = a.id
           and m.direction = 'inbound'
           and m.sent_at >= a.inicio
      ) e
      cross join lateral (
        select min(m.sent_at) as saida
          from public.messages m
         where m.organization_id = p_org
           and m.conversation_id = a.id
           and m.direction = 'outbound'
           and m.sent_by_user_id is not null
           and e.entrada is not null
           and m.sent_at >= e.entrada
      ) s
     where e.entrada is not null and s.saida is not null
  ),
  resolucao as (
    select e.id, e.sector_id, e.assigned_to_user_id,
           extract(epoch from (e.fim - e.inicio))::numeric as segundos
      from encerradas e
     where e.fim >= e.inicio
  ),
  dias as (
    select d::date as dia
      from generate_series(
        (p_de at time zone p_fuso)::date::timestamp,
        ((p_ate - interval '1 microsecond') at time zone p_fuso)::date::timestamp,
        interval '1 day'
      ) as d
  ),
  serie as (
    select dias.dia,
           (select count(*) from abertas a where (a.inicio at time zone p_fuso)::date = dias.dia) as abertos,
           (select count(*) from encerradas e where (e.fim at time zone p_fuso)::date = dias.dia) as encerrados
      from dias
  ),
  setores as (
    select k.sector_id,
           (select s.name from public.attendant_sectors s
             where s.organization_id = p_org and s.id = k.sector_id) as nome,
           (select count(*) from abertas a where a.sector_id is not distinct from k.sector_id) as abertos,
           (select count(*) from encerradas e where e.sector_id is not distinct from k.sector_id) as encerrados,
           (select round(avg(p.segundos)) from primeira p where p.sector_id is not distinct from k.sector_id) as primeira_resposta_media,
           (select round(avg(r.segundos)) from resolucao r where r.sector_id is not distinct from k.sector_id) as resolucao_media
      from (select sector_id from abertas union select sector_id from encerradas) k
  ),
  atendentes as (
    select k.user_id,
           (select count(*) from abertas a where a.assigned_to_user_id is not distinct from k.user_id) as abertos,
           (select count(*) from encerradas e where e.assigned_to_user_id is not distinct from k.user_id) as encerrados,
           (select round(avg(p.segundos)) from primeira p where p.assigned_to_user_id is not distinct from k.user_id) as primeira_resposta_media,
           (select round(avg(r.segundos)) from resolucao r where r.assigned_to_user_id is not distinct from k.user_id) as resolucao_media
      from (select assigned_to_user_id as user_id from abertas
            union select assigned_to_user_id from encerradas) k
  ),
  demandas_da_loja as (
    select d.id, d.desfecho, d.motivo_de_encerramento_id
      from public.demandas d
     where d.organization_id = p_org
       and d.fechada_em >= p_de
       and d.fechada_em < p_ate
       and exists (
         select 1 from public.conversations c
          where c.organization_id = p_org
            and c.contact_id = d.contact_id
            and c.channel_session_id in (select channel_session_id from numeros)
       )
  ),
  desfechos as (
    select dl.desfecho, count(*) as quantidade
      from demandas_da_loja dl
     where dl.desfecho is not null
     group by dl.desfecho
  ),
  motivos as (
    select m.nome as motivo, count(*) as quantidade
      from demandas_da_loja dl
      join public.motivos_de_encerramento m
        on m.organization_id = p_org and m.id = dl.motivo_de_encerramento_id
     group by m.nome
  )
  select jsonb_build_object(
    'abertos', (select count(*) from abertas),
    'encerrados', (select count(*) from encerradas),
    'primeira_resposta', jsonb_build_object(
      'media', (select round(avg(segundos)) from primeira),
      'mediana', (select round(percentile_cont(0.5) within group (order by segundos)::numeric) from primeira),
      'amostra', (select count(*) from primeira)
    ),
    'resolucao', jsonb_build_object(
      'media', (select round(avg(segundos)) from resolucao),
      'mediana', (select round(percentile_cont(0.5) within group (order by segundos)::numeric) from resolucao),
      'amostra', (select count(*) from resolucao)
    ),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object(
        'dia', to_char(dia, 'YYYY-MM-DD'), 'abertos', abertos, 'encerrados', encerrados) order by dia)
      from serie), '[]'::jsonb),
    'por_setor', coalesce((select jsonb_agg(jsonb_build_object(
        'sector_id', sector_id, 'nome', nome, 'abertos', abertos, 'encerrados', encerrados,
        'primeira_resposta_media', primeira_resposta_media, 'resolucao_media', resolucao_media)
        order by abertos desc, encerrados desc)
      from setores), '[]'::jsonb),
    'por_atendente', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', user_id, 'abertos', abertos, 'encerrados', encerrados,
        'primeira_resposta_media', primeira_resposta_media, 'resolucao_media', resolucao_media)
        order by encerrados desc, abertos desc)
      from atendentes), '[]'::jsonb),
    'desfechos', coalesce((select jsonb_object_agg(desfecho, quantidade) from desfechos), '{}'::jsonb),
    'motivos', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'quantidade', quantidade)
        order by quantidade desc, motivo) from motivos), '[]'::jsonb)
  ) into v;
  return v;
end $f$;
revoke execute on function public.fn_lojas_relatorio_atendimentos(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.fn_lojas_relatorio_atendimentos(uuid, timestamptz, timestamptz, text, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
