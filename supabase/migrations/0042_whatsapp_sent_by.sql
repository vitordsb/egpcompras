-- Rastreia quem enviou cada mensagem (admin, vendedor, comprador, etc)
alter table whatsapp_messages add column if not exists sent_by text;
create index if not exists whatsapp_messages_sent_by_idx on whatsapp_messages (sent_by) where sent_by is not null;

-- Útil pra filtrar conversas onde determinado usuário participou
create index if not exists whatsapp_messages_phone_sent_by_idx
  on whatsapp_messages (phone, sent_by) where sent_by is not null;
