-- Rastreia entrega real das mensagens via status do webhook Meta.
-- message_id: ID retornado pela Meta API ao enviar (wamid.xxx)
-- delivery_status: sent → delivered → read | failed | undelivered
alter table whatsapp_messages
  add column if not exists message_id      text,
  add column if not exists delivery_status text default 'sent';

-- Índice para lookup rápido ao receber status do webhook
create index if not exists whatsapp_messages_message_id_idx
  on whatsapp_messages (message_id)
  where message_id is not null;
