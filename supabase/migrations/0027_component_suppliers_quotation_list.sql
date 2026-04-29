-- Fornecedores por componente + cotação de lista livre

-- Campos extras em suppliers (opcionais — podem ser preenchidos depois)
alter table suppliers
  add column if not exists cnpj    text,
  add column if not exists address text;

-- Email agora é opcional (alguns fornecedores não têm e-mail cadastrado ainda)
alter table suppliers
  alter column email drop not null;

-- Vínculo componente → fornecedor(es)
-- Um componente pode ter vários fornecedores; apenas um pode ser "preferido"
create table if not exists component_suppliers (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references components(id) on delete cascade,
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  is_preferred boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (component_id, supplier_id)
);

create index if not exists component_suppliers_comp_idx on component_suppliers(component_id);
create index if not exists component_suppliers_supp_idx on component_suppliers(supplier_id);

-- Cotação de lista livre (sem produto): torna product_id nullable
alter table quotations
  alter column product_id drop not null;

-- Tipo de contexto da cotação
alter table quotations
  add column if not exists context_type text not null default 'bom'
    check (context_type in ('bom', 'purchase_list'));

-- quotation_items: torna component_id nullable + nome livre para itens sem catálogo
alter table quotation_items
  alter column component_id drop not null;

alter table quotation_items
  add column if not exists component_name_free text;

-- Remove unique constraint que impede NULL component_id (recria sem restrição de null)
-- A constraint antiga era unique(quotation_id, component_id) — não funciona bem com nulls
-- Não há como dropar sem saber o nome gerado automaticamente; usamos um índice condicional
create unique index if not exists quotation_items_quotation_component_idx
  on quotation_items(quotation_id, component_id)
  where component_id is not null;

alter table component_suppliers disable row level security;
