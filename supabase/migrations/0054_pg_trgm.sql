-- Habilita similarity-based search (trigram) para resolver matches imperfeitos
-- de nomes — útil principalmente quando o input vem de transcrição de voz
-- (ex: "Natana" deve casar com "Nathanna").

create extension if not exists pg_trgm;

-- Índices GIN para acelerar similarity()
create index if not exists whatsapp_contacts_name_trgm_idx on whatsapp_contacts using gin (name gin_trgm_ops);
create index if not exists client_contacts_name_trgm_idx on client_contacts using gin (name gin_trgm_ops);
create index if not exists suppliers_name_trgm_idx on suppliers using gin (name gin_trgm_ops);
create index if not exists products_name_trgm_idx on products using gin (name gin_trgm_ops);
create index if not exists components_name_trgm_idx on components using gin (name gin_trgm_ops);
create index if not exists financeiras_nome_trgm_idx on financeiras using gin (nome gin_trgm_ops);
create index if not exists marketing_templates_name_trgm_idx on marketing_templates using gin (name gin_trgm_ops);

-- ─── RPCs de fuzzy search ─────────────────────────────────────────────────
-- Padrão: retorna id, name, similarity. Threshold padrão 0.25 (permissivo).
-- Usadas como FALLBACK quando o ilike padrão não encontrou nada.

create or replace function search_whatsapp_contacts_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, name text, phone text, sim float)
language sql stable as $$
  select id, name, phone, similarity(name, q) as sim
  from whatsapp_contacts
  where similarity(name, q) > threshold
  order by sim desc
  limit 10;
$$;

create or replace function search_client_contacts_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, name text, whatsapp_phone text, cnpj text, sim float)
language sql stable as $$
  select id, name, whatsapp_phone, cnpj, similarity(name, q) as sim
  from client_contacts
  where similarity(name, q) > threshold
  order by sim desc
  limit 10;
$$;

create or replace function search_suppliers_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, name text, email text, whatsapp_phone text, sim float)
language sql stable as $$
  select id, name, email, whatsapp_phone, similarity(name, q) as sim
  from suppliers
  where similarity(name, q) > threshold
  order by sim desc
  limit 10;
$$;

create or replace function search_products_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, name text, sku text, sim float)
language sql stable as $$
  select id, name, sku, similarity(name, q) as sim
  from products
  where similarity(name, q) > threshold
  order by sim desc
  limit 10;
$$;

create or replace function search_components_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, name text, sim float)
language sql stable as $$
  select id, name, similarity(name, q) as sim
  from components
  where similarity(name, q) > threshold
  order by sim desc
  limit 10;
$$;

create or replace function search_financeiras_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, nome text, sim float)
language sql stable as $$
  select id, nome, similarity(nome, q) as sim
  from financeiras
  where similarity(nome, q) > threshold
  order by sim desc
  limit 10;
$$;

create or replace function search_marketing_templates_fuzzy(q text, threshold float default 0.25)
returns table (id uuid, name text, status text, sim float)
language sql stable as $$
  select id, name, status, similarity(name, q) as sim
  from marketing_templates
  where similarity(name, q) > threshold
  order by sim desc
  limit 10;
$$;
