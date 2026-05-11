-- Flag de "atendimento manual" por sessão. Quando true, a IA NÃO responde
-- mensagens novas desse contato — a vendedora assumiu a conversa.
--
-- Fluxo:
--   1. Vendedora clica "Atender manualmente" no WhatsAppPage → seta true
--   2. Webhook recebe mensagem inbound → registra mas não chama Gemini
--   3. Vendedora desativa o toggle → IA volta a responder

alter table whatsapp_sessions
  add column if not exists human_takeover boolean not null default false;

create index if not exists whatsapp_sessions_human_takeover_idx
  on whatsapp_sessions(phone) where human_takeover = true;

-- rollback:
-- alter table whatsapp_sessions drop column if exists human_takeover;
