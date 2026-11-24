-- manifest: **Valores personalizados da empresa (fase 4, item 4.6).** Tabela `valores_personalizados` (organização, `chave` em `^[a-z][a-z0-9_]{1,39}$` única por organização, `valor` texto de 1 a 2000 caracteres, `descricao` opcional até 200): o PIX, o endereço, o horário — o texto que a empresa repete em toda mensagem e quer trocar num lugar só. Vira `{{empresa.<chave>}}` em todas as fontes de variável (`lib/variaveis/catalogo.ts`), e o envio (`sendMessageHandler`) resolve o que a tela não resolveu. A sessão só LÊ (RLS `tenant_isolation_valores_personalizados_all`); criar, editar e apagar é de `manager`, pela rota, com o service role e a organização da sessão.
--
-- ─── Por que tabela e não `organizations.settings` (DIRC) ──────────────────
--
-- A unicidade da chave por organização é regra do banco (índice único), não da
-- tela; cada valor tem dono, descrição e data próprios e é editado sozinho —
-- num jsonb, duas pessoas editando chaves diferentes ao mesmo tempo sobrescrevem
-- uma à outra (o read-modify-write de `settings`). E o papel que escreve
-- (`manager`) é diferente do que escreve a maior parte de `settings` (`admin`).

create table if not exists public.valores_personalizados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chave text not null,
  valor text not null,
  descricao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.valores_personalizados drop constraint if exists valores_personalizados_chave_formato;
alter table public.valores_personalizados add constraint valores_personalizados_chave_formato
  check (chave ~ '^[a-z][a-z0-9_]{1,39}$');
alter table public.valores_personalizados drop constraint if exists valores_personalizados_valor_tamanho;
alter table public.valores_personalizados add constraint valores_personalizados_valor_tamanho
  check (char_length(valor) between 1 and 2000);
alter table public.valores_personalizados drop constraint if exists valores_personalizados_descricao_tamanho;
alter table public.valores_personalizados add constraint valores_personalizados_descricao_tamanho
  check (descricao is null or char_length(descricao) <= 200);

create unique index if not exists valores_personalizados_org_chave_uniq
  on public.valores_personalizados (organization_id, chave);

comment on table public.valores_personalizados is
  'Valores da empresa usados como {{empresa.<chave>}} nas mensagens. Escrita só pelo servidor, com papel manager (migration 9491).';

drop trigger if exists trg_valores_personalizados_updated_at on public.valores_personalizados;
create trigger trg_valores_personalizados_updated_at
  before update on public.valores_personalizados
  for each row execute function public.fn_set_updated_at();

alter table public.valores_personalizados enable row level security;
drop policy if exists tenant_isolation_valores_personalizados_all on public.valores_personalizados;
create policy tenant_isolation_valores_personalizados_all on public.valores_personalizados
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- A sessão LÊ (o compositor e a prévia); escrever é `manager`, conferido na
-- rota. Sem o revoke, o ALTER DEFAULT PRIVILEGES do baseline daria CRUD a
-- qualquer agente — e quem troca a chave PIX troca para onde vai o dinheiro.
revoke all on public.valores_personalizados from anon;
revoke all on public.valores_personalizados from authenticated;
grant select on public.valores_personalizados to authenticated;
grant all on public.valores_personalizados to service_role;

notify pgrst, 'reload schema';
