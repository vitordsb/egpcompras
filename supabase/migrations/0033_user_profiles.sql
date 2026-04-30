-- Perfis de usuário com cargo (role) para controle de acesso por função
create table if not exists user_profiles (
  email        text primary key,
  role         text not null default 'vendas'
               check (role in ('admin','vendas','compras','expedicao','financeiro','producao')),
  display_name text,
  created_at   timestamptz default now()
);

-- Admins padrão (imutáveis via regra de negócio)
insert into user_profiles (email, role, display_name) values
  ('vitor@grupoegp.com.br', 'admin', 'Vitor'),
  ('joane@grupoegp.com.br', 'admin', 'Joane')
on conflict (email) do nothing;

-- Sem RLS — acesso apenas via service role / anon autenticado
alter table user_profiles disable row level security;
