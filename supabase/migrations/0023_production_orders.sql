-- Módulo de Produção: romaneios enviados à montadora externa.
-- production_orders           = ordem de produção (cabeçalho)
-- production_order_components = componentes enviados por ordem, com controle de retorno
-- production_order_notes      = observações / histórico de anotações

-- Saldo de componentes em poder da montadora (complementa stock_items)
alter table stock_items
  add column if not exists quantity_at_assembler numeric(12,3) not null default 0;

-- ── Ordens de produção ────────────────────────────────────────────────────────

create table if not exists production_orders (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid references products(id) on delete set null,
  product_name      text not null,
  quantity_ordered  integer not null check (quantity_ordered > 0),
  quantity_returned integer not null default 0,   -- unidades montadas devolvidas
  status            text not null default 'enviado'
                      check (status in ('rascunho','enviado','em_montagem','concluido','cancelado')),
  assembler_name    text,                          -- nome da montadora
  sent_at           date,                          -- data de envio
  returned_at       date,                          -- data de devolução
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists production_orders_status_idx  on production_orders(status);
create index if not exists production_orders_product_idx on production_orders(product_id);

-- ── Componentes por ordem ─────────────────────────────────────────────────────

create table if not exists production_order_components (
  id                    uuid primary key default gen_random_uuid(),
  production_order_id   uuid not null references production_orders(id) on delete cascade,
  component_id          uuid references components(id) on delete set null,
  component_name        text not null,
  component_sku         text,
  quantity_sent         numeric(12,3) not null,       -- enviado à montadora
  quantity_returned     numeric(12,3) not null default 0, -- sobra devolvida pra nós
  quantity_at_assembler numeric(12,3) not null default 0, -- ficou com a montadora
  notes                 text                            -- ex: "faltaram 50 unidades"
);

create index if not exists prod_order_components_order_idx on production_order_components(production_order_id);

-- ── Notas / observações ───────────────────────────────────────────────────────

create table if not exists production_order_notes (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  content             text not null,
  author              text,
  created_at          timestamptz not null default now()
);

create index if not exists prod_order_notes_order_idx on production_order_notes(production_order_id);

alter table production_orders           disable row level security;
alter table production_order_components disable row level security;
alter table production_order_notes      disable row level security;
