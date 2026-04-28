-- Controle de saída de pedidos (gap do Conta Azul).
-- No ERP atual, "emitir NF" = saída automática de estoque, mas na realidade
-- da EGP nem sempre o material sai junto. Essa estrutura paralela permite
-- registrar status, datas e observações livres (faltas, devoluções, etc).

create table if not exists shipments (
  id            uuid primary key default gen_random_uuid(),
  numero_nfe    text,
  client_name   text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'shipped', 'returned', 'cancelled')),
  data_prevista date,
  data_saida    timestamptz,
  data_retorno  timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shipments_status_idx on shipments(status);
create index if not exists shipments_client_idx on shipments(lower(client_name));
create index if not exists shipments_nfe_idx on shipments(numero_nfe) where numero_nfe is not null;

create table if not exists shipment_items (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  product_id  uuid not null references products(id) on delete restrict,
  quantity    numeric(14, 4) not null check (quantity > 0),
  unique (shipment_id, product_id)
);

create index if not exists shipment_items_shipment_idx on shipment_items(shipment_id);

create table if not exists shipment_observations (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists shipment_obs_shipment_idx on shipment_observations(shipment_id);
create index if not exists shipment_obs_created_idx on shipment_observations(created_at desc);

alter table shipments              disable row level security;
alter table shipment_items         disable row level security;
alter table shipment_observations  disable row level security;
