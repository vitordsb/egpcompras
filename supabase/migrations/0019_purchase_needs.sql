-- Módulo "Falta Comprar": itens faltantes para dar saída nos pedidos.
-- purchase_needs  = cada item que precisa ser comprado, vinculado ao pedido.
-- purchase_need_notes = histórico de anotações por item (usado pela IA e pelos compradores).

create table if not exists purchase_needs (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid references shipments(id) on delete cascade,
  item_name    text not null,
  item_code    text,
  quantity     numeric(10,3),
  unit         text,                          -- "un", "m", "kg", etc.
  status       text not null default 'pendente'
                 check (status in ('pendente','pedido','chegou','cancelado')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists purchase_needs_shipment_idx on purchase_needs(shipment_id);
create index if not exists purchase_needs_status_idx   on purchase_needs(status);

create table if not exists purchase_need_notes (
  id        uuid primary key default gen_random_uuid(),
  need_id   uuid not null references purchase_needs(id) on delete cascade,
  content   text not null,
  author    text,          -- label de quem anotou (ex: "vitinho123@grupoegp.local")
  created_at timestamptz not null default now()
);

create index if not exists purchase_need_notes_need_idx on purchase_need_notes(need_id);

alter table purchase_needs      disable row level security;
alter table purchase_need_notes disable row level security;
