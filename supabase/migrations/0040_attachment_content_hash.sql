-- Hash do conteúdo para deduplicação de anexos
alter table shipment_attachments add column if not exists content_hash text;
create index if not exists shipment_attachments_hash_idx
  on shipment_attachments (shipment_id, content_hash);
