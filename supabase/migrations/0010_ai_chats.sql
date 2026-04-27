-- Histórico persistente de conversas com o agente Comprador.
-- Cada chat tem N mensagens; cada mensagem é um "turn" (user/model/toolCall/toolResponse)
-- armazenado como JSONB pra preservar a estrutura do ChatTurn do front.

create table if not exists ai_chats (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_chats_updated_idx on ai_chats(updated_at desc);

create table if not exists ai_messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references ai_chats(id) on delete cascade,
  position   int not null,
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  unique (chat_id, position)
);

create index if not exists ai_messages_chat_idx on ai_messages(chat_id, position);

alter table ai_chats    disable row level security;
alter table ai_messages disable row level security;
