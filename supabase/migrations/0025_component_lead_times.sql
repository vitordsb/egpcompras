-- Lead time e rastreio de chegada de materiais.

-- Tempo de entrega típico por componente (em dias)
alter table components
  add column if not exists lead_time_days integer;   -- ex: 15 dias para bobina

-- Estende purchase_needs com campos de chegada
alter table purchase_needs
  add column if not exists expected_arrival date,     -- data prevista de chegada
  add column if not exists carrier          text,     -- transportadora ou "retirada"
  add column if not exists ordered_at       date,     -- quando foi feito o pedido
  add column if not exists ordered_quantity numeric(12,3); -- quantidade pedida
