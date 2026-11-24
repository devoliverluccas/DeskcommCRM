-- manifest: **Orçamento pela conversa e link público para o cliente aceitar ou recusar (itens 2.1 e 2.2 da fase 2).** `crm_proposals` ganha `desconto_cents` e `frete_cents` (bigint, >= 0, padrão 0) — o desconto e o frete DA PROPOSTA, ao lado do desconto por item que já existia; o total passa a ser `max(0, soma dos itens - desconto) + frete` (`lib/propostas/total.ts`). Ganha também `decided_via` (`equipe` | `cliente`, padrão `equipe` para toda linha existente): quem decidiu pelo link público grava `cliente` com `decided_by_user_id` nulo, e um CHECK impede `cliente` com usuário. Tabela nova `crm_proposal_links`: o link que vai junto do PDF no WhatsApp. Guarda SÓ o SHA-256 do token (`token_hash`, único), nunca o token; `expira_em` acompanha a validade da proposta; `revogado_em` é a saída. Leitura pela sessão da organização, escrita só pelo servidor. A guarda de sessão `fn_crm_proposals_transicao_da_sessao` passa a reservar `decided_via` ao servidor (uma sessão não forja "o cliente aceitou" pelo PostgREST). Anonimizar o contato revoga os links das propostas dele (gatilho `trg_crm_proposal_links_revoga_ao_anonimizar`, no mesmo molde de `trg_reply_redact`): um link vivo mostraria nome, itens e valores de quem pediu para sumir.
--
-- O CHECK de status NÃO muda: aceitar e recusar pelo link levam aos mesmos
-- `aceita` / `recusada` da decisão da equipe. O que muda é QUEM decidiu, e isso
-- é coluna própria (`decided_via`), não status novo.
--
-- Por que `expira_em` não é só `valid_until`: `valid_until` é DATA no fuso da
-- organização, e o link precisa de um instante. A rota grava um teto folgado
-- (o dia seguinte à validade, 14h UTC — depois do fim do dia em qualquer fuso),
-- e a página pública confere de novo a validade da proposta no fuso dela.

-- ---- crm_proposals: desconto e frete da proposta ----
alter table public.crm_proposals add column if not exists desconto_cents bigint not null default 0;
alter table public.crm_proposals add column if not exists frete_cents bigint not null default 0;

-- Auto-curativo: um valor negativo gravado antes da constraint (não deveria
-- existir — a coluna nasce aqui) vira zero em vez de derrubar o `update.sh`.
update public.crm_proposals set desconto_cents = 0 where desconto_cents < 0;
update public.crm_proposals set frete_cents = 0 where frete_cents < 0;

alter table public.crm_proposals drop constraint if exists crm_proposals_desconto_nao_negativo;
alter table public.crm_proposals add constraint crm_proposals_desconto_nao_negativo check (desconto_cents >= 0);
alter table public.crm_proposals drop constraint if exists crm_proposals_frete_nao_negativo;
alter table public.crm_proposals add constraint crm_proposals_frete_nao_negativo check (frete_cents >= 0);

comment on column public.crm_proposals.desconto_cents is
  'Desconto da PROPOSTA inteira (além do desconto por item). Total = max(0, soma dos itens - desconto) + frete — lib/propostas/total.ts (migration 9480).';
comment on column public.crm_proposals.frete_cents is
  'Frete da proposta, somado depois do desconto (migration 9480).';

-- ---- crm_proposals: quem decidiu ----
alter table public.crm_proposals add column if not exists decided_via text not null default 'equipe';
update public.crm_proposals set decided_via = 'equipe'
 where decided_via is null or decided_via not in ('equipe', 'cliente');
-- Decisão do cliente nunca tem usuário: corrige antes de a constraint entrar.
update public.crm_proposals set decided_via = 'equipe'
 where decided_via = 'cliente' and decided_by_user_id is not null;

alter table public.crm_proposals drop constraint if exists crm_proposals_decided_via_check;
alter table public.crm_proposals add constraint crm_proposals_decided_via_check
  check (decided_via in ('equipe', 'cliente'));
alter table public.crm_proposals drop constraint if exists crm_proposals_decided_via_cliente_sem_usuario;
alter table public.crm_proposals add constraint crm_proposals_decided_via_cliente_sem_usuario
  check (decided_via <> 'cliente' or decided_by_user_id is null);

comment on column public.crm_proposals.decided_via is
  'Quem decidiu: equipe (rota /decide, com decided_by_user_id) ou cliente (link público /o/<token>, sem usuário). Só o servidor grava cliente (migration 9480).';

-- ---- a guarda de sessão reserva decided_via ao servidor ----
-- Redefinição da função da 0464 com UMA mudança: `decided_via`. No INSERT ela
-- tem de nascer `equipe`; editando o rascunho ela não muda; decidindo, também
-- não (ela fica fora de `v_decisao`, então `v_new - v_decisao` a compara).
create or replace function public.fn_crm_proposals_transicao_da_sessao()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  -- o que só o ENVIO escreve (numeração, arquivo, mensagem, retorno)
  v_envio constant text[] := array['numero', 'ano', 'versao', 'substitui_id', 'sent_at',
    'sent_by_user_id', 'pdf_path', 'message_id', 'retorno_id', 'template_snapshot', 'rendered_snapshot'];
  -- o que decidir e descartar mudam
  v_decisao constant text[] := array['status', 'decided_at', 'decided_by_user_id',
    'decision_reason', 'updated_at'];
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from unnest(v_envio) k where k <> 'versao' and v_new -> k <> 'null'::jsonb)
       or coalesce(v_new ->> 'versao', '1') <> '1'
       or coalesce(v_new ->> 'decided_via', 'equipe') <> 'equipe' then
      raise exception 'proposta_envio_e_do_servidor' using errcode = '42501';
    end if;
    return new;
  end if;
  v_old := to_jsonb(old);
  if old.status = 'rascunho' and new.status = 'rascunho' then
    -- editar o rascunho: o conteúdo muda, o que é do envio não
    if exists (select 1 from unnest(v_envio || array['decided_via']) k where v_new -> k is distinct from v_old -> k) then
      raise exception 'proposta_envio_e_do_servidor' using errcode = '42501';
    end if;
  elsif (old.status = 'enviada' and new.status in ('aceita', 'recusada'))
     or (old.status = 'rascunho' and new.status = 'cancelada'
         and public.fn_role_at_least(new.organization_id, 'manager')) then
    -- decidir (agent) ou descartar (manager): só a decisão muda
    if (v_new - v_decisao) is distinct from (v_old - v_decisao) then
      raise exception 'proposta_transicao_negada' using errcode = '42501';
    end if;
  else
    raise exception 'proposta_transicao_negada' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_crm_proposals_transicao_da_sessao() from public, anon;

-- ---- crm_proposal_links: o link público ----
create table if not exists public.crm_proposal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null references public.crm_proposals(id) on delete cascade,
  -- SHA-256 (hex) do token. O token em si existe só na mensagem enviada.
  token_hash text not null,
  expira_em timestamptz not null,
  revogado_em timestamptz,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  ultimo_acesso_em timestamptz,
  constraint crm_proposal_links_token_hash_formato check (token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists crm_proposal_links_token_hash_uidx
  on public.crm_proposal_links (token_hash);
create index if not exists crm_proposal_links_org_proposta_idx
  on public.crm_proposal_links (organization_id, proposal_id);

-- O link é da organização da proposta, nunca de outra (mesma régua do
-- `trg_crm_proposal_items_org_consistente`).
create or replace function public.fn_crm_proposal_links_org_consistente()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.crm_proposals where id = new.proposal_id;
  if v_org is distinct from new.organization_id then
    raise exception 'crm_proposal_link_org_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_crm_proposal_links_org_consistente() from public, anon;

drop trigger if exists trg_crm_proposal_links_org_consistente on public.crm_proposal_links;
create trigger trg_crm_proposal_links_org_consistente
  before insert or update of organization_id, proposal_id on public.crm_proposal_links
  for each row execute function public.fn_crm_proposal_links_org_consistente();

alter table public.crm_proposal_links enable row level security;

-- Leitura pela organização (a tela mostra se há link e até quando vale);
-- escrita só pelo servidor — a sessão não tem GRANT de escrita.
drop policy if exists tenant_isolation_crm_proposal_links_all on public.crm_proposal_links;
create policy tenant_isolation_crm_proposal_links_all on public.crm_proposal_links
  for all
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

revoke all on public.crm_proposal_links from anon;
revoke all on public.crm_proposal_links from authenticated;
grant select on public.crm_proposal_links to authenticated;
grant all on public.crm_proposal_links to service_role;

comment on table public.crm_proposal_links is
  'Link público da proposta (/o/<token>): o cliente vê, aceita ou recusa. Só o hash do token é guardado. Revogado ao anonimizar o contato (migration 9480).';

-- ---- anonimizar o contato revoga os links ----
create or replace function public.fn_crm_proposal_links_revoga_ao_anonimizar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.crm_proposal_links l
     set revogado_em = now()
    from public.crm_proposals p
   where p.id = l.proposal_id
     and p.organization_id = new.organization_id
     and p.contact_id = new.id
     and l.organization_id = new.organization_id
     and l.revogado_em is null;
  return new;
end;
$$;
revoke all on function public.fn_crm_proposal_links_revoga_ao_anonimizar() from public, anon, authenticated;

drop trigger if exists trg_crm_proposal_links_revoga_ao_anonimizar on public.contacts;
create trigger trg_crm_proposal_links_revoga_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row when (new.is_anonymized and not old.is_anonymized)
  execute function public.fn_crm_proposal_links_revoga_ao_anonimizar();

notify pgrst, 'reload schema';
