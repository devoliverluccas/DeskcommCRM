-- manifest: **Protocolo por atendimento e motivos de encerramento (itens 3.1 e 3.2 da fase 3).** `demandas.protocolo` (texto, NOT NULL depois do preenchimento, único por organização): o número que o cliente anota, no formato `AAAAMMDD-NNNNNN` — o dia em que a demanda abriu (UTC) e a sequência da organização NAQUELE ANO. Quem gera é o BANCO, no gatilho `trg_demanda_protocolo` (BEFORE INSERT OR UPDATE OF protocolo), sobre o contador `demanda_protocolo_contadores` (organização, ano), que só cresce — no molde de `crm_proposal_counters` (0466): apagar demanda ou dados operacionais nunca libera número. O `insert … on conflict do update … returning` segura a linha do contador, então duas demandas abertas ao mesmo tempo nunca recebem o mesmo número. Toda inserção ignora o protocolo que vier de fora (a sessão tem INSERT em `demandas`), e o protocolo é IMUTÁVEL depois de gravado. Preenchimento auto-curativo das demandas existentes, por ordem de abertura, com o contador travado durante a conta. Tabela nova `motivos_de_encerramento` (nome único por organização sem diferenciar maiúscula, `categoria` no MESMO vocabulário de `demandas.desfecho`, `ativo`, `ordem`): a sessão só LÊ; quem escreve é o servidor, com o papel conferido na rota. `demandas.motivo_de_encerramento_id` (FK, `on delete set null`), com gatilho que recusa motivo de outra organização. `fn_demanda_aplicar_motivo(p_org, p_demanda, p_motivo, p_actor)` (security definer, só `service_role`) grava o motivo e, se a demanda ainda não tem desfecho, encerra pela MESMA `fn_demanda_encerrar` com o desfecho da categoria.
--
-- ─── Por que o protocolo nasce no BANCO, e não na rota ──────────────────────
--
-- Demanda não nasce em rota nenhuma: nasce em gatilho (`fn_service_stamp_status`,
-- a entrada de mensagem da 0138, a reabertura da 9315, o grupo da 0764…). Um
-- protocolo gerado no TypeScript deixaria de fora toda demanda aberta por esses
-- caminhos — que são quase todas. O gatilho BEFORE INSERT pega todas, inclusive
-- as que vierem a existir.
--
-- ─── Por que contador e não `max()+1` ──────────────────────────────────────
--
-- `max(protocolo)+1` sobre as linhas que existem libera o número quando a linha
-- some (apagar dados operacionais, LGPD) — e o mesmo protocolo passaria a nomear
-- dois atendimentos diferentes, um deles já anotado pelo cliente. O contador
-- nunca deriva de linha: só cresce. Mesma lição da D9 das propostas (0466).
--
-- ─── Por que o dia é UTC ───────────────────────────────────────────────────
--
-- Mesma régua do protocolo da ouvidoria (`lib/ouvidoria/registro.ts`): é
-- identificador, não data de exibição. O ano do contador é o do mesmo instante
-- em UTC, então o prefixo e a sequência nunca discordam.

-- ═══ 3.1 — PROTOCOLO ════════════════════════════════════════════════════════

alter table public.demandas add column if not exists protocolo text;

comment on column public.demandas.protocolo is
  'Protocolo do atendimento (AAAAMMDD-NNNNNN): dia de abertura em UTC + sequência da organização no ano. Gerado pelo gatilho trg_demanda_protocolo; imutável (migration 9482).';

create table if not exists public.demanda_protocolo_contadores (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ano int not null,
  ultimo bigint not null default 0,
  primary key (organization_id, ano)
);
comment on table public.demanda_protocolo_contadores is
  'Sequência do protocolo de demanda por organização e ano. Só cresce; apagar demanda NUNCA mexe aqui (migration 9482).';
alter table public.demanda_protocolo_contadores enable row level security;
-- Só o servidor: nenhuma policy, e nenhum privilégio para a sessão. O contador
-- decide o número que o cliente anota; abri-lo pelo PostgREST deixaria qualquer
-- membro adiantar ou recuar a numeração da organização.
revoke all on public.demanda_protocolo_contadores from anon, authenticated;
grant all on public.demanda_protocolo_contadores to service_role;

create or replace function public.fn_demanda_protocolo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  quando timestamptz;
  v_ano int;
  n bigint;
begin
  -- Gravado, não muda: é o número que o cliente anotou.
  if tg_op = 'UPDATE' and old.protocolo is not null then
    new.protocolo := old.protocolo;
    return new;
  end if;
  -- UPDATE de linha ainda sem protocolo, com o valor JÁ calculado: é o
  -- preenchimento desta migration (que segura o contador). Mantém.
  if tg_op = 'UPDATE' and new.protocolo is not null then
    return new;
  end if;
  -- INSERT: o valor de fora é ignorado SEMPRE — a sessão tem INSERT em
  -- `demandas`, e protocolo escolhido pelo cliente não é protocolo.
  quando := coalesce(new.aberta_em, now());
  v_ano := extract(year from (quando at time zone 'UTC'))::int;
  insert into public.demanda_protocolo_contadores (organization_id, ano, ultimo)
    values (new.organization_id, v_ano, 1)
  on conflict (organization_id, ano) do update
    set ultimo = public.demanda_protocolo_contadores.ultimo + 1
  returning ultimo into n;
  new.protocolo := to_char(quando at time zone 'UTC', 'YYYYMMDD') || '-'
    || lpad(n::text, greatest(6, length(n::text)), '0');
  return new;
end;
$$;
revoke execute on function public.fn_demanda_protocolo() from public, anon, authenticated;

drop trigger if exists trg_demanda_protocolo on public.demandas;
create trigger trg_demanda_protocolo
  before insert or update of protocolo on public.demandas
  for each row execute function public.fn_demanda_protocolo();

-- Preenchimento das demandas existentes, por ordem de abertura, continuando o
-- contador de cada (organização, ano). Um único comando (DO) para o LOCK valer
-- a conta inteira: uma demanda aberta durante o preenchimento espera o contador
-- em vez de pegar um número que o preenchimento também daria. Sem linha nula,
-- não faz nada — reaplicar é inofensivo.
do $$
begin
  if exists (select 1 from public.demandas where protocolo is null) then
    lock table public.demanda_protocolo_contadores in share row exclusive mode;
    with pendentes as (
      select d.id, d.organization_id,
             extract(year from (d.aberta_em at time zone 'UTC'))::int as ano,
             to_char(d.aberta_em at time zone 'UTC', 'YYYYMMDD') as dia,
             row_number() over (
               partition by d.organization_id, extract(year from (d.aberta_em at time zone 'UTC'))
               order by d.aberta_em, d.id
             ) as posicao
        from public.demandas d
       where d.protocolo is null
    ),
    numerados as (
      select p.id, p.organization_id, p.ano, p.dia,
             coalesce(c.ultimo, 0) + p.posicao as numero
        from pendentes p
        left join public.demanda_protocolo_contadores c
          on c.organization_id = p.organization_id and c.ano = p.ano
    ),
    gravados as (
      update public.demandas d
         set protocolo = n.dia || '-' || lpad(n.numero::text, greatest(6, length(n.numero::text)), '0')
        from numerados n
       where d.id = n.id and d.protocolo is null
      returning n.organization_id, n.ano, n.numero
    )
    insert into public.demanda_protocolo_contadores (organization_id, ano, ultimo)
    select organization_id, ano, max(numero) from gravados group by organization_id, ano
    on conflict (organization_id, ano) do update
      set ultimo = greatest(public.demanda_protocolo_contadores.ultimo, excluded.ultimo);
  end if;
end;
$$;

alter table public.demandas alter column protocolo set not null;

create unique index if not exists demandas_org_protocolo_uniq
  on public.demandas (organization_id, protocolo);

-- ═══ 3.2 — MOTIVOS DE ENCERRAMENTO ═════════════════════════════════════════

create table if not exists public.motivos_de_encerramento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  -- O MESMO vocabulário de `demandas.desfecho` (0136): a categoria é o desfecho
  -- que o motivo dá à demanda que ainda não tinha um.
  categoria text not null,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.motivos_de_encerramento
  drop constraint if exists motivos_de_encerramento_nome_valido;
alter table public.motivos_de_encerramento
  add constraint motivos_de_encerramento_nome_valido
  check (char_length(btrim(nome)) between 1 and 80);
alter table public.motivos_de_encerramento
  drop constraint if exists motivos_de_encerramento_categoria_check;
alter table public.motivos_de_encerramento
  add constraint motivos_de_encerramento_categoria_check
  check (categoria in (
    'resolvida', 'convertida', 'nao_procede',
    'encerrada_pelo_cliente', 'perdida', 'expirada_sem_resposta'
  ));

comment on table public.motivos_de_encerramento is
  'Motivos que a equipe escolhe ao encerrar uma conversa. A categoria preenche demandas.desfecho quando a demanda ainda não tem um (migration 9482).';

create unique index if not exists motivos_de_encerramento_org_nome_uniq
  on public.motivos_de_encerramento (organization_id, lower(nome));
create index if not exists motivos_de_encerramento_org_ordem_idx
  on public.motivos_de_encerramento (organization_id, ordem);

alter table public.motivos_de_encerramento enable row level security;
drop policy if exists tenant_isolation_motivos_de_encerramento_all on public.motivos_de_encerramento;
create policy tenant_isolation_motivos_de_encerramento_all on public.motivos_de_encerramento
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- A sessão LÊ (o seletor do Inbox) e não escreve: criar, renomear e desativar é
-- de `manager`, e quem confere é a rota, com o service role. Sem o revoke, o
-- `ALTER DEFAULT PRIVILEGES` do baseline daria CRUD inteiro a qualquer agente.
revoke all on public.motivos_de_encerramento from anon;
revoke all on public.motivos_de_encerramento from authenticated;
grant select on public.motivos_de_encerramento to authenticated;
grant all on public.motivos_de_encerramento to service_role;

alter table public.demandas
  add column if not exists motivo_de_encerramento_id uuid
  references public.motivos_de_encerramento(id) on delete set null;

comment on column public.demandas.motivo_de_encerramento_id is
  'Motivo escolhido ao encerrar a conversa desta demanda (migration 9482). Nulo = encerrada sem motivo.';

create index if not exists idx_demandas_motivo
  on public.demandas (organization_id, motivo_de_encerramento_id)
  where motivo_de_encerramento_id is not null;

-- A FK simples não amarra a organização. Sem esta guarda, uma demanda da A
-- poderia apontar o motivo da B — e a contagem de motivos da B passaria a
-- incluir atendimento alheio.
create or replace function public.fn_demanda_motivo_da_mesma_org()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.motivo_de_encerramento_id is not null and not exists (
    select 1 from public.motivos_de_encerramento m
     where m.id = new.motivo_de_encerramento_id
       and m.organization_id = new.organization_id
  ) then
    raise exception 'motivo_de_outra_organizacao' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_demanda_motivo_da_mesma_org() from public, anon, authenticated;

drop trigger if exists trg_demanda_motivo_da_mesma_org on public.demandas;
create trigger trg_demanda_motivo_da_mesma_org
  before insert or update of motivo_de_encerramento_id, organization_id on public.demandas
  for each row execute function public.fn_demanda_motivo_da_mesma_org();

-- Grava o motivo e, se a demanda ainda está aberta, encerra pela MESMA porta do
-- botão "Encerrar demanda" (`fn_demanda_encerrar`): uma segunda regra de
-- encerramento seria o defeito. Motivo inativo ou de outra organização: 22023.
create or replace function public.fn_demanda_aplicar_motivo(
  p_org uuid, p_demanda uuid, p_motivo uuid, p_actor uuid
)
returns public.demandas language plpgsql security definer set search_path = public as $$
declare d public.demandas; m public.motivos_de_encerramento; pre_contact uuid;
begin
  select * into m from public.motivos_de_encerramento
   where id = p_motivo and organization_id = p_org;
  if not found or not m.ativo then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;
  select * into d from public.demandas where id = p_demanda and organization_id = p_org;
  if not found then raise exception 'demanda_not_found' using errcode = 'P0002'; end if;
  pre_contact := d.contact_id;
  perform public.fn_service_lock(p_org, d.contact_id);
  select * into d from public.demandas
   where id = p_demanda and organization_id = p_org for no key update;
  if d.contact_id is distinct from pre_contact then
    raise exception 'service_contact_changed' using errcode = '40001';
  end if;
  update public.demandas
     set motivo_de_encerramento_id = m.id, updated_at = clock_timestamp()
   where id = p_demanda and organization_id = p_org
  returning * into d;
  if d.fechada_em is null then
    d := public.fn_demanda_encerrar(p_org, p_demanda, d.revision, m.categoria, p_actor);
  end if;
  return d;
end;
$$;
revoke execute on function public.fn_demanda_aplicar_motivo(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_demanda_aplicar_motivo(uuid, uuid, uuid, uuid) to service_role;
