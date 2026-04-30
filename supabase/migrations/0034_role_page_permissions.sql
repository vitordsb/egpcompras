-- Permissões por cargo — quais seções cada cargo pode acessar (configurável pelo admin)
create table if not exists role_page_permissions (
  role     text not null,
  page_key text not null,
  primary key (role, page_key)
);

alter table role_page_permissions disable row level security;

-- Defaults: replicam o comportamento original hardcoded
insert into role_page_permissions (role, page_key) values
  -- vendas
  ('vendas',    'produtos'),
  ('vendas',    'whatsapp'),
  -- compras
  ('compras',   'cotacoes'),
  ('compras',   'componentes'),
  ('compras',   'falta_comprar'),
  ('compras',   'fornecedores'),
  -- expedicao
  ('expedicao', 'pedidos'),
  ('expedicao', 'saidas'),
  ('expedicao', 'whatsapp'),
  -- financeiro
  ('financeiro','financeira'),
  -- producao
  ('producao',  'producao'),
  ('producao',  'estoque'),
  ('producao',  'falta_comprar')
on conflict do nothing;
