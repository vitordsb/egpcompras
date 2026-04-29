-- Tipo do produto: revenda (compra e revende direto) ou fabricacao (monta com BOM).
alter table products
  add column if not exists product_type text not null default 'revenda'
    check (product_type in ('revenda', 'fabricacao'));

-- Produtos que já têm BOM provavelmente são de fabricação — atualiza automaticamente.
update products p
  set product_type = 'fabricacao'
  where exists (select 1 from bom_items b where b.product_id = p.id)
    and p.product_type = 'revenda';
