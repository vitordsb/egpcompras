-- Kits: produto composto por outros produtos (BOM agregada)
alter table products
  add column if not exists is_kit boolean not null default false;

create table if not exists product_kits (
  id                   uuid        primary key default gen_random_uuid(),
  kit_product_id       uuid        not null references products(id) on delete cascade,
  component_product_id uuid        not null references products(id) on delete restrict,
  quantity             numeric(10,4) not null default 1,
  created_at           timestamptz not null default now(),
  unique(kit_product_id, component_product_id)
);

create index if not exists product_kits_kit_idx on product_kits(kit_product_id);

-- BOM expandida de um kit: todos os componentes raw resultantes
create or replace view kit_bom_expanded as
select
  pk.kit_product_id,
  b.component_id,
  c.name  as component_name,
  c.sku   as component_sku,
  c.unit  as component_unit,
  sum(b.quantity * pk.quantity) as total_quantity
from product_kits pk
join bom_items    b  on b.product_id = pk.component_product_id
join components   c  on c.id = b.component_id
group by pk.kit_product_id, b.component_id, c.name, c.sku, c.unit;

-- Recria products_with_cost incluindo is_kit, show_price e custo de kits
drop view if exists products_with_cost;
create view products_with_cost as
select
  p.id,
  p.sku,
  p.name,
  p.description,
  p.image_url,
  p.sale_price_brl,
  p.pricing_mode,
  p.custom_markup_pct,
  p.created_at,
  p.is_kit,
  p.show_price,
  case
    when p.is_kit then coalesce((
      select sum(comp.unit_cost_brl * pk.quantity)
      from product_kits pk
      join (
        select p2.id,
               coalesce(sum(b2.quantity * b2.target_price_brl), 0) as unit_cost_brl
        from products  p2
        left join bom_items b2 on b2.product_id = p2.id
        group by p2.id
      ) comp on comp.id = pk.component_product_id
      where pk.kit_product_id = p.id
    ), 0)
    else coalesce(sum(b.quantity * b.target_price_brl), 0)
  end as unit_cost_brl
from products p
left join bom_items b on b.product_id = p.id and not p.is_kit
group by p.id;
