-- manifest: **A pesquisa do encerramento ganha o modo NPS (0 a 10) e os relatórios ganham as suas contas.** `satisfacao_do_atendimento.escala` (`csat_1_5` padrão | `nps_0_10`) grava em que régua o pedido foi feito, e o CHECK da nota passa a depender dela (1–5 no CSAT, 0–10 no NPS) — as linhas que já existem nasceram `csat_1_5` e continuam válidas, sem migrar nota nenhuma. `fn_satisfacao_resumo` mantém a assinatura e ganha `por_escala` (contagem por nota de cada régua; a média de cima passa a ser só do CSAT, porque média de 1–5 com 0–10 não mede nada). Duas leituras novas para a tela `/app/relatorios`: `fn_relatorio_atendimentos` (SECURITY INVOKER, a RLS de quem lê decide o escopo) e `fn_relatorio_atribuicao` (cliques dos links rastreáveis, só `service_role`). Nenhuma coluna removida. Idempotente.

-- ═══ 3.4 — A RÉGUA DO PEDIDO ═══
--
-- A escala é do PEDIDO, não da organização: a organização troca de CSAT para
-- NPS numa terça, e o "4" que chega na quarta para uma pergunta de segunda
-- ainda é nota de 1 a 5. Ler a régua da configuração na hora da resposta
-- daria a mesma nota em duas réguas conforme o dia em que se olha.
alter table public.satisfacao_do_atendimento
  add column if not exists escala text not null default 'csat_1_5';

-- Auto-curativo ANTES das constraints: escala fora do vocabulário volta ao
-- padrão (é o que toda linha anterior a esta migration é).
update public.satisfacao_do_atendimento
   set escala = 'csat_1_5'
 where escala is null or escala not in ('csat_1_5', 'nps_0_10');

alter table public.satisfacao_do_atendimento drop constraint if exists satisfacao_escala_check;
alter table public.satisfacao_do_atendimento
  add constraint satisfacao_escala_check check (escala in ('csat_1_5', 'nps_0_10'));

-- Nota que não cabe na régua do próprio pedido não é nota: vira `sem_nota`
-- (silêncio, nunca nota inventada). Com a constraint antiga de pé, nenhuma
-- linha cai aqui — o update existe para o clone em que ela não existiu.
update public.satisfacao_do_atendimento
   set status = 'sem_nota', nota = null, respondido_em = null
 where nota is not null
   and not (
     (escala = 'csat_1_5' and nota between 1 and 5)
     or (escala = 'nps_0_10' and nota between 0 and 10)
   );

alter table public.satisfacao_do_atendimento drop constraint if exists satisfacao_nota_check;
alter table public.satisfacao_do_atendimento
  add constraint satisfacao_nota_check check (
    nota is null
    or (escala = 'csat_1_5' and nota between 1 and 5)
    or (escala = 'nps_0_10' and nota between 0 and 10)
  );

comment on column public.satisfacao_do_atendimento.escala is
  'A régua em que a pergunta foi feita: csat_1_5 (padrão, nota 1-5) ou nps_0_10 (nota 0-10). É do pedido, não da organização: trocar a opção não reinterpreta resposta de pergunta antiga.';

-- ═══ O resumo, por régua ═══
--
-- Mesma assinatura (a rota e a tela de Configurações já chamam com estes três
-- argumentos), saída maior. `media` e `notas` de cima continuam sendo o que a
-- tela de 1 a 5 lê, agora só com pedidos CSAT; `por_escala` traz as duas
-- réguas separadas. O NPS (promotores − detratores) é calculado no TypeScript,
-- a partir das contagens por nota (`calcularNps`, função pura testada).
create or replace function public.fn_satisfacao_resumo(
  p_org uuid,
  p_de timestamptz default null,
  p_ate timestamptz default null
) returns jsonb language sql security definer
set search_path = public, pg_temp as $$
  with base as (
    select s.status, s.nota, s.escala
      from public.satisfacao_do_atendimento s
     where s.organization_id = p_org
       and (p_de is null or s.perguntado_em >= p_de)
       and (p_ate is null or s.perguntado_em < p_ate)
  ),
  contagem as (
    select escala, nota, count(*) as quantidade
      from base
     where status = 'respondida' and nota is not null
     group by escala, nota
  ),
  por_escala as (
    select e.escala,
           jsonb_build_object(
             'respostas', coalesce((select sum(c.quantidade) from contagem c where c.escala = e.escala), 0),
             'media', (select round(avg(b.nota), 2) from base b
                        where b.escala = e.escala and b.status = 'respondida'),
             'notas', coalesce((select jsonb_object_agg(c.nota::text, c.quantidade)
                                  from contagem c where c.escala = e.escala), '{}'::jsonb)
           ) as resumo
      from (values ('csat_1_5'), ('nps_0_10')) as e(escala)
  )
  select jsonb_build_object(
    'respostas', (select count(*) from base where status = 'respondida'),
    'pedidos', (select count(*) from base),
    'sem_nota', (select count(*) from base where status = 'sem_nota'),
    'aguardando', (select count(*) from base where status = 'aguardando'),
    'media', (select round(avg(nota), 2) from base where status = 'respondida' and escala = 'csat_1_5'),
    'notas', coalesce((select jsonb_object_agg(nota::text, quantidade) from contagem where escala = 'csat_1_5'), '{}'::jsonb),
    'por_escala', (select jsonb_object_agg(escala, resumo) from por_escala)
  );
$$;

revoke execute on function public.fn_satisfacao_resumo(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.fn_satisfacao_resumo(uuid, timestamptz, timestamptz) to service_role;

-- ═══ 3.6 — RELATÓRIO DE ATENDIMENTOS ═══
--
-- SECURITY INVOKER de propósito: quem chama é a rota com o client da SESSÃO, e
-- a RLS de `conversations` (fn_can_view_conversation), `messages` e `demandas`
-- decide o escopo — o agent vê o que já vê no Inbox, o manager a organização.
-- O `p_org` filtra junto (a RLS sozinha deixaria um usuário de duas empresas
-- somar as duas).
--
-- O ciclo é o do ATENDIMENTO, não o da conversa: `service_started_at` é o
-- começo do atendimento corrente (a conversa reaberta recomeça a contar), e
-- `service_closed_at` o fim. Conversa de grupo fica de fora: a 1ª resposta
-- num grupo não mede atendimento a um cliente.
--
-- 1ª resposta = 1ª mensagem HUMANA (`sent_by_user_id`) depois da 1ª entrada do
-- ciclo — a mesma régua da "1ª resposta" de Desempenho (`fn_attendant_metrics`).
-- Resolução = `service_closed_at − início do ciclo`, das encerradas na janela.
-- Média E mediana: a média sozinha é refém de uma conversa esquecida por dias.
create or replace function public.fn_relatorio_atendimentos(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz,
  p_fuso text default 'UTC'
) returns jsonb language sql stable security invoker
set search_path = public, pg_temp as $$
  with
  abertas as (
    select c.id, c.sector_id, c.assigned_to_user_id,
           coalesce(c.service_started_at, c.created_at) as inicio
      from public.conversations c
     where c.organization_id = p_org
       and not c.is_group
       and coalesce(c.service_started_at, c.created_at) >= p_de
       and coalesce(c.service_started_at, c.created_at) < p_ate
  ),
  encerradas as (
    select c.id, c.sector_id, c.assigned_to_user_id,
           coalesce(c.service_started_at, c.created_at) as inicio,
           c.service_closed_at as fim
      from public.conversations c
     where c.organization_id = p_org
       and not c.is_group
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
  desfechos as (
    select d.desfecho, count(*) as quantidade
      from public.demandas d
     where d.organization_id = p_org
       and d.fechada_em >= p_de
       and d.fechada_em < p_ate
       and d.desfecho is not null
     group by d.desfecho
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
    'desfechos', coalesce((select jsonb_object_agg(desfecho, quantidade) from desfechos), '{}'::jsonb)
  );
$$;

revoke execute on function public.fn_relatorio_atendimentos(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.fn_relatorio_atendimentos(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

-- ═══ 3.6 — RELATÓRIO DE ATRIBUIÇÃO ═══
--
-- Os cliques dos links rastreáveis (google + meta) NA JANELA, por link: quantos
-- cliques, quantos viraram contato (o ref casou com a mensagem), quantos
-- negócios esses contatos têm, quantos ganhos, e quantas conversões a
-- plataforma de anúncio recebeu (`ad_conversion_dispatches.status = 'sent'`).
-- Clique sem link (`tracking_link_id` nulo) é a página de captura direta e sai
-- numa linha própria com `link_id` nulo.
--
-- SECURITY DEFINER e só `service_role`, como `fn_metricas_links_rastreaveis`:
-- as tabelas de clique não têm GRANT para `authenticated`. O `p_org` vem da
-- sessão, resolvido na rota (piso `manager`).
create or replace function public.fn_relatorio_atribuicao(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
) returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  with cliques as (
    select g.tracking_link_id, g.contact_id
      from public.google_ads_click_refs g
     where g.organization_id = p_org and g.created_at >= p_de and g.created_at < p_ate
    union all
    select m.tracking_link_id, m.contact_id
      from public.meta_ads_click_refs m
     where m.organization_id = p_org and m.created_at >= p_de and m.created_at < p_ate
  ),
  por_link as (
    select tracking_link_id, count(*) as cliques, count(distinct contact_id) as contatos
      from cliques
     group by tracking_link_id
  ),
  negocios as (
    select distinct c.tracking_link_id, l.id, l.status
      from cliques c
      join public.crm_leads l on l.organization_id = p_org and l.contact_id = c.contact_id
     where c.contact_id is not null
  ),
  conversoes as (
    select n.tracking_link_id, count(distinct d.lead_id) as enviadas
      from negocios n
      join public.ad_conversion_dispatches d
        on d.organization_id = p_org and d.lead_id = n.id and d.status = 'sent'
     group by n.tracking_link_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'link_id', p.tracking_link_id,
      'nome', l.name,
      'uso', l.use_case,
      'cliques', p.cliques,
      'contatos', p.contatos,
      'negocios', (select count(*) from negocios n where n.tracking_link_id is not distinct from p.tracking_link_id),
      'ganhos', (select count(*) from negocios n
                  where n.tracking_link_id is not distinct from p.tracking_link_id and n.status = 'won'),
      'conversoes', coalesce((select c.enviadas from conversoes c
                               where c.tracking_link_id is not distinct from p.tracking_link_id), 0)
    ) order by p.cliques desc), '[]'::jsonb)
    from por_link p
    left join public.ad_tracking_links l
      on l.organization_id = p_org and l.id = p.tracking_link_id;
$$;

revoke execute on function public.fn_relatorio_atribuicao(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.fn_relatorio_atribuicao(uuid, timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
