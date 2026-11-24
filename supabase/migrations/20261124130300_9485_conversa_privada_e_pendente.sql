-- manifest: **Conversa privada e conversa pendente (item 3.7 da fase 3).** `conversations.privada boolean not null default false` + `privada_por uuid` (FK `auth.users`, `on delete set null`): conversa privada só é LIDA por quem é responsável por ela (`assigned_to_user_id = auth.uid()`), por gestor/administrador da organização e pela plataforma. A regra entra como policy RESTRITIVA de SELECT `conversations_privada_select` — ela se SOMA (AND) à `conversations_select` permissiva, sem reescrevê-la — e mede a linha contra `fn_conversation_private_scope()`, o conjunto de organizações em que quem consulta é manager+, avaliado UMA vez por consulta (a mesma forma da 0726, #3090: nenhuma função por linha). `messages`, notas, rascunhos e tudo que lê `conversations` pela sessão herdam a regra. `fn_can_view_conversation(org, responsável, privada)` (sobrecarga de 3 argumentos) é a escada por linha com a regra nova, e a de 2 argumentos segue idêntica (privada = falso). Gatilho `trg_conversa_privada_e_pendente` (BEFORE UPDATE, sem HTTP): recusa (42501) quem marca/desmarca privada pela sessão sem ser responsável nem manager+; e zera `pendente_em` quando a conversa ENCERRA (closed/resolved/archived). `conversations.pendente_em timestamptz` (nulo = não pendente) com índice parcial `(organization_id, pendente_em) where pendente_em is not null` para o filtro "Pendentes" do Inbox. Idempotente: `add column if not exists`, `create or replace`, policy e gatilho recriados por nome.
--
-- ─── Por que uma policy RESTRITIVA, e não reescrever `conversations_select` ──
--
-- A `conversations_select` vigente é a do fim do baseline (9214): seis
-- disjunções (plataforma, leitura da organização, responsável, fila sem dono,
-- participante, setor). "Privada" não é mais uma porta de entrada: é um corte
-- que vale por cima de TODAS elas — o participante convidado, o membro do setor
-- e o atendente em `visibility_mode = 'all'` deixam de ver. Uma restritiva diz
-- exatamente isso (`permissivas AND restritivas`), e não obriga a repetir as
-- seis disjunções aqui, que divergiriam da próxima vez que alguém mexer numa.
--
-- ─── Por que um conjunto por consulta, e não `fn_can_view_conversation` por linha ─
--
-- `tests/invariants/escopo-da-conversa-avaliado-uma-vez.test.ts` reprova o plano
-- que chama `fn_can_view_conversation` por linha (era 214 ms em 142 conversas).
-- `fn_conversation_private_scope()` não depende da linha: vira um `hashed
-- SubPlan` calculado uma vez. A conversa pública (`not privada`) passa na
-- primeira disjunção e não paga nada.
--
-- ─── O que a sobrecarga de 3 argumentos é ───────────────────────────────────
--
-- A fonte por LINHA da regra, para quem compara (o invariante novo) e para quem
-- vier a precisar perguntar sobre uma conversa só. A de 2 argumentos NÃO muda:
-- ela é chamada com os campos da linha por notas, rascunhos, casos e comandos de
-- atribuição — e todos eles também leem `conversations` pela sessão, então já
-- herdam o corte da restritiva.

-- ═══ colunas ════════════════════════════════════════════════════════════════

alter table public.conversations
  add column if not exists privada boolean not null default false;
alter table public.conversations
  add column if not exists privada_por uuid references auth.users(id) on delete set null;
alter table public.conversations
  add column if not exists pendente_em timestamptz;

comment on column public.conversations.privada is
  'Conversa privada (migration 9485): só o responsável (assigned_to_user_id), gestor/administrador da organização e a plataforma leem. Policy restritiva conversations_privada_select. Quem marca: POST /api/v1/conversations/[id]/privada.';
comment on column public.conversations.privada_por is
  'Quem marcou a conversa como privada por último (migration 9485). Nulo quando pública ou quando a pessoa saiu da instalação.';
comment on column public.conversations.pendente_em is
  'Marcada como pendente pela equipe neste instante (migration 9485); nulo = não pendente. Zerada pelo gatilho trg_conversa_privada_e_pendente quando a conversa encerra. Filtro "Pendentes" do Inbox.';

create index if not exists idx_conversations_pendentes
  on public.conversations (organization_id, pendente_em)
  where pendente_em is not null;

-- ═══ o conjunto por consulta ════════════════════════════════════════════════

-- Organizações em que quem consulta é gestor ou administrador. Mesma fonte de
-- "quem é membro" e de "qual papel" que `fn_conversation_scope()` usa
-- (`fn_user_org_ids()` + `fn_user_role_in_org()`), inclusive a sessão de
-- suporte (que resolve para admin/viewer conforme o modo).
create or replace function public.fn_conversation_private_scope()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select o.organization_id
    from public.fn_user_org_ids() as o(organization_id)
   where public.fn_user_role_in_org(o.organization_id) in ('manager','admin');
$$;

revoke all on function public.fn_conversation_private_scope() from public, anon;
grant execute on function public.fn_conversation_private_scope() to authenticated, service_role;

-- ═══ a escada por linha, com a regra nova ═══════════════════════════════════

create or replace function public.fn_can_view_conversation(
  p_org uuid,
  p_assigned_to_user_id uuid,
  p_privada boolean
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.fn_can_view_conversation(p_org, p_assigned_to_user_id)
     and (
       not coalesce(p_privada, false)
       or public.fn_is_platform_admin()
       or p_assigned_to_user_id = auth.uid()
       or public.fn_user_role_in_org(p_org) in ('manager','admin')
     );
$$;

revoke all on function public.fn_can_view_conversation(uuid, uuid, boolean) from public, anon;
grant execute on function public.fn_can_view_conversation(uuid, uuid, boolean) to authenticated, service_role;

-- ═══ a policy restritiva ════════════════════════════════════════════════════

drop policy if exists conversations_privada_select on public.conversations;
create policy conversations_privada_select
  on public.conversations as restrictive for select to authenticated
  using (
    not privada
    or assigned_to_user_id = auth.uid()
    or (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_conversation_private_scope())
  );

-- ═══ o gatilho: quem pode mudar `privada`, e o pendente que some ao encerrar ═

create or replace function public.fn_conversa_privada_e_pendente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Pela SESSÃO (auth.uid() presente), marcar/desmarcar privada é do
  -- responsável ou de manager+. O servidor (service_role, sem auth.uid()) já
  -- conferiu o papel na rota.
  if new.privada is distinct from old.privada and auth.uid() is not null then
    if not (
      old.assigned_to_user_id = auth.uid()
      or public.fn_role_at_least(new.organization_id, 'manager')
      or public.fn_is_platform_admin()
    ) then
      raise exception 'privada_sem_permissao' using errcode = '42501';
    end if;
  end if;
  if not new.privada then
    new.privada_por := null;
  end if;
  -- Encerrou: o "pendente" era do atendimento que acabou.
  if new.status in ('closed','resolved','archived')
     and old.status is distinct from new.status then
    new.pendente_em := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_conversa_privada_e_pendente() from public, anon;
grant execute on function public.fn_conversa_privada_e_pendente() to authenticated, service_role;

drop trigger if exists trg_conversa_privada_e_pendente on public.conversations;
create trigger trg_conversa_privada_e_pendente
  before update of privada, privada_por, status, pendente_em on public.conversations
  for each row execute function public.fn_conversa_privada_e_pendente();

-- Auto-curativo: conversa encerrada com pendente que sobrou (não deveria haver,
-- a coluna é nova; a segunda passada não acha linha).
update public.conversations
   set pendente_em = null
 where pendente_em is not null
   and status in ('closed','resolved','archived');

notify pgrst, 'reload schema';
