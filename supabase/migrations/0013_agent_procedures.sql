-- Procedures (playbooks/macros) que o agente pode aprender e executar.
-- Diferente de memories (fatos passivos), procedures são receitas ativas:
-- "pra fazer X, siga estes passos". Os steps são texto livre que o agente
-- interpreta e mapeia pras tools existentes — não é código novo.

create table if not exists agent_procedures (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,
  description text,
  steps       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists agent_procedures_name_idx on agent_procedures(name);

alter table agent_procedures disable row level security;
