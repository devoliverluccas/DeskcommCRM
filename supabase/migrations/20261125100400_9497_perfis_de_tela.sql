-- manifest: **Perfis de tela (fase 5, item 5.6) — o primeiro passo de "perfis de permissão", SEM mexer em RLS de negócio nem nos 4 papéis.** Tabela `perfis_de_tela` (organização, `nome` de 1 a 60 caracteres único por organização sem caixa, `destinos text[]` de 1 a 200 hrefs do catálogo de navegação) e a coluna `user_organizations.perfil_de_tela_id`, com FK COMPOSTA `(organization_id, perfil_de_tela_id) → perfis_de_tela(organization_id, id)` (o perfil só pode ser da MESMA organização do vínculo — o banco garante, não só a rota) e `on delete set null (perfil_de_tela_id)`: apagar o perfil devolve os membros ao "tudo que o papel permite". O perfil é APRESENTAÇÃO: estreita o que a pessoa VÊ no menu, no hub e na busca (`lib/navigation/perfis-de-tela.ts`, interseção com a interface da empresa e do vínculo); nunca concede e nunca nega rota — a rota segue protegida pelo papel. A sessão só LÊ (RLS `tenant_isolation_perfis_de_tela_all`); criar, editar, apagar e atribuir é de `admin`, pela rota.
--
-- ─── Por que coluna em `user_organizations` e não tabela de vínculo (DIRC) ──
--
-- R (referenciar): cada membro tem NO MÁXIMO um perfil, e o perfil é lido junto
-- com o vínculo (o snapshot de permissões já lê `user_organizations`). Uma
-- tabela N:N pediria um segundo SELECT por navegação e uma regra para "dois
-- perfis no mesmo membro" que ninguém pediu. A coluna é um ponteiro com FK — não
-- duplica o perfil nem o papel.
--
-- ─── Por que `destinos text[]` e não tabela de itens ───────────────────────
--
-- A lista é sempre lida e escrita JUNTO com o perfil, nunca consultada por
-- item, e o vocabulário (hrefs do catálogo) vive no TypeScript: é a rota que
-- recusa href fora do catálogo (422), e a leitura descarta o que o catálogo não
-- conhece mais (porta removida não quebra o menu). Não é FK para lugar nenhum:
-- o catálogo não é tabela.

create table if not exists public.perfis_de_tela (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  destinos text[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.perfis_de_tela drop constraint if exists perfis_de_tela_nome_tamanho;
alter table public.perfis_de_tela add constraint perfis_de_tela_nome_tamanho
  check (char_length(btrim(nome)) between 1 and 60);
alter table public.perfis_de_tela drop constraint if exists perfis_de_tela_destinos_tamanho;
alter table public.perfis_de_tela add constraint perfis_de_tela_destinos_tamanho
  check (cardinality(destinos) between 1 and 200);

-- O alvo da FK composta: (organização, id) é único porque `id` já é.
create unique index if not exists perfis_de_tela_org_id_uniq
  on public.perfis_de_tela (organization_id, id);
create unique index if not exists perfis_de_tela_org_nome_uniq
  on public.perfis_de_tela (organization_id, lower(btrim(nome)));

comment on table public.perfis_de_tela is
  'Perfis de tela: quais destinos de navegação um membro VÊ, sobre o que o papel já permite. Apresentação, nunca autorização. Escrita só pelo servidor, com papel admin (migration 9497).';

drop trigger if exists trg_perfis_de_tela_updated_at on public.perfis_de_tela;
create trigger trg_perfis_de_tela_updated_at
  before update on public.perfis_de_tela
  for each row execute function public.fn_set_updated_at();

alter table public.perfis_de_tela enable row level security;
drop policy if exists tenant_isolation_perfis_de_tela_all on public.perfis_de_tela;
create policy tenant_isolation_perfis_de_tela_all on public.perfis_de_tela
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- A sessão LÊ (o snapshot de permissões monta o menu com ela); escrever é
-- `admin`, conferido na rota com o service role. Sem o revoke, o ALTER DEFAULT
-- PRIVILEGES do baseline daria CRUD a qualquer agente.
revoke all on public.perfis_de_tela from anon;
revoke all on public.perfis_de_tela from authenticated;
grant select on public.perfis_de_tela to authenticated;
grant all on public.perfis_de_tela to service_role;

-- ─── O vínculo ──────────────────────────────────────────────────────────────

alter table public.user_organizations add column if not exists perfil_de_tela_id uuid;

-- Auto-curativo antes da FK: ponteiro para perfil inexistente ou de OUTRA
-- organização vira null (o mesmo que "sem perfil"), e o ADD não falha.
update public.user_organizations u
   set perfil_de_tela_id = null
 where u.perfil_de_tela_id is not null
   and not exists (
     select 1 from public.perfis_de_tela p
      where p.id = u.perfil_de_tela_id and p.organization_id = u.organization_id
   );

alter table public.user_organizations drop constraint if exists user_organizations_perfil_de_tela_fk;
alter table public.user_organizations add constraint user_organizations_perfil_de_tela_fk
  foreign key (organization_id, perfil_de_tela_id)
  references public.perfis_de_tela (organization_id, id)
  on delete set null (perfil_de_tela_id);

create index if not exists idx_user_orgs_perfil_de_tela
  on public.user_organizations (organization_id, perfil_de_tela_id)
  where perfil_de_tela_id is not null;

comment on column public.user_organizations.perfil_de_tela_id is
  'Perfil de tela do membro (perfis_de_tela). Null = vê tudo que o papel permite. Apresentação, nunca autorização. Migration 9497.';

notify pgrst, 'reload schema';
