-- Memórias persistentes do agente Comprador.
-- Cada linha é um "fato aprendido" injetado no system prompt de toda
-- conversa, em todos os providers (Gemini, Ollama, ...).
-- Ideias: regras de negócio, atalhos, preferências, decisões da empresa.

create table if not exists agent_memories (
  id         uuid primary key default gen_random_uuid(),
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_memories_created_idx on agent_memories(created_at desc);

alter table agent_memories disable row level security;
