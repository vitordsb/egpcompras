-- Coluna origem nos pedidos (whatsapp, manual, pdf, etc)
alter table shipments add column if not exists origem text default 'manual';

-- Tabela de notificações de pedidos via WhatsApp
create table if not exists whatsapp_orders (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid references shipments(id) on delete cascade,
  phone        text not null,
  client_name  text not null,
  notified     boolean not null default false,
  created_at   timestamptz not null default now()
);
