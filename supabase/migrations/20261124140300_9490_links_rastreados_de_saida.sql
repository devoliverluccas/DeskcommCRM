-- manifest: **Links rastreados de SAÍDA (fase 4, item 4.4).** `{{link:https://…}}` (e `{{link:https://…|rótulo}}`) numa mensagem para um contato conhecido sai trocado por uma URL curta do próprio domínio (`/l/<codigo>`), e cada clique fica registrado. Tabela `links_de_saida` (organização, `codigo` de 10 caracteres alfanuméricos único na instalação, `destino_url` http/https até 2048, `rotulo` opcional, `contact_id` opcional com FK composta e `on delete set null (contact_id)`, `anonimizado`); idempotente por organização + contato + destino + rótulo (índice único parcial, só com contato). Tabela `cliques_de_links_de_saida` (organização, link com FK composta `on delete cascade`, `clicado_em`, `dispositivo` em vocabulário fechado, `navegador` curto, `ip_hash` de 16 hex — nunca o IP cru). A sessão só LÊ as duas (RLS `tenant_isolation_*`); quem grava é o servidor (envio e rota pública), com o service role e a organização da linha. Gatilho `trg_links_de_saida_lgpd` na virada de `contacts.is_anonymized`: o link perde o contato, o destino perde caminho e consulta (fica só a origem) e é marcado `anonimizado` (a rota pública deixa de redirecionar), e os cliques perdem `ip_hash` e `navegador`. `fn_registrar_clique_de_saida(p_org, p_link, …)` (security definer, só `service_role`): grava o clique e, se foi gente, o fato `link.clicked` no `event_log` já `done` (registro, sem consumidor). `fn_links_de_saida_resumo(p_org)` (idem): os links com cliques de gente (robô de prévia fora) para a tela.
--
-- ─── Por que tabela nova e não `ad_tracking_links` (DIRC) ─────────────────
--
-- `ad_tracking_links` (0437) é o link de ENTRADA: leva ao WhatsApp da empresa,
-- com `whatsapp_e164`, `message_template`, `use_case` e `utm` NOT NULL, e o
-- clique dele vira `[ref:]` em `google_ads_click_refs`/`meta_ads_click_refs`.
-- Nenhuma dessas seis colunas de negócio vale para o link de SAÍDA (destino é
-- uma URL qualquer, o público é um contato que JÁ conhecemos, e o clique não
-- tem ref). Estender a tabela exigiria afrouxar os NOT NULL que a tela de
-- Conversões e `fn_relatorio_atribuicao` (9484) leem como garantidos, e um
-- discriminador em toda leitura existente — a forma do anti-pattern 8. Duas
-- tabelas com contrato próprio, nenhuma coluna duplicada.
--
-- ─── Por que o clique não guarda `contact_id` (DIRC: Calcular) ────────────
--
-- O link já é POR contato: quem clica é o contato do link. Guardar de novo no
-- clique seria a mesma informação em dois lugares, e a anonimização teria de
-- desfazer as duas. A conta "cliques por contato" é um join.
--
-- ─── Por que o IP é hash truncado com sal da organização ───────────────────
--
-- LGPD: o IP cru é dado pessoal e não serve a nada aqui. O hash (SHA-256 do
-- IP com o id da organização, 16 hex) só distingue "o mesmo aparelho clicou
-- duas vezes" dentro da organização; não cruza organizações e não volta ao IP.

-- ═══ links_de_saida ═════════════════════════════════════════════════════════

create table if not exists public.links_de_saida (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  codigo text not null,
  destino_url text not null,
  rotulo text,
  contact_id uuid,
  anonimizado boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.links_de_saida drop constraint if exists links_de_saida_codigo_formato;
alter table public.links_de_saida add constraint links_de_saida_codigo_formato
  check (codigo ~ '^[A-Za-z0-9]{10}$');
alter table public.links_de_saida drop constraint if exists links_de_saida_destino_http;
alter table public.links_de_saida add constraint links_de_saida_destino_http
  check (char_length(destino_url) between 10 and 2048 and destino_url ~* '^https?://[^/?#\s]+');
alter table public.links_de_saida drop constraint if exists links_de_saida_rotulo_valido;
alter table public.links_de_saida add constraint links_de_saida_rotulo_valido
  check (rotulo is null or char_length(btrim(rotulo)) between 1 and 60);

create unique index if not exists links_de_saida_org_id_uniq
  on public.links_de_saida (organization_id, id);
-- A rota pública resolve SÓ pelo código, sem organização: único na instalação.
create unique index if not exists links_de_saida_codigo_uniq
  on public.links_de_saida (codigo);
-- A idempotência do envio: o mesmo destino para o mesmo contato com o mesmo
-- rótulo é o MESMO link. Só com contato — sem contato não há o que repetir.
create unique index if not exists links_de_saida_idempotencia_uniq
  on public.links_de_saida (organization_id, contact_id, destino_url, coalesce(rotulo, ''))
  where contact_id is not null;
create index if not exists links_de_saida_org_criado_idx
  on public.links_de_saida (organization_id, created_at desc);

-- FK composta: o contato tem de ser DESTA organização. `set null (contact_id)`
-- (Postgres 15) apaga só o contato, nunca a organização da linha.
alter table public.links_de_saida drop constraint if exists links_de_saida_contato_org_fk;
alter table public.links_de_saida add constraint links_de_saida_contato_org_fk
  foreign key (organization_id, contact_id) references public.contacts(organization_id, id)
  on delete set null (contact_id);

comment on table public.links_de_saida is
  'URL curta (/l/<codigo>) que substitui {{link:...}} numa mensagem enviada a um contato. Escrita só pelo servidor (migration 9490).';

alter table public.links_de_saida enable row level security;
drop policy if exists tenant_isolation_links_de_saida_all on public.links_de_saida;
create policy tenant_isolation_links_de_saida_all on public.links_de_saida
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

-- A sessão LÊ; quem cria é o envio (service role, organização do contexto). Sem
-- o revoke, o ALTER DEFAULT PRIVILEGES do baseline daria CRUD a qualquer membro.
revoke all on public.links_de_saida from anon;
revoke all on public.links_de_saida from authenticated;
grant select on public.links_de_saida to authenticated;
grant all on public.links_de_saida to service_role;

-- ═══ cliques_de_links_de_saida ══════════════════════════════════════════════

create table if not exists public.cliques_de_links_de_saida (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  link_id uuid not null,
  clicado_em timestamptz not null default now(),
  dispositivo text not null default 'desconhecido',
  navegador text,
  ip_hash text
);

alter table public.cliques_de_links_de_saida drop constraint if exists cliques_de_links_de_saida_dispositivo_check;
alter table public.cliques_de_links_de_saida add constraint cliques_de_links_de_saida_dispositivo_check
  check (dispositivo in ('celular', 'computador', 'robo', 'desconhecido'));
alter table public.cliques_de_links_de_saida drop constraint if exists cliques_de_links_de_saida_navegador_curto;
alter table public.cliques_de_links_de_saida add constraint cliques_de_links_de_saida_navegador_curto
  check (navegador is null or char_length(navegador) between 1 and 40);
alter table public.cliques_de_links_de_saida drop constraint if exists cliques_de_links_de_saida_ip_hash_formato;
alter table public.cliques_de_links_de_saida add constraint cliques_de_links_de_saida_ip_hash_formato
  check (ip_hash is null or ip_hash ~ '^[0-9a-f]{16}$');

alter table public.cliques_de_links_de_saida drop constraint if exists cliques_de_links_de_saida_link_org_fk;
alter table public.cliques_de_links_de_saida add constraint cliques_de_links_de_saida_link_org_fk
  foreign key (organization_id, link_id) references public.links_de_saida(organization_id, id)
  on delete cascade;

create index if not exists cliques_de_links_de_saida_link_idx
  on public.cliques_de_links_de_saida (organization_id, link_id, clicado_em desc);

comment on table public.cliques_de_links_de_saida is
  'Um clique num link de saída. Sem IP cru: ip_hash = 16 hex do SHA-256 (organização + IP). O contato é o do link (migration 9490).';

alter table public.cliques_de_links_de_saida enable row level security;
drop policy if exists tenant_isolation_cliques_de_links_de_saida_all on public.cliques_de_links_de_saida;
create policy tenant_isolation_cliques_de_links_de_saida_all on public.cliques_de_links_de_saida
  for all
  using (organization_id in (select * from public.fn_user_org_ids()))
  with check (organization_id in (select * from public.fn_user_org_ids()));

revoke all on public.cliques_de_links_de_saida from anon;
revoke all on public.cliques_de_links_de_saida from authenticated;
grant select on public.cliques_de_links_de_saida to authenticated;
grant all on public.cliques_de_links_de_saida to service_role;

-- ═══ LGPD — anonimizar o contato desvincula os links e os cliques dele ═══════
--
-- Mesmo desenho de `fn_reply_redact` / `fn_google_redact_contact`: gatilho na
-- virada de `contacts.is_anonymized`, que os DOIS caminhos de anonimização
-- (rota e cascata do banco) atravessam. Sem HTTP, só escrita local.
--   - link: perde o contato; o destino perde caminho e consulta (a URL
--     personalizada — `https://loja/previa/ana` — pode carregar o nome), fica
--     só a origem; `anonimizado` faz a rota pública parar de redirecionar.
--   - clique: perde `ip_hash` e `navegador`. A LINHA fica: a contagem por
--     rótulo da organização não é dado da pessoa.
create or replace function public.fn_links_de_saida_lgpd()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.cliques_de_links_de_saida k
     set ip_hash = null, navegador = null
   where k.organization_id = new.organization_id
     and k.link_id in (
       select l.id from public.links_de_saida l
        where l.organization_id = new.organization_id and l.contact_id = new.id
     );
  update public.links_de_saida l
     set contact_id = null,
         anonimizado = true,
         destino_url = coalesce(substring(l.destino_url from '^(https?://[^/?#\s]+)'), 'https://anonimizado.invalid') || '/'
   where l.organization_id = new.organization_id and l.contact_id = new.id;
  return new;
end;
$$;
revoke execute on function public.fn_links_de_saida_lgpd() from public, anon, authenticated;

drop trigger if exists trg_links_de_saida_lgpd on public.contacts;
create trigger trg_links_de_saida_lgpd
  after update of is_anonymized on public.contacts
  for each row when (new.is_anonymized and not coalesce(old.is_anonymized, false))
  execute function public.fn_links_de_saida_lgpd();

-- ═══ O clique — uma escrita, com o registro no event_log ════════════════════
--
-- Chamada pela rota pública `/l/<codigo>` (service role), DEPOIS de ela ter
-- resolvido o link pelo código: `p_org` é a organização DA LINHA, nunca da
-- requisição — e a FK composta recusa link de outra organização. O fato
-- `link.clicked` (só clique de gente; robô de prévia não) nasce `done`: é
-- REGISTRO, sem consumidor hoje (ver `NASCE_DONE_NA_ORIGEM` em
-- tests/unit/evento-de-fato-nao-fica-pendente.test.ts). Quem quiser um gatilho
-- de automação "clicou no link" escreve o handler e troca o status para
-- `pending` no mesmo PR. Sem HTTP: só duas linhas locais.
create or replace function public.fn_registrar_clique_de_saida(
  p_org uuid, p_link uuid, p_dispositivo text, p_navegador text, p_ip_hash text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clique uuid;
  v_contato uuid;
  v_rotulo text;
begin
  select l.contact_id, l.rotulo into v_contato, v_rotulo
    from public.links_de_saida l
   where l.organization_id = p_org and l.id = p_link and not l.anonimizado;
  if not found then
    return null;
  end if;
  insert into public.cliques_de_links_de_saida (organization_id, link_id, dispositivo, navegador, ip_hash)
    values (p_org, p_link, coalesce(p_dispositivo, 'desconhecido'), p_navegador, p_ip_hash)
  returning id into v_clique;
  if coalesce(p_dispositivo, 'desconhecido') <> 'robo' then
    insert into event_log (organization_id, event_type, entity_kind, entity_id, status, payload)
      values (p_org, 'link.clicked', 'link_de_saida', p_link, 'done',
              jsonb_build_object('link_id', p_link, 'clique_id', v_clique,
                                 'contact_id', v_contato, 'rotulo', v_rotulo));
  end if;
  return v_clique;
end;
$$;
revoke execute on function public.fn_registrar_clique_de_saida(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_registrar_clique_de_saida(uuid, uuid, text, text, text) to service_role;

-- ═══ O resumo da tela ═══════════════════════════════════════════════════════
--
-- Só service_role: o `p_org` vem da sessão no servidor, nunca do navegador
-- (mesmo contrato de `fn_metricas_links_rastreaveis`, 0437). Robô de prévia
-- (o WhatsApp abre o link para montar a miniatura) não conta como clique.
create or replace function public.fn_links_de_saida_resumo(p_org uuid, p_limite int default 500)
returns table(
  id uuid, codigo text, destino_url text, rotulo text, contact_id uuid, contato_nome text,
  anonimizado boolean, created_at timestamptz, cliques bigint, ultimo_clique timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.codigo, l.destino_url, l.rotulo, l.contact_id,
         nullif(btrim(coalesce(nullif(btrim(c.name), ''), c.display_name)), '') as contato_nome,
         l.anonimizado, l.created_at,
         count(k.id) filter (where k.dispositivo <> 'robo') as cliques,
         max(k.clicado_em) filter (where k.dispositivo <> 'robo') as ultimo_clique
    from public.links_de_saida l
    left join public.contacts c on c.organization_id = l.organization_id and c.id = l.contact_id
    left join public.cliques_de_links_de_saida k on k.organization_id = l.organization_id and k.link_id = l.id
   where l.organization_id = p_org
   group by l.id, c.name, c.display_name
   order by l.created_at desc
   limit greatest(1, least(coalesce(p_limite, 500), 2000));
$$;
revoke execute on function public.fn_links_de_saida_resumo(uuid, int) from public, anon, authenticated;
grant execute on function public.fn_links_de_saida_resumo(uuid, int) to service_role;

notify pgrst, 'reload schema';
