-- Adiciona o modo de precificação escolhido pelo usuário em cada produto.
-- Modos: markup_30 (custo×1.30), markup_50 (custo×1.50), ponto_7 (custo/0.7),
--        custom (custo × (1 + custom_markup_pct/100))

alter table products
  add column if not exists pricing_mode      text not null default 'markup_30',
  add column if not exists custom_markup_pct numeric(7,4);

alter table products
  add constraint products_pricing_mode_chk
  check (pricing_mode in ('markup_30','markup_50','ponto_7','custom'));

-- Recria a view incluindo os novos campos (DROP+CREATE pois CREATE OR REPLACE
-- não permite alterar lista de colunas)
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
  coalesce(sum(b.quantity * b.target_price_brl), 0) as unit_cost_brl
from products p
left join bom_items b on b.product_id = p.id
group by p.id;
