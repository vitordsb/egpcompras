-- Clichês / marcas próprias cadastradas.
-- Cada cliente pode ter uma ou mais marcas registradas.
-- A IA cruza o "Detalhe do item" do PDF com essa lista para
-- detectar controles com marca própria automaticamente.

create table if not exists client_brands (
  id          uuid primary key default gen_random_uuid(),
  brand_name  text not null,          -- ex: "HIKTEK", "SUPRASEG", "VORTEX"
  client_name text,                   -- razão social do cliente (opcional, para referência)
  notes       text,                   -- observações: cores padrão, embalagem, etc.
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (brand_name)
);

create index if not exists client_brands_name_idx on client_brands using gin(to_tsvector('portuguese', brand_name));

-- Flag de marca própria em itens de pedido
alter table shipment_items
  add column if not exists is_private_label boolean not null default false,
  add column if not exists brand_name       text,   -- marca detectada
  add column if not exists item_color       text;   -- cor do controle (cinza, rosa, preto, etc.)

alter table client_brands disable row level security;
