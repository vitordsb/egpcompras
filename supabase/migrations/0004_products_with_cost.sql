-- View que junta produtos com o custo unitário agregado da BOM.
-- unit_cost_brl = soma de (quantity × target_price_brl) das linhas da BOM.

create or replace view products_with_cost as
select
  p.id,
  p.sku,
  p.name,
  p.description,
  p.image_url,
  p.sale_price_brl,
  p.created_at,
  coalesce(sum(b.quantity * b.target_price_brl), 0) as unit_cost_brl
from products p
left join bom_items b on b.product_id = p.id
group by p.id;
