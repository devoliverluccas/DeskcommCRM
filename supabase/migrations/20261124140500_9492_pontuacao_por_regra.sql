-- manifest: **Pontuação do lead por regra (item 4.5 da fase 4).** Duas tabelas novas, tenant-aware, com RLS `tenant_isolation_<tabela>_all` por `fn_user_org_ids()`: `regras_de_pontuacao` (nome de 1 a 80, `evento` num vocabulário FECHADO de fatos que o sistema já emite — `mensagem_recebida`, `respondeu_followup`, `agendamento_marcado`, `orcamento_enviado`, `orcamento_aceito`, `etapa_alcancada`, `tag_aplicada` —, `condicao jsonb` objeto com schema central em `lib/leads/pontuacao-por-regra.ts`, `pontos` inteiro de -1000 a 1000 e nunca zero, `ativo`, `teto_por_contato` opcional) e `pontuacao_extrato` (uma linha por regra e fato: contato, negócio opcional, regra, evento, pontos, `motivo` = nome da regra no instante, `ocorrido_em`, `chave` de idempotência única por organização + regra). A sessão só LÊ as duas; as regras são escritas pelo servidor com `manager` conferido na rota (`/api/v1/pontuacao/regras`) e o extrato só pela `fn_pontuacao_registrar` (security definer, só `service_role`), que confere regra ativa, contato e negócio da organização e aplica o teto sob trava por (regra, contato). `fn_pontuacao_do_contato` (security invoker, RLS vale) soma o extrato: o total é CALCULADO, nunca coluna. Gatilho `trg_crm_lead_activities_fato_de_proposta` (AFTER INSERT em `crm_lead_activities`) transforma as atividades `proposal_sent`/`proposal_accepted` em fatos `proposal.sent`/`proposal.accepted` no `event_log` — só INSERT, nenhuma rede. O score de probabilidade (`crm_lead_scores`) NÃO muda: pontos são outro número.
--
-- ─── Por que os pontos não entram no score ──────────────────────────────────
--
-- O score é a fórmula de probabilidade, com a frase derivada do cálculo
-- (`lib/leads/score-formula.ts`). A regra da organização é uma decisão de
-- negócio ("respondeu o follow-up vale 10"); somá-la ao score faria a
-- probabilidade mudar por um critério que ela não calcula e apagaria o porquê.
--
-- ─── Por que o total não é coluna (DIRC: Calcular) ──────────────────────────
--
-- O total de um contato é a soma do extrato. Uma coluna sincronizada teria de
-- ser mantida em dois lugares e poderia divergir da lista que a explica.
--
-- ─── Por que o gatilho emite fato e não pontua ──────────────────────────────
--
-- Trigger nunca faz HTTP nem regra pesada. Este só grava UMA linha em
-- `event_log`, e o consumidor (`lib/leads/pontuacao-por-regra.handler.ts`) faz
-- o resto fora da transação de quem enviou ou decidiu o orçamento. A atividade é
-- gravada por três caminhos (a rota de enviar, a decisão da equipe e o link
-- público do cliente), e o gatilho alcança os três.
--
-- Idempotente: `if not exists`, constraints e policies recriadas por nome,
-- função e gatilho com `create or replace`. Sem dado a corrigir: tabelas novas.

-- ---- regras_de_pontuacao ----
create table if not exists public.regras_de_pontuacao (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  evento text not null,
  condicao jsonb not null default '{}'::jsonb,
  pontos integer not null,
  ativo boolean not null default true,
  teto_por_contato integer,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.regras_de_pontuacao drop constraint if exists regras_de_pontuacao_nome_valido;
alter table public.regras_de_pontuacao add constraint regras_de_pontuacao_nome_valido
  check (char_length(btrim(nome)) between 1 and 80);
alter table public.regras_de_pontuacao drop constraint if exists regras_de_pontuacao_evento_check;
alter table public.regras_de_pontuacao add constraint regras_de_pontuacao_evento_check
  check (evento in (
    'mensagem_recebida', 'respondeu_followup', 'agendamento_marcado',
    'orcamento_enviado', 'orcamento_aceito', 'etapa_alcancada', 'tag_aplicada'
  ));
alter table public.regras_de_pontuacao drop constraint if exists regras_de_pontuacao_condicao_objeto;
alter table public.regras_de_pontuacao add constraint regras_de_pontuacao_condicao_objeto
  check (jsonb_typeof(condicao) = 'object');
alter table public.regras_de_pontuacao drop constraint if exists regras_de_pontuacao_pontos_validos;
alter table public.regras_de_pontuacao add constraint regras_de_pontuacao_pontos_validos
  check (pontos <> 0 and pontos between -1000 and 1000);
alter table public.regras_de_pontuacao drop constraint if exists regras_de_pontuacao_teto_valido;
alter table public.regras_de_pontuacao add constraint regras_de_pontuacao_teto_valido
  check (teto_por_contato is null or teto_por_contato between 1 and 100000);

comment on table public.regras_de_pontuacao is
  'Regras de pontos do lead: um fato que o sistema já emite (evento) + condição + pontos. O extrato fica em pontuacao_extrato; o score de probabilidade não muda (migration 9492).';

create index if not exists regras_de_pontuacao_org_evento_ativas_idx
  on public.regras_de_pontuacao (organization_id, evento) where ativo;

alter table public.regras_de_pontuacao enable row level security;
drop policy if exists tenant_isolation_regras_de_pontuacao_all on public.regras_de_pontuacao;
create policy tenant_isolation_regras_de_pontuacao_all on public.regras_de_pontuacao
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- A sessão LÊ (a tela e o extrato) e não escreve: criar, editar e desativar é de
-- `manager`, conferido na rota, pelo service role. Sem o revoke, o
-- `ALTER DEFAULT PRIVILEGES` do baseline daria CRUD inteiro a qualquer agente.
revoke all on public.regras_de_pontuacao from anon;
revoke all on public.regras_de_pontuacao from authenticated;
grant select on public.regras_de_pontuacao to authenticated;
grant all on public.regras_de_pontuacao to service_role;

-- ---- pontuacao_extrato ----
create table if not exists public.pontuacao_extrato (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  -- Não há rota de excluir regra (desativar preserva o extrato). Quem apagar
  -- uma regra no SQL apaga junto os pontos que ela deu, e o total continua
  -- explicado pela lista.
  regra_id uuid not null references public.regras_de_pontuacao(id) on delete cascade,
  evento text not null,
  pontos integer not null,
  -- O NOME da regra no instante em que pontuou. Nunca texto do cliente.
  motivo text not null,
  chave text not null,
  ocorrido_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.pontuacao_extrato drop constraint if exists pontuacao_extrato_pontos_validos;
alter table public.pontuacao_extrato add constraint pontuacao_extrato_pontos_validos
  check (pontos <> 0);
alter table public.pontuacao_extrato drop constraint if exists pontuacao_extrato_chave_valida;
alter table public.pontuacao_extrato add constraint pontuacao_extrato_chave_valida
  check (char_length(chave) between 1 and 300);

comment on table public.pontuacao_extrato is
  'Extrato dos pontos por regra: uma linha por (regra, fato), única pela chave. O total do contato é a soma (fn_pontuacao_do_contato), nunca coluna (migration 9492).';

create unique index if not exists pontuacao_extrato_org_regra_chave_uniq
  on public.pontuacao_extrato (organization_id, regra_id, chave);
create index if not exists pontuacao_extrato_org_contato_idx
  on public.pontuacao_extrato (organization_id, contact_id, ocorrido_em desc);
create index if not exists pontuacao_extrato_regra_contato_idx
  on public.pontuacao_extrato (regra_id, contact_id);

alter table public.pontuacao_extrato enable row level security;
drop policy if exists tenant_isolation_pontuacao_extrato_all on public.pontuacao_extrato;
create policy tenant_isolation_pontuacao_extrato_all on public.pontuacao_extrato
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- Só o servidor escreve no extrato, e só pela função abaixo.
revoke all on public.pontuacao_extrato from anon;
revoke all on public.pontuacao_extrato from authenticated;
grant select on public.pontuacao_extrato to authenticated;
grant all on public.pontuacao_extrato to service_role;

-- ---- fn_pontuacao_registrar: a única porta de escrita do extrato ----
create or replace function public.fn_pontuacao_registrar(
  p_org uuid,
  p_regra uuid,
  p_contato uuid,
  p_lead uuid,
  p_chave text,
  p_ocorrido_em timestamptz default now()
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_regra public.regras_de_pontuacao%rowtype;
  v_lead uuid := p_lead;
  v_acumulado bigint;
  v_aplicado integer;
  v_id uuid;
begin
  select * into v_regra
    from public.regras_de_pontuacao
   where id = p_regra and organization_id = p_org;
  -- Regra de outra organização ou desativada: nada a gravar (não é erro — a
  -- regra pode ter sido desligada entre o fato e o dreno).
  if not found or not v_regra.ativo then return 0; end if;
  if not exists (select 1 from public.contacts where id = p_contato and organization_id = p_org) then
    return 0;
  end if;
  if v_lead is not null
     and not exists (select 1 from public.crm_leads where id = v_lead and organization_id = p_org) then
    v_lead := null;
  end if;

  v_aplicado := v_regra.pontos;
  if v_regra.teto_por_contato is not null then
    -- A trava serializa dois fatos do MESMO contato na MESMA regra: sem ela, os
    -- dois liam o acumulado antes de qualquer um gravar e passavam do teto.
    perform pg_advisory_xact_lock(hashtextextended(p_regra::text || ':' || p_contato::text, 9492));
    select coalesce(sum(abs(pontos)), 0) into v_acumulado
      from public.pontuacao_extrato
     where organization_id = p_org and regra_id = p_regra and contact_id = p_contato;
    v_aplicado := sign(v_regra.pontos)::integer
      * least(abs(v_regra.pontos), greatest(0, v_regra.teto_por_contato - v_acumulado))::integer;
    if v_aplicado = 0 then return 0; end if;
  end if;

  insert into public.pontuacao_extrato
    (organization_id, contact_id, lead_id, regra_id, evento, pontos, motivo, chave, ocorrido_em)
  values
    (p_org, p_contato, v_lead, p_regra, v_regra.evento, v_aplicado, v_regra.nome, p_chave,
     coalesce(p_ocorrido_em, now()))
  on conflict (organization_id, regra_id, chave) do nothing
  returning id into v_id;

  if v_id is null then return 0; end if;
  return v_aplicado;
end $$;

revoke all on function public.fn_pontuacao_registrar(uuid, uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_pontuacao_registrar(uuid, uuid, uuid, uuid, text, timestamptz) to service_role;

-- ---- fn_pontuacao_do_contato: o total, calculado ----
-- `security invoker`: pela sessão a RLS de `pontuacao_extrato` decide o que entra
-- na soma — contato de outra organização soma zero.
create or replace function public.fn_pontuacao_do_contato(p_org uuid, p_contato uuid)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(pontos), 0)::integer
    from public.pontuacao_extrato
   where organization_id = p_org and contact_id = p_contato;
$$;

revoke all on function public.fn_pontuacao_do_contato(uuid, uuid) from public, anon;
grant execute on function public.fn_pontuacao_do_contato(uuid, uuid) to authenticated, service_role;

-- ---- o orçamento vira fato no event_log ----
create or replace function public.fn_crm_lead_activities_fato_de_proposta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_id is null then return new; end if;
  if new.type = 'proposal_sent' then
    insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload, metadata)
    values (new.organization_id, 'proposal.sent', 'crm_proposal', new.source_id,
            jsonb_build_object('proposal_id', new.source_id, 'lead_id', new.lead_id,
                               'contact_id', new.contact_id, 'activity_id', new.id),
            jsonb_build_object('emitted_at', extract(epoch from now())));
  elsif new.type = 'proposal_accepted' then
    insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload, metadata)
    values (new.organization_id, 'proposal.accepted', 'crm_proposal', new.source_id,
            jsonb_build_object('proposal_id', new.source_id, 'lead_id', new.lead_id,
                               'contact_id', new.contact_id, 'activity_id', new.id),
            jsonb_build_object('emitted_at', extract(epoch from now())));
  end if;
  return new;
end $$;

revoke all on function public.fn_crm_lead_activities_fato_de_proposta() from public, anon, authenticated;

drop trigger if exists trg_crm_lead_activities_fato_de_proposta on public.crm_lead_activities;
create trigger trg_crm_lead_activities_fato_de_proposta
  after insert on public.crm_lead_activities
  for each row
  when (new.type in ('proposal_sent', 'proposal_accepted'))
  execute function public.fn_crm_lead_activities_fato_de_proposta();
