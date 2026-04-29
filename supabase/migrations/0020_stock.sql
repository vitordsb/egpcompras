-- Módulo de controle de estoque.
-- stock_items    = saldo atual por item (item_code é a chave natural)
-- stock_movements = histórico de cada movimentação (entrada / saída / ajuste)

create table if not exists stock_items (
  id            uuid primary key default gen_random_uuid(),
  item_code     text not null unique,
  item_name     text not null,
  quantity      numeric(12,3) not null default 0,
  unit          text not null default 'un',
  min_quantity  numeric(12,3) not null default 0, -- ponto mínimo de reposição
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists stock_items_code_idx on stock_items(lower(item_code));

create table if not exists stock_movements (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid references stock_items(id) on delete set null,
  item_code      text not null,
  item_name      text not null,
  quantity       numeric(12,3) not null,   -- positivo = entrada, negativo = saída
  type           text not null check (type in ('entrada','saida','ajuste')),
  shipment_id    uuid references shipments(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists stock_movements_item_idx     on stock_movements(stock_item_id);
create index if not exists stock_movements_shipment_idx on stock_movements(shipment_id) where shipment_id is not null;

alter table stock_items     disable row level security;
alter table stock_movements disable row level security;
