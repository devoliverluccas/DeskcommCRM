-- manifest: **A busca do catálogo vai ao banco — e acha produto em catálogo de qualquer tamanho; o produto ganha preço promocional.** A ferramenta `crm_search_products` trazia os produtos ativos em páginas de 1000 até 10 páginas e pontuava em memória: num catálogo de 77 mil itens, o produto que existe "não era encontrado" (o resto ficava além do teto, reportado como `varredura_parcial`). Agora `fn_buscar_produtos(p_org, p_termo, p_limite, p_somente_disponiveis, p_categoria, p_offset)` devolve os candidatos mais parecidos do catálogo INTEIRO (código exato primeiro, depois a semelhança por palavra), sobre uma coluna gerada `busca_normalizada` (nome, código, marca, categoria e capacidade sem acento, minúsculos, só letra e número) com índice de trigrama, e a pontuação de `lib/catalogo/busca.ts` roda em cima deles — a régua (palavra difusa, número exato) é a mesma. O número da consulta que algum produto da loja tem FILTRA dentro da função (o 128GB não entra como candidato de quem pediu 256GB); o que nenhum produto tem não filtra, e o relaxamento que avisa o agente continua do lado do TypeScript. `security invoker`: pela sessão a RLS vale, e pelo service role o filtro `organization_id = p_org` é o corte; sem EXECUTE para `public`/`anon`. Coluna nova `preco_promocional_cents bigint` (nulo = sem promoção; CHECK `>= 0` e `< preco_cents`), auto-curativa: promoção inválida já gravada vira nula antes da constraint. Índice `(organization_id, lower(codigo))` para o código exato e `(organization_id, categoria)` para o filtro da tela, e `fn_categorias_do_catalogo(p_org)` (invoker, até 500) para as opções desse filtro — o PostgREST não tem DISTINCT.
--
-- ─── Por que a coluna é GERADA, e não um índice de expressão ────────────────
--
-- A função compara a MESMA forma normalizada em três lugares (filtro de número,
-- semelhança, prefixo). Repetir a expressão inteira em cada um é o jeito de um
-- dia uma delas divergir da do índice e a consulta voltar a varrer a tabela em
-- silêncio. A coluna é a expressão escrita uma vez. `f_unaccent` é o wrapper
-- `immutable` da migration 9100 (o `unaccent()` da extensão é STABLE e o
-- Postgres o recusa em coluna gerada).
--
-- ⚠️ `capacidade` (migration 9341) entra na coluna: "256" acha o produto cujo
-- nome não repete a capacidade. No baseline este bloco fica ACIMA da VARREDURA
-- anon (cria função), e lá a 9341 vem DEPOIS — por isso o `add column if not
-- exists capacidade` abaixo, idêntico ao da 9341, que segue idempotente.
--
-- ─── Por que o número filtra AQUI dentro ────────────────────────────────────
--
-- A semelhança de trigrama entre "iPhone 15 Pro 256GB" e "iPhone 15 Pro 128GB"
-- é altíssima: sem o filtro, os 200 candidatos de "iphone 15 pro 256" numa loja
-- com 500 variantes podiam não incluir o 256. O filtro é o mesmo de
-- `temONumero()` em `lib/catalogo/busca.ts`: o número inteiro, com no máximo
-- quatro letras de unidade coladas ("256" casa "256gb", "15" NÃO casa "153ml").
-- Só filtra o número que ALGUM produto ativo da loja tem — o que nenhum tem
-- ("quero 2 iphone") é quantidade ou orçamento, e quem decide e avisa é o
-- relaxamento do TypeScript, que vê o mesmo vazio que via antes.

alter table public.catalog_products add column if not exists capacidade text;

-- ── preço promocional ───────────────────────────────────────────────────────
alter table public.catalog_products add column if not exists preco_promocional_cents bigint;

-- Auto-cura ANTES da constraint: um valor inválido gravado por qualquer caminho
-- (clone antigo, edição à mão) faria o `add constraint` falhar e o `update.sh`
-- seguir sem ela. Promoção que não é menor que o preço não é promoção.
update public.catalog_products
   set preco_promocional_cents = null
 where preco_promocional_cents is not null
   and (preco_promocional_cents < 0 or preco_promocional_cents >= preco_cents);

alter table public.catalog_products
  drop constraint if exists catalog_products_promocional_valido;
alter table public.catalog_products
  add constraint catalog_products_promocional_valido check (
    preco_promocional_cents is null
    or (preco_promocional_cents >= 0 and preco_promocional_cents < preco_cents)
  );

comment on column public.catalog_products.preco_promocional_cents is
  'Preço de promoção, na mesma moeda de preco_cents. Nulo = sem promoção. Quando há, é o preço que o agente responde e que o orçamento usa (precoVigente em lib/catalogo/preco.ts).';

-- ── a forma buscável ────────────────────────────────────────────────────────
alter table public.catalog_products
  add column if not exists busca_normalizada text
  generated always as (
    btrim(regexp_replace(
      lower(public.f_unaccent(
        coalesce(nome, '') || ' ' || coalesce(codigo, '') || ' ' || coalesce(marca, '') || ' ' ||
        coalesce(categoria, '') || ' ' || coalesce(capacidade, '')
      )),
      '[^a-z0-9]+', ' ', 'g'
    ))
  ) stored;

comment on column public.catalog_products.busca_normalizada is
  'Gerada: nome, código, marca, categoria e capacidade sem acento, minúsculos, só letras e números separados por espaço. É sobre ela que fn_buscar_produtos procura (índice de trigrama).';

create index if not exists catalog_products_busca_trgm
  on public.catalog_products using gin (busca_normalizada public.gin_trgm_ops);

create index if not exists catalog_products_org_codigo_lower_idx
  on public.catalog_products (organization_id, lower(codigo));

create index if not exists catalog_products_org_categoria_idx
  on public.catalog_products (organization_id, categoria)
  where categoria is not null;

-- ── a função ────────────────────────────────────────────────────────────────
--
-- plpgsql, e não sql: o corpo só é conferido ao rodar. No baseline a função
-- nasce acima da VARREDURA anon, e numa instalação nova a 9341 (capacidade)
-- ainda não rodou ali — um corpo `language sql` conferido na criação
-- reprovaria por uma coluna que existe no fim do mesmo arquivo.
create or replace function public.fn_buscar_produtos(
  p_org uuid,
  p_termo text,
  p_limite integer default 200,
  p_somente_disponiveis boolean default false,
  p_categoria text default null,
  p_offset integer default 0
)
returns setof public.catalog_products
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_cru text := btrim(coalesce(p_termo, ''));
  v_norm text;
  v_token text;
  v_palavras text[] := '{}';
  v_numeros text[] := '{}';
  v_conhecidos text[] := '{}';
  v_padroes text[] := '{}';
  v_difusas text[] := '{}';
  v_n text;
  v_limite integer := least(greatest(coalesce(p_limite, 200), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_ruido constant text[] := array['de','do','da','com','para','por','the','e','o','a','um','uma'];
begin
  if p_org is null or v_cru = '' then
    return;
  end if;

  -- A mesma normalização de `normalizar()` em lib/catalogo/busca.ts.
  v_norm := btrim(regexp_replace(lower(public.f_unaccent(v_cru)), '[^a-z0-9]+', ' ', 'g'));
  if v_norm = '' then
    return;
  end if;

  -- A mesma tokenização de `tokenizar()`: "256gb" é o número 256.
  foreach v_token in array string_to_array(v_norm, ' ') loop
    continue when v_token = '' or v_token = any (v_ruido);
    if v_token ~ '^[0-9]+[a-z]{0,4}$' then
      v_numeros := v_numeros || substring(v_token from '^[0-9]+');
    else
      v_palavras := v_palavras || v_token;
    end if;
  end loop;

  -- Número que ALGUM produto ativo da loja tem filtra; o que nenhum tem, não.
  foreach v_n in array v_numeros loop
    if exists (
      select 1
        from public.catalog_products c
       where c.organization_id = p_org
         and c.ativo
         and c.busca_normalizada ~ ('(^| )' || v_n || '[a-z]{0,4}( |$)')
    ) then
      v_conhecidos := v_conhecidos || ('(^| )' || v_n || '[a-z]{0,4}( |$)');
    end if;
  end loop;

  if array_length(v_palavras, 1) is null and array_length(v_conhecidos, 1) is null then
    -- Só números que nenhum produto tem (ou nada): não há o que procurar. O
    -- código exato ainda vale — "123" pode ser um SKU.
    return query
      select c.*
        from public.catalog_products c
       where c.organization_id = p_org
         and c.ativo
         and lower(c.codigo) = lower(v_cru)
         and (not p_somente_disponiveis or not c.controla_estoque or c.quantidade > 0)
         and (p_categoria is null or c.categoria = p_categoria)
       limit v_limite offset v_offset;
    return;
  end if;

  if array_length(v_palavras, 1) is null then
    -- Só números conhecidos ("256"): todo produto que tem todos eles.
    return query
      select c.*
        from public.catalog_products c
       where c.organization_id = p_org
         and c.ativo
         and (not p_somente_disponiveis or not c.controla_estoque or c.quantidade > 0)
         and (p_categoria is null or c.categoria = p_categoria)
         and c.busca_normalizada ~ all (v_conhecidos)
       order by (lower(c.codigo) = lower(v_cru)) desc, c.nome, c.id
       limit v_limite offset v_offset;
    return;
  end if;

  -- QUEM CONCORRE, palavra a palavra. A palavra que aparece escrita em algum
  -- produto da loja ("perfume", "pro") entra pelo texto (`like`, índice de
  -- trigrama). A que não aparece em nenhum ("ifone", "perfme") é erro de
  -- digitação, e entra pela semelhança por palavra (`%>`), com limiar baixo:
  -- medido, "ifone" × "iphone" dá 0,333 — abaixo do 0,6 padrão.
  --
  -- Separar as duas não é enfeite: com a semelhança ligada para TODA palavra,
  -- "perfume vermelho" trazia metade de um catálogo de 20 mil linhas como
  -- candidato (medido: 10 004), e a ordenação custava ~250 ms.
  foreach v_token in array v_palavras loop
    if exists (
      select 1
        from public.catalog_products c
       where c.organization_id = p_org
         and c.ativo
         and c.busca_normalizada like ('%' || v_token || '%')
    ) then
      v_padroes := v_padroes || ('%' || v_token || '%');
    else
      v_difusas := v_difusas || v_token;
    end if;
  end loop;
  perform pg_catalog.set_config('pg_trgm.word_similarity_threshold', '0.3', true);

  -- A ORDEM entre os candidatos imita a nota de `pontuar()`: por palavra da
  -- consulta, o melhor casamento com UMA palavra do produto — igual (1), prefixo
  -- de 3+ letras (0,9), senão a semelhança de trigrama, cortada quando a
  -- inicial difere. A inicial importa pelo mesmo motivo medido lá: sem ela,
  -- "ifone" punha 2 000 "Fone Bluetooth" (semelhança 0,5) na frente dos três
  -- iPhones (0,33) e os iPhones nem entravam nos 200 candidatos. A nota que
  -- decide o que o agente vê continua sendo a do TypeScript; aqui só se escolhe
  -- quem chega até ela.
  --
  -- A PRÉVIA: numa palavra que está em quase todo produto ("modelo", "kit"), a
  -- nota completa em todos custava ~250 ms em 20 mil linhas. A prévia ordena
  -- pelo casamento barato (palavra inteira vale 2, começo de palavra vale 1) e
  -- só os primeiros 2 000 recebem a nota completa (~85 ms medidos). Com
  -- palavra difusa na consulta não há prévia: ali a semelhança é o que
  -- separa o iPhone do fone, e ela é a parte cara que a prévia pularia.
  return query
    with previa as (
      select c.id,
             (lower(c.codigo) = lower(v_cru)) as exato
        from public.catalog_products c
       where c.organization_id = p_org
         and c.ativo
         and (not p_somente_disponiveis or not c.controla_estoque or c.quantidade > 0)
         and (p_categoria is null or c.categoria = p_categoria)
         and (array_length(v_conhecidos, 1) is null or c.busca_normalizada ~ all (v_conhecidos))
         and (
           lower(c.codigo) = lower(v_cru)
           or c.busca_normalizada like any (v_padroes)
           or c.busca_normalizada operator(public.%>) any (v_difusas)
         )
       order by
         (lower(c.codigo) = lower(v_cru)) desc,
         (
           select count(*) filter (where (' ' || c.busca_normalizada || ' ') like ('% ' || w || ' %'))
                + count(*) filter (where (' ' || c.busca_normalizada) like ('% ' || w || '%'))
             from unnest(v_palavras) as w
         ) desc,
         c.nome,
         c.id
       limit case when array_length(v_difusas, 1) is null then greatest(2000, v_offset + v_limite) end
    )
    select c.*
      from previa p
      join public.catalog_products c on c.id = p.id
     order by
       p.exato desc,
       (
         select avg(m.melhor)
           from (
             select max(
                      case
                        when t = w then 1.0
                        when length(w) >= 3
                         and (left(t, length(w)) = w or left(w, length(t)) = t) then 0.9
                        else public.similarity(w, t)
                             * case when left(t, 1) = left(w, 1) then 1.0 else 0.6 end
                      end
                    ) as melhor
               from unnest(v_palavras) as w,
                    unnest(string_to_array(c.busca_normalizada, ' ')) as t
              group by w
           ) m
       ) desc,
       c.nome,
       c.id
     limit v_limite offset v_offset;
end;
$fn$;

comment on function public.fn_buscar_produtos(uuid, text, integer, boolean, text, integer) is
  'Candidatos da busca do catálogo de UMA organização, do catálogo inteiro: código exato primeiro, depois semelhança por palavra; número que algum produto tem filtra. security invoker — pela sessão a RLS vale; pelo service role o corte é p_org. A pontuação final é a de lib/catalogo/busca.ts.';

-- Nasce com EXECUTE para PUBLIC (Postgres) e para anon (default privileges do
-- baseline): as duas origens saem. A tela chama pela sessão; a ferramenta do
-- agente, pelo service role.
revoke execute on function public.fn_buscar_produtos(uuid, text, integer, boolean, text, integer) from public, anon;
grant execute on function public.fn_buscar_produtos(uuid, text, integer, boolean, text, integer) to authenticated, service_role;

-- ── as categorias que existem (o filtro da tela) ────────────────────────────
--
-- O PostgREST não tem DISTINCT: sem a função, a tela teria de baixar a coluna
-- de 77 mil linhas para montar um seletor. Teto de 500 opções — acima disso o
-- seletor deixa de ser seletor, e a busca por texto é o caminho.
create or replace function public.fn_categorias_do_catalogo(p_org uuid)
returns table (categoria text, quantidade bigint)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select c.categoria, count(*) as quantidade
    from public.catalog_products c
   where c.organization_id = p_org
     and c.categoria is not null
     and btrim(c.categoria) <> ''
   group by c.categoria
   order by c.categoria
   limit 500;
$fn$;

comment on function public.fn_categorias_do_catalogo(uuid) is
  'As categorias do catálogo de UMA organização, com quantos produtos cada uma tem (até 500). security invoker: pela sessão a RLS vale.';

revoke execute on function public.fn_categorias_do_catalogo(uuid) from public, anon;
grant execute on function public.fn_categorias_do_catalogo(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
