-- manifest: **Feriados da organização e encerramento automático por inatividade (item 3.8 da fase 3).** Tabela nova `feriados` (organização, `data date`, `nome` de 1 a 80 caracteres, `recorrente_anual boolean` — repete no mesmo dia e mês todo ano —, quem criou), única por organização + data. RLS `tenant_isolation_feriados_all` por `fn_user_org_ids()`; a sessão só LÊ (a tela e o roteamento), quem escreve é o servidor com o papel `manager` conferido na rota (`/api/v1/feriados`) — o mesmo molde de `motivos_de_encerramento` (9482). Quem usa: `ehFeriado()` (`lib/feriados/regra.ts`) compõe estes com os nacionais de `lib/lgpd/holidays-br.ts`, e `isWithinSchedule` (`lib/routing/eligibility.ts`) passa a tratar feriado CADASTRADO pela organização como fora do expediente das jornadas e filas com horário. O encerramento por inatividade é a chave `settings.atendimento.encerrar_inativas_apos_horas` (jsonb, sem coluna; nulo = desligado) lida pelo cron horário `encerrar-inativas`; esta migration só lhe dá o índice parcial `idx_conversations_inativas` — conversa viva sem cliente esperando, por última saída — para a varredura não ler a tabela inteira. Idempotente e sem dado a corrigir: tabela nova, `if not exists`, policy recriada por nome.
--
-- ─── Por que a data e não dia/mês soltos ────────────────────────────────────
--
-- O feriado avulso é uma data (a ponte de 2026, o aniversário da cidade
-- naquele ano). O recorrente é o mesmo dia e mês todo ano: guardar a data em
-- que foi cadastrado e casar por mês-dia evita uma segunda coluna e mantém o
-- `unique (organization_id, data)` como a única regra de duplicidade.
--
-- ─── Por que feriado nacional NÃO fecha o expediente sozinho ────────────────
--
-- Toda instalação brasileira passaria, no primeiro feriado depois do deploy, a
-- não distribuir conversa nenhuma — uma mudança de comportamento que ninguém
-- pediu (há quem atenda no feriado: delivery, plantão, loja de shopping). O
-- nacional entra no expediente quando a organização o IMPORTA para esta tabela
-- (botão "Importar feriados nacionais do ano"), e aí é dela.

create table if not exists public.feriados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data date not null,
  nome text not null,
  recorrente_anual boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.feriados drop constraint if exists feriados_nome_valido;
alter table public.feriados
  add constraint feriados_nome_valido check (char_length(btrim(nome)) between 1 and 80);

create unique index if not exists feriados_org_data_uniq
  on public.feriados (organization_id, data);

comment on table public.feriados is
  'Feriados da organização (migration 9486). recorrente_anual = repete no mesmo dia e mês todo ano. Lidos por lib/feriados (ehFeriado) e pelo horário das jornadas/filas (isWithinSchedule). Escrita só pelo servidor (/api/v1/feriados, manager+).';

alter table public.feriados enable row level security;
drop policy if exists tenant_isolation_feriados_all on public.feriados;
create policy tenant_isolation_feriados_all on public.feriados
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- A sessão LÊ e não escreve: cadastrar e remover é de `manager`, conferido na
-- rota, com o service role. Sem o revoke, o `ALTER DEFAULT PRIVILEGES` do
-- baseline daria CRUD inteiro a qualquer agente.
revoke all on public.feriados from anon;
revoke all on public.feriados from authenticated;
grant select on public.feriados to authenticated;
grant all on public.feriados to service_role;

-- A varredura do cron `encerrar-inativas`: conversa viva, sem mensagem do
-- cliente esperando resposta, pela última saída da equipe/IA.
create index if not exists idx_conversations_inativas
  on public.conversations (organization_id, last_outbound_at)
  where status in ('open','pending','claimed','ai_handling')
    and awaiting_since is null
    and last_outbound_at is not null;

notify pgrst, 'reload schema';
