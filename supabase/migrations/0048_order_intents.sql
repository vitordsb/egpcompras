-- Intenções de compra geradas pelo bot — rascunho antes de virar shipment
create table if not exists order_intents (
  id                   uuid        primary key default gen_random_uuid(),
  session_id           uuid        references whatsapp_sessions(id) on delete set null,
  phone                text        not null,
  client_name          text,
  items                jsonb       not null default '[]',
  -- items: [{ name, sku, quantity, unit_price }]
  forma_pagamento      text,
  status               text        not null default 'pending',
  -- status: 'pending' | 'confirmed' | 'cancelled' | 'converted'
  converted_shipment_id uuid       references shipments(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists order_intents_phone_status_idx   on order_intents (phone, status);
create index if not exists order_intents_status_created_idx on order_intents (status, created_at desc);
