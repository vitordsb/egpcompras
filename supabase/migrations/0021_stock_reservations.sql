-- Adiciona reserva suave ao estoque.
-- reserved_quantity = comprometido por pedidos criados mas não saídos ainda.
-- available = quantity - reserved_quantity

alter table stock_items
  add column if not exists reserved_quantity numeric(12,3) not null default 0;
