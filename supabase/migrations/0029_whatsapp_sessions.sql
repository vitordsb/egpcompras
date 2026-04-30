-- Sessões de conversa WhatsApp (histórico por número de telefone)
create table if not exists whatsapp_sessions (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null unique,
  history     jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Log de mensagens trafegadas
create table if not exists whatsapp_messages (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null,
  direction  text not null check (direction in ('in','out')),
  text       text not null,
  created_at timestamptz not null default now()
);

create index on whatsapp_messages (phone, created_at desc);
