-- Tarefas agendadas: a IA executa automaticamente no horário configurado.
-- O campo schedule armazena horário no formato "HH:MM" (horário de Brasília).
-- days_of_week: array de 0-6 (0=dom, 1=seg … 6=sáb). NULL = todo dia.

create table if not exists scheduled_tasks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  instruction  text not null,
  schedule_time time not null,
  days_of_week  int[] default null,
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  last_result  text,
  last_status  text check (last_status in ('ok','error')) default null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists scheduled_task_runs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references scheduled_tasks(id) on delete cascade,
  started_at  timestamptz not null default now(),
  completed_at timestamptz,
  result      text,
  status      text not null default 'running'
                check (status in ('running','ok','error'))
);

create index if not exists sched_tasks_enabled_idx on scheduled_tasks(enabled);
create index if not exists sched_runs_task_idx on scheduled_task_runs(task_id);
create index if not exists sched_runs_started_idx on scheduled_task_runs(started_at desc);

alter table scheduled_tasks      disable row level security;
alter table scheduled_task_runs  disable row level security;
