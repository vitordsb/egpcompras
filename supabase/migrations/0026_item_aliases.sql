-- Aliases de nomes alternativos para itens de estoque.
-- Ex: "Placa de advertencia - cerca eletrica" → "Placa de advertencia"

create table if not exists item_aliases (
  id             uuid primary key default gen_random_uuid(),
  stock_item_id  uuid not null references stock_items(id) on delete cascade,
  alias          text not null,
  created_at     timestamptz not null default now(),
  unique (stock_item_id, alias)
);

create index if not exists item_aliases_alias_idx on item_aliases using gin(to_tsvector('portuguese', alias));
create index if not exists item_aliases_item_idx  on item_aliases(stock_item_id);

alter table item_aliases disable row level security;
