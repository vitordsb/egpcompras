-- Permite excluir produtos/componentes mesmo quando referenciados por
-- registros históricos (cotações, pedidos). O comportamento esperado é que
-- esses registros virem snapshots — o vínculo vira NULL mas o histórico fica.
--
-- Ajustes:
--   quotations.product_id           → SET NULL (era RESTRICT/NOT NULL)
--   quotation_items.component_id    → SET NULL (era RESTRICT/NOT NULL)
--   shipment_items.product_id       → SET NULL (era RESTRICT/NOT NULL)

-- 1) quotations.product_id ---------------------------------------------------
alter table quotations alter column product_id drop not null;
alter table quotations drop constraint if exists quotations_product_id_fkey;
alter table quotations
  add constraint quotations_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

-- 2) quotation_items.component_id -------------------------------------------
alter table quotation_items alter column component_id drop not null;
alter table quotation_items drop constraint if exists quotation_items_component_id_fkey;
alter table quotation_items
  add constraint quotation_items_component_id_fkey
  foreign key (component_id) references components(id) on delete set null;

-- 3) shipment_items.product_id ----------------------------------------------
alter table shipment_items alter column product_id drop not null;
alter table shipment_items drop constraint if exists shipment_items_product_id_fkey;
alter table shipment_items
  add constraint shipment_items_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;
