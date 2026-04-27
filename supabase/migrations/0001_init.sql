-- =====================================================================
-- EGP Compras — schema inicial
-- Aplicação interna: cotação de componentes com fornecedores via link público.
-- Comparação por linha: vencedor é o menor preço EFETIVO (com impostos).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Catálogo de componentes (placas, caixas, embalagens, conectores...)
-- ---------------------------------------------------------------------
create table if not exists components (
  id           uuid primary key default gen_random_uuid(),
  sku          text unique,
  name         text not null,
  description  text,
  ncm          text,                     -- opcional, só p/ NF
  unit         text not null default 'un',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Produtos finais (ex: "Controle XYZ")
-- ---------------------------------------------------------------------
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  sku          text unique,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- BOM: componentes que compõem cada produto, com qty + target em BRL
-- ---------------------------------------------------------------------
create table if not exists bom_items (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  component_id    uuid not null references components(id) on delete restrict,
  quantity        numeric(14,4) not null check (quantity > 0),
  target_price_brl numeric(14,4),         -- target unitário em BRL
  notes           text,
  created_at      timestamptz not null default now(),
  unique (product_id, component_id)
);

create index if not exists bom_items_product_idx on bom_items(product_id);

-- ---------------------------------------------------------------------
-- Fornecedores
-- ---------------------------------------------------------------------
create table if not exists suppliers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  email            text not null,
  contact_name     text,
  default_currency text not null default 'BRL' check (default_currency in ('BRL','USD')),
  notes            text,
  created_at       timestamptz not null default now()
);

create unique index if not exists suppliers_email_idx on suppliers(lower(email));

-- ---------------------------------------------------------------------
-- Rodada de cotação (snapshot dos itens é gravado em quotation_items)
-- ---------------------------------------------------------------------
create table if not exists quotations (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id),
  title         text not null,
  status        text not null default 'draft' check (status in ('draft','sent','closed')),
  deadline      timestamptz,
  usd_brl_rate  numeric(12,4),            -- snapshot do câmbio na criação (referência)
  created_at    timestamptz not null default now(),
  closed_at     timestamptz
);

-- ---------------------------------------------------------------------
-- Itens da cotação (snapshot — desacoplado da BOM atual)
-- ---------------------------------------------------------------------
create table if not exists quotation_items (
  id               uuid primary key default gen_random_uuid(),
  quotation_id     uuid not null references quotations(id) on delete cascade,
  component_id     uuid not null references components(id),
  quantity         numeric(14,4) not null,
  target_price_brl numeric(14,4),
  position         int not null default 0,
  unique (quotation_id, component_id)
);

create index if not exists quotation_items_quotation_idx on quotation_items(quotation_id);

-- ---------------------------------------------------------------------
-- Convite ao fornecedor (token único na URL pública)
-- ---------------------------------------------------------------------
create table if not exists quotation_invites (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references quotations(id) on delete cascade,
  supplier_id   uuid not null references suppliers(id),
  token         text unique not null default encode(gen_random_bytes(24), 'hex'),
  status        text not null default 'pending'
                check (status in ('pending','sent','opened','responded','expired')),
  sent_at       timestamptz,
  opened_at     timestamptz,
  responded_at  timestamptz,
  unique (quotation_id, supplier_id)
);

create index if not exists quotation_invites_token_idx on quotation_invites(token);

-- ---------------------------------------------------------------------
-- Resposta do fornecedor (cabeçalho)
-- ---------------------------------------------------------------------
create table if not exists quotation_responses (
  id                uuid primary key default gen_random_uuid(),
  invite_id         uuid not null unique references quotation_invites(id) on delete cascade,
  currency          text not null check (currency in ('BRL','USD')),
  usd_brl_rate_used numeric(12,4),        -- câmbio aplicado se cotou em USD
  notes             text,                  -- campo OBS livre (placeholder: prazo de entrega)
  submitted_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Linhas da resposta — preço unitário + alíquotas por componente.
-- unit_price NULL = fornecedor não cota esse item (deixou em branco).
-- effective_unit_price_brl é GERADO automaticamente:
--   preço × (1 + ipi + pis + cofins + st) [× câmbio se USD]
-- ---------------------------------------------------------------------
create table if not exists quotation_response_items (
  id                uuid primary key default gen_random_uuid(),
  response_id       uuid not null references quotation_responses(id) on delete cascade,
  quotation_item_id uuid not null references quotation_items(id),
  unit_price        numeric(14,4),         -- na moeda da resposta; null = não cota
  ipi_pct           numeric(7,4) not null default 0,
  pis_pct           numeric(7,4) not null default 0,
  cofins_pct        numeric(7,4) not null default 0,
  st_pct            numeric(7,4) not null default 0,
  unique (response_id, quotation_item_id)
);

create index if not exists qri_response_idx on quotation_response_items(response_id);
create index if not exists qri_item_idx on quotation_response_items(quotation_item_id);

-- ---------------------------------------------------------------------
-- VIEW de comparação — uma linha por (quotation_item × resposta).
-- Sempre normaliza pra BRL usando o câmbio que o fornecedor declarou na resposta.
-- ---------------------------------------------------------------------
create or replace view quotation_comparison as
select
  qi.quotation_id,
  qi.id                                              as quotation_item_id,
  qi.component_id,
  c.name                                             as component_name,
  c.sku                                              as component_sku,
  qi.quantity,
  qi.target_price_brl,
  qr.id                                              as response_id,
  qr.invite_id,
  s.id                                               as supplier_id,
  s.name                                             as supplier_name,
  qri.unit_price,
  qr.currency,
  qr.usd_brl_rate_used,
  qri.ipi_pct, qri.pis_pct, qri.cofins_pct, qri.st_pct,
  case
    when qri.unit_price is null then null
    else qri.unit_price
         * (1 + qri.ipi_pct + qri.pis_pct + qri.cofins_pct + qri.st_pct)
         * case when qr.currency = 'USD' then coalesce(qr.usd_brl_rate_used, 0) else 1 end
  end                                                as effective_unit_price_brl,
  case
    when qri.unit_price is null or qi.target_price_brl is null then null
    else (
      qri.unit_price
        * (1 + qri.ipi_pct + qri.pis_pct + qri.cofins_pct + qri.st_pct)
        * case when qr.currency = 'USD' then coalesce(qr.usd_brl_rate_used, 0) else 1 end
    ) - qi.target_price_brl
  end                                                as delta_vs_target_brl,
  qr.submitted_at
from quotation_items qi
join components c              on c.id = qi.component_id
left join quotation_responses qr on qr.invite_id in (
  select id from quotation_invites where quotation_id = qi.quotation_id
)
left join quotation_invites inv on inv.id = qr.invite_id
left join suppliers s          on s.id = inv.supplier_id
left join quotation_response_items qri
       on qri.response_id = qr.id and qri.quotation_item_id = qi.id;

-- ---------------------------------------------------------------------
-- VIEW de vencedores — pra cada item, qual fornecedor tem o menor
-- preço efetivo BRL (ignorando quem deixou em branco).
-- Só retorna linhas quando há ≥2 fornecedores que responderam algo na cotação.
-- ---------------------------------------------------------------------
create or replace view quotation_winners as
with respondents as (
  select quotation_id, count(distinct invite_id) as n_responded
  from quotation_comparison
  where unit_price is not null
  group by quotation_id
),
ranked as (
  select
    quotation_id, quotation_item_id, component_name, component_sku,
    quantity, target_price_brl, supplier_id, supplier_name,
    effective_unit_price_brl, delta_vs_target_brl,
    row_number() over (
      partition by quotation_item_id
      order by effective_unit_price_brl asc nulls last
    ) as rnk
  from quotation_comparison
  where unit_price is not null
)
select r.*
from ranked r
join respondents rs on rs.quotation_id = r.quotation_id
where r.rnk = 1 and rs.n_responded >= 2;

-- ---------------------------------------------------------------------
-- RLS — fornecedor acessa via token (Edge Function valida e usa service role).
-- Por enquanto deixamos RLS desabilitado nas tabelas internas; ative depois
-- de configurar Auth e definir policies por papel.
-- ---------------------------------------------------------------------
-- alter table products enable row level security;  -- ativar depois
