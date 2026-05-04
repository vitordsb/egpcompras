-- Vendedoras que recebem handoff do bot
create table if not exists sellers (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null,
  whatsapp_number  text        not null,     -- formato E.164 ex: 5511979818472
  status           text        not null default 'available', -- 'available' | 'busy' | 'offline'
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Vendedoras iniciais
insert into sellers (name, whatsapp_number, status) values
  ('Joane',    '5511979818472', 'available'),
  ('Nathanna', '5511941059408', 'available');
