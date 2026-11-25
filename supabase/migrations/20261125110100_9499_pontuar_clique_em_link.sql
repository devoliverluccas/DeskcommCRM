-- manifest: **Clique em link rastreado de saída passa a poder dar pontos (fase 5).** `fn_registrar_clique_de_saida` (9490) é redefinida preservando tudo — link só DA organização passada e não anonimizado, o clique gravado sempre (robô inclusive), o fato só para clique de gente — e muda UMA coisa: o fato `link.clicked` nasce `pending` quando o link tem contato (é o que o consumidor `leads.pontuacao-por-regra` drena, com `contact_id`, `link_id` e `rotulo` no payload) e continua nascendo `done` quando o link não tem contato (registro, ninguém a pontuar). `regras_de_pontuacao.evento` ganha `link_clicado` no CHECK (recriado por nome, auto-curativo: só ACRESCENTA valor, nenhuma linha existente fica fora). Condição opcional da regra por rótulo do link vive em `lib/leads/pontuacao-por-regra.ts`; a idempotência é a chave `link_clicado:<link_id>` — como o link já é POR contato, um link pontua uma vez por contato, por mais cliques que receba.
--
-- ─── Por que `pending` só com contato ──────────────────────────────────────
--
-- O consumidor só tem o que fazer com quem tem contato: sem contato não há a
-- quem pontuar, e a linha `pending` sairia `skipped` no dreno sem ter servido a
-- nada. Nascer `done` nesse caso mantém o fato como REGISTRO (a tela de links
-- conta cliques pela tabela de cliques, não pelo `event_log`).
--
-- ─── Por que o clique não chama a pontuação aqui ───────────────────────────
--
-- Pontuar é ler regras, contato e teto — trabalho do consumidor, fora da
-- transação da rota pública `/l/<codigo>`, que só precisa redirecionar rápido.
-- A função continua sem HTTP: duas linhas locais.
--
-- Idempotente: `create or replace` e constraint recriada por nome.

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
      values (p_org, 'link.clicked', 'link_de_saida', p_link,
              case when v_contato is null then 'done' else 'pending' end,
              jsonb_build_object('link_id', p_link, 'clique_id', v_clique,
                                 'contact_id', v_contato, 'rotulo', v_rotulo));
  end if;
  return v_clique;
end;
$$;
revoke execute on function public.fn_registrar_clique_de_saida(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.fn_registrar_clique_de_saida(uuid, uuid, text, text, text) to service_role;

-- O vocabulário da regra ganha o clique. Recriar por nome é auto-curativo: o
-- conjunto novo CONTÉM o antigo, então nenhuma linha existente o viola.
alter table public.regras_de_pontuacao drop constraint if exists regras_de_pontuacao_evento_check;
alter table public.regras_de_pontuacao add constraint regras_de_pontuacao_evento_check
  check (evento in (
    'mensagem_recebida', 'respondeu_followup', 'agendamento_marcado',
    'orcamento_enviado', 'orcamento_aceito', 'etapa_alcancada', 'tag_aplicada',
    'link_clicado'
  ));

notify pgrst, 'reload schema';
