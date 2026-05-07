-- Separa bom_items em "fabricacao" (componentes da placa) e "acervo"
-- (embalagens, etiquetas, caixas, manuais — itens que vão pro produto
-- final mas não são montados).
--
-- Custo de fabricação = soma items tipo 'fabricacao'
-- Custo de acervo = soma items tipo 'acervo'
-- Custo total do produto = fabricacao + acervo
-- Preço de venda = custo total × markup

alter table bom_items
  add column if not exists tipo text not null default 'fabricacao'
    check (tipo in ('fabricacao', 'acervo'));

create index if not exists bom_items_tipo_idx on bom_items(tipo);

-- Atualiza products_with_cost pra expor os 2 subtotais separadamente.
-- unit_cost_brl continua sendo o total (compatibilidade) — soma fabricação + acervo.
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
  p.product_type,
  p.unit,
  p.direct_cost_brl,
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
    when p.product_type = 'revenda' then coalesce(p.direct_cost_brl, 0)
    else coalesce(sum(b.quantity * b.target_price_brl), 0)
  end as unit_cost_brl,
  -- Subtotais por tipo (apenas pra fabricação — kits e revenda não usam)
  coalesce(sum(b.quantity * b.target_price_brl) filter (where b.tipo = 'fabricacao'), 0) as fabricacao_cost_brl,
  coalesce(sum(b.quantity * b.target_price_brl) filter (where b.tipo = 'acervo'),     0) as acervo_cost_brl
from products p
left join bom_items b on b.product_id = p.id and p.product_type = 'fabricacao' and not p.is_kit
group by p.id;
