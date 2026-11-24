-- manifest: **SLA do atendimento (item 3.3 da fase 3).** As metas moram em `organizations.settings.sla` (`primeira_resposta_min`, `resolucao_horas`, `por_setor`), lidas por `lib/schemas/settings.ts` (`metasDoSla`) — sem meta, sem selo, que é o estado de toda instalação que já existe. Esta migration traz só o que o banco precisa saber. (1) `conversations.sla_ignorado_em timestamptz` + `sla_ignorado_por uuid` (FK `auth.users`, `on delete set null`, a mesma referência de `snoozed_by_user_id`): um gestor tira UMA conversa da conta do SLA pela rota `POST /api/v1/conversations/[id]/sla` (manager+, auditada). CHECK: quem ignorou só existe com o instante. (2) A guarda `fn_conversa_sla_ignorado` (gatilho `trg_conversa_sla_ignorado`, BEFORE INSERT OR UPDATE): pela sessão (`authenticated`/`anon`) as duas colunas são do servidor — uma sessão de atendente não tira a própria conversa atrasada da conta pelo PostgREST —, e REABRIR (status encerrado → aberto) zera o ignorado: o atendimento novo volta a contar. (3) `fn_sla_primeiras_respostas(p_organization_id, p_de, p_ate)` — `stable security invoker`, sem EXECUTE para `public`/`anon`: um atendimento (conversa + `service_revision`) por linha, com o instante da primeira mensagem do cliente no período, a primeira resposta enviada depois dela e se o atendimento corrente está ignorado. A conta "dentro do prazo" (meta por setor, tempo fora do expediente não conta) é do TypeScript (`lib/inbox/sla-relatorio.ts`), a mesma régua do selo da lista.

-- ---- conversations: o SLA ignorado ----
alter table public.conversations add column if not exists sla_ignorado_em timestamptz;
alter table public.conversations add column if not exists sla_ignorado_por uuid;

-- Auto-curativo, ANTES das constraints: quem ignorou sem o instante perde o
-- autor; autor que não existe mais em auth.users vira nulo.
update public.conversations set sla_ignorado_por = null
 where sla_ignorado_por is not null and sla_ignorado_em is null;
update public.conversations c set sla_ignorado_por = null
 where c.sla_ignorado_por is not null
   and not exists (select 1 from auth.users u where u.id = c.sla_ignorado_por);

alter table public.conversations drop constraint if exists conversations_sla_ignorado_por_fkey;
alter table public.conversations add constraint conversations_sla_ignorado_por_fkey
  foreign key (sla_ignorado_por) references auth.users(id) on delete set null;

alter table public.conversations drop constraint if exists conversations_sla_ignorado_autor_com_instante;
alter table public.conversations add constraint conversations_sla_ignorado_autor_com_instante
  check (sla_ignorado_por is null or sla_ignorado_em is not null);

comment on column public.conversations.sla_ignorado_em is
  'Quando um gestor tirou esta conversa da conta do SLA (rota POST /api/v1/conversations/[id]/sla). Nulo = conta. Reabrir a conversa zera (gatilho trg_conversa_sla_ignorado). Só o servidor grava (migration 9483).';
comment on column public.conversations.sla_ignorado_por is
  'Quem tirou a conversa da conta do SLA. Some (set null) se o usuário for apagado; o instante fica (migration 9483).';

-- ---- a guarda: o ignorado é do servidor, e reabrir zera ----
create or replace function public.fn_conversa_sla_ignorado()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Conversa nasce contando. Pela sessão, qualquer valor enviado é descartado.
    if current_user in ('authenticated', 'anon') then
      new.sla_ignorado_em := null;
      new.sla_ignorado_por := null;
    end if;
    return new;
  end if;

  if current_user in ('authenticated', 'anon')
     and (new.sla_ignorado_em is distinct from old.sla_ignorado_em
          or new.sla_ignorado_por is distinct from old.sla_ignorado_por) then
    raise exception 'sla_ignorado_e_do_servidor' using errcode = '42501';
  end if;

  -- Reabrir é atendimento novo: o que foi ignorado no anterior não vale para ele.
  -- A lista de encerrados é a de STATUS_ENCERRADOS_LISTA (lib/inbox/comando-da-conversa.ts)
  -- e a de fn_service_stamp_status.
  if old.status in ('closed', 'archived', 'resolved')
     and new.status not in ('closed', 'archived', 'resolved') then
    new.sla_ignorado_em := null;
    new.sla_ignorado_por := null;
  end if;
  return new;
end $$;

revoke execute on function public.fn_conversa_sla_ignorado() from public, anon;

drop trigger if exists trg_conversa_sla_ignorado on public.conversations;
create trigger trg_conversa_sla_ignorado
  before insert or update on public.conversations
  for each row execute function public.fn_conversa_sla_ignorado();

-- ---- a leitura do relatório: primeira resposta por atendimento ----
--
-- Um atendimento = (conversa, service_revision). Entra o atendimento cuja
-- PRIMEIRA mensagem do cliente caiu em [p_de, p_ate): a mensagem do cliente
-- no período sem nenhuma anterior do mesmo atendimento antes de p_de.
-- `respondida_em` é a primeira resposta enviada (não falhada) depois dela —
-- a mesma pergunta que `awaiting_since` responde na fila. Grupo fica fora.
create or replace function public.fn_sla_primeiras_respostas(
  p_organization_id uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  conversation_id uuid,
  service_revision bigint,
  sector_id uuid,
  inicio timestamptz,
  respondida_em timestamptz,
  ignorado boolean
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  with entradas as (
    select m.conversation_id, m.service_revision, min(m.sent_at) as inicio
      from public.messages m
     where m.organization_id = p_organization_id
       and m.direction = 'inbound'
       and m.sent_at >= p_de
       and m.sent_at < p_ate
     group by m.conversation_id, m.service_revision
  )
  select e.conversation_id,
         e.service_revision,
         c.sector_id,
         e.inicio,
         (select min(o.sent_at)
            from public.messages o
           where o.conversation_id = e.conversation_id
             and o.organization_id = p_organization_id
             and o.direction = 'outbound'
             and o.service_revision is not distinct from e.service_revision
             and o.sent_at >= e.inicio
             and coalesce(o.status, '') <> 'failed') as respondida_em,
         (c.sla_ignorado_em is not null
           and c.service_revision is not distinct from e.service_revision) as ignorado
    from entradas e
    join public.conversations c
      on c.id = e.conversation_id
     and c.organization_id = p_organization_id
   where not c.is_group
     and not exists (
       select 1
         from public.messages a
        where a.conversation_id = e.conversation_id
          and a.organization_id = p_organization_id
          and a.direction = 'inbound'
          and a.service_revision is not distinct from e.service_revision
          and a.sent_at < p_de
     )
   order by e.inicio
   limit 20000;
$fn$;

comment on function public.fn_sla_primeiras_respostas(uuid, timestamptz, timestamptz) is
  'Atendimentos (conversa + service_revision) cuja primeira mensagem do cliente caiu no período, com a primeira resposta enviada depois dela e se o atendimento corrente está com o SLA ignorado. security invoker: pela sessão a RLS vale; pelo service role o corte é p_organization_id. A conta do prazo é de lib/inbox/sla-relatorio.ts (migration 9483). Teto de 20000 linhas.';

revoke execute on function public.fn_sla_primeiras_respostas(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_sla_primeiras_respostas(uuid, timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
