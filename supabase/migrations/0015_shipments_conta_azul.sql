-- Expande shipments pra parear com o modelo do Conta Azul (importação de PDF).
-- Campos do cliente, frete, totais e forma de pagamento agora ficam no pedido.
-- shipment_items vira flex: product_id nullable + campos livres de item.

alter table shipments
  add column if not exists numero_venda     text,
  add column if not exists data_venda       date,
  add column if not exists client_cnpj      text,
  add column if not exists client_phone     text,
  add column if not exists client_email     text,
  add column if not exists client_address   text,
  add column if not exists frete_tipo       text,
  add column if not exists frete_valor      numeric(14,2),
  add column if not exists total_produtos   numeric(14,2),
  add column if not exists valor_total      numeric(14,2),
  add column if not exists forma_pagamento  text,
  add column if not exists condicao_pagamento text;

create index if not exists shipments_numero_venda_idx
  on shipments(numero_venda) where numero_venda is not null;

-- Torna product_id opcional (itens de PDF podem não ter match no catálogo)
alter table shipment_items
  alter column product_id drop not null;

-- Campos livres do item (código e descrição do Conta Azul, preço unitário)
alter table shipment_items
  add column if not exists item_code   text,
  add column if not exists item_name   text,
  add column if not exists unit_price  numeric(14,2);

-- O UNIQUE (shipment_id, product_id) não funciona com NULLs e itens livres.
-- Troca por índice parcial aplicado só quando product_id está preenchido.
alter table shipment_items drop constraint if exists shipment_items_shipment_id_product_id_key;

create unique index if not exists shipment_items_ship_product_uniq
  on shipment_items(shipment_id, product_id)
  where product_id is not null;
