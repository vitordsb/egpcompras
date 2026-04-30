-- Adiciona número WhatsApp ao cadastro de fornecedores
alter table suppliers add column if not exists whatsapp_phone text;
