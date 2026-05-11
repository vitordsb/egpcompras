-- Habilita Realtime nas tabelas de WhatsApp.
--
-- Por default a publication supabase_realtime fica VAZIA — Realtime não
-- entrega nada até as tabelas serem adicionadas explicitamente.
-- REPLICA IDENTITY FULL garante que UPDATEs entreguem todos os campos
-- (não só os que mudaram), permitindo o cliente reagir sem refetch.

-- whatsapp_messages: insert de inbound/outbound → notifica UI
alter publication supabase_realtime add table whatsapp_messages;
alter table whatsapp_messages replica identity full;

-- whatsapp_sessions: update de human_takeover, status, etc.
alter publication supabase_realtime add table whatsapp_sessions;
alter table whatsapp_sessions replica identity full;

-- rollback:
-- alter publication supabase_realtime drop table whatsapp_messages;
-- alter publication supabase_realtime drop table whatsapp_sessions;
