-- Log de consumo da API Gemini. Uma linha por chamada do agente "Comprador"
-- (que internamente pode fazer várias requests à API durante o loop de
-- function calling — esse log soma o consumo total da rodada).

create table if not exists ai_usage (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  model            text not null,
  prompt_tokens    int not null default 0,
  response_tokens  int not null default 0,
  total_tokens     int not null default 0,
  tool_calls_count int not null default 0,
  duration_ms      int,
  user_message     text
);

create index if not exists ai_usage_created_at_idx on ai_usage(created_at desc);

alter table ai_usage disable row level security;
