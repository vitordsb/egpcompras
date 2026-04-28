-- Módulo Financeira: rastreia qual pedido está em qual financeira (duplicata mercantil).
-- financeiras = cadastro das instituições (igual ao padrão de fornecedores)
-- titulos     = duplicatas, com FK opcional ao pedido (shipment)

create table if not exists financeiras (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  contato     text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists financeiras_nome_uniq
  on financeiras(lower(nome));

create table if not exists titulos (
  id             uuid primary key default gen_random_uuid(),
  financeira_id  uuid not null references financeiras(id) on delete restrict,
  shipment_id    uuid references shipments(id) on delete set null,
  numero_titulo  text,
  numero_nfe     text,
  numero_venda   text,
  client_name    text not null,
  valor          numeric(14,2) not null check (valor > 0),
  vencimento     date,
  status         text not null default 'aberto'
                   check (status in ('aberto','pago','devolvido','protestado')),
  data_entrada   date not null default current_date,
  data_pagamento date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists titulos_financeira_idx on titulos(financeira_id);
create index if not exists titulos_status_idx     on titulos(status);
create index if not exists titulos_vencimento_idx on titulos(vencimento) where vencimento is not null;
create index if not exists titulos_shipment_idx   on titulos(shipment_id) where shipment_id is not null;
create index if not exists titulos_client_idx     on titulos(lower(client_name));

alter table financeiras disable row level security;
alter table titulos     disable row level security;
