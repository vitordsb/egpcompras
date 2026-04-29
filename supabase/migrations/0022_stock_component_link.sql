-- Liga stock_items ao catálogo de componentes.
-- Permite cruzar BOM × estoque diretamente por JOIN sem depender de item_code fuzzy.

alter table stock_items
  add column if not exists component_id uuid references components(id) on delete set null;

create index if not exists stock_items_component_idx
  on stock_items(component_id) where component_id is not null;

-- Tenta linkar entradas existentes onde item_code bate com o SKU do componente.
update stock_items s
  set component_id = c.id
  from components c
  where s.component_id is null
    and lower(s.item_code) = lower(c.sku);
