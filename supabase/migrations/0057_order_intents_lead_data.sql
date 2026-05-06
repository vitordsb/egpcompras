-- Coluna pra guardar os dados de qualificação B2B coletados pela IA
-- via WhatsApp (CNPJ, razão social, comprador, endereço, etc).
-- A vendedora usa esses dados pra fechar o pedido.

alter table order_intents
  add column if not exists collected_lead_data jsonb;
