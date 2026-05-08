-- Melhorias de busca por item:
--   1. unaccent: ignora acentos (MAÇA = MACA, sapatás = sapatas)
--   2. item_synonyms: tabela de sinônimos customizados da EGP
--      ex: "fonte" ↔ ["carregador", "alimentador", "fontinha"]
--   3. RPC search_shipment_items_smart: combina unaccent + sinônimos +
--      pg_trgm fuzzy ranking pra catch erros de digitação

create extension if not exists unaccent;
-- pg_trgm já foi habilitado na 0054

-- ── Tabela de sinônimos customizados ─────────────────────────────────────
-- canonical: forma "principal" normalizada (lower + sem acento)
-- variants: outras formas equivalentes (todas normalizadas)
-- A IA pode adicionar via tool quando notar que termo X = termo Y na operação

create table if not exists item_synonyms (
  id uuid primary key default gen_random_uuid(),
  canonical text not null,
  variants  text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (canonical)
);

create index if not exists item_synonyms_variants_idx
  on item_synonyms using gin(variants);

create index if not exists item_synonyms_canonical_idx
  on item_synonyms(canonical);

alter table item_synonyms disable row level security;

-- ── Função auxiliar de normalização ──────────────────────────────────────
-- Lower + remove acentos. Usada em buscas e antes de inserir sinônimos.

create or replace function normalize_search(t text) returns text
  language sql immutable as $$
  select lower(unaccent(coalesce(t, '')));
$$;

-- ── RPC: busca inteligente em shipment_items ─────────────────────────────
-- Combina:
--   - unaccent: "MAÇA" casa com "MACA"
--   - sinônimos cadastrados: "fonte" busca também "carregador"
--   - pg_trgm fuzzy: "PARAFUS" casa com "PARAFUSO" mesmo com 1 char errado
--   - radical (singular/plural): aplicado em TS-side antes de chamar
--
-- match_score: 0 a 1 (1 = match perfeito). Ordena DESC.

create or replace function search_shipment_items_smart(
  p_term text,
  p_status text default null,
  p_limit int default 50
) returns table(
  shipment_id uuid,
  client_name text,
  numero_venda text,
  numero_nfe text,
  shipment_status text,
  data_venda date,
  data_prevista date,
  valor_total numeric,
  item_id uuid,
  item_name text,
  item_code text,
  quantity numeric,
  unit_price numeric,
  match_score real,
  matched_via text
) language plpgsql stable as $$
declare
  v_term_norm text;
  v_search_terms text[];
begin
  v_term_norm := normalize_search(p_term);
  if length(v_term_norm) < 2 then
    return;
  end if;

  -- Monta lista de termos pra buscar: o termo original + sinônimos cadastrados
  -- (em qualquer direção: se p_term é canonical OU é uma variant, pega tudo)
  with syn as (
    select array_agg(distinct s) as terms
    from item_synonyms,
         lateral unnest(array[canonical] || variants) s
    where canonical = v_term_norm
       or v_term_norm = any(variants)
  )
  select coalesce(syn.terms, '{}') || v_term_norm into v_search_terms
  from syn;

  return query
  with candidates as (
    select
      si.id as item_id,
      si.shipment_id,
      si.item_name,
      si.item_code,
      si.quantity,
      si.unit_price,
      normalize_search(si.item_name) as nname,
      normalize_search(coalesce(si.item_code, '')) as ncode
    from shipment_items si
  ),
  matched as (
    select
      c.*,
      -- Match exato (substring) em qualquer termo: score 1.0
      case
        when exists (
          select 1 from unnest(v_search_terms) t
          where c.nname like '%' || t || '%' or c.ncode like '%' || t || '%'
        ) then 1.0
        else 0
      end as exact_score,
      -- Match fuzzy via pg_trgm: similaridade do termo principal contra nome
      greatest(
        similarity(c.nname, v_term_norm),
        similarity(c.ncode, v_term_norm)
      ) as fuzzy_score
    from candidates c
  )
  select
    s.id as shipment_id,
    s.client_name,
    s.numero_venda,
    s.numero_nfe,
    s.status as shipment_status,
    s.data_venda,
    s.data_prevista,
    s.valor_total,
    m.item_id,
    m.item_name,
    m.item_code,
    m.quantity,
    m.unit_price,
    greatest(m.exact_score, m.fuzzy_score)::real as match_score,
    case
      when m.exact_score >= 1.0 then 'exact'
      when m.fuzzy_score > 0.4 then 'fuzzy'
      else 'partial'
    end as matched_via
  from matched m
  join shipments s on s.id = m.shipment_id
  where (p_status is null or p_status = 'all' or s.status = p_status)
    and (m.exact_score > 0 or m.fuzzy_score > 0.3)
  order by greatest(m.exact_score, m.fuzzy_score) desc, s.created_at desc
  limit p_limit;
end;
$$;
