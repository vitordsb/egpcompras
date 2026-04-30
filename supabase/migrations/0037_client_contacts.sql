-- Cadastro unificado de clientes — base para marketing/CRM
create table if not exists client_contacts (
  id                uuid primary key default gen_random_uuid(),
  -- Identificação
  name              text not null,             -- razão social ou nome do contato
  trade_name        text,                       -- nome fantasia (xFant)
  cnpj              text,                       -- CNPJ (formato: 00.000.000/0000-00)
  phone             text,                       -- telefone fixo / contato geral
  whatsapp_phone    text,                       -- número WhatsApp normalizado (5511...)
  email             text,
  address           text,

  -- Métricas agregadas (atualizadas via job ou na hora do envio)
  first_purchase_at timestamptz,
  last_purchase_at  timestamptz,
  total_orders      int not null default 0,
  total_spent       numeric(14,2) not null default 0,

  -- Segmentação manual
  tags              text[] not null default '{}',
  notes             text,

  -- LGPD / opt-in marketing
  opt_in_promo      boolean not null default false,  -- aceita receber promo
  opt_in_catalog    boolean not null default false,  -- aceita receber catálogo
  opt_in_at         timestamptz,                      -- quando aceitou
  opt_out_at        timestamptz,                      -- quando recusou

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- CNPJ único quando preenchido (não bloqueia clientes sem CNPJ)
create unique index if not exists client_contacts_cnpj_uidx
  on client_contacts (cnpj) where cnpj is not null;

-- WhatsApp único quando preenchido
create unique index if not exists client_contacts_whatsapp_uidx
  on client_contacts (whatsapp_phone) where whatsapp_phone is not null;

create index if not exists client_contacts_name_idx on client_contacts (lower(name));
create index if not exists client_contacts_last_purchase_idx on client_contacts (last_purchase_at desc nulls last);
create index if not exists client_contacts_tags_idx on client_contacts using gin (tags);

alter table client_contacts disable row level security;

-- Trigger para updated_at
create or replace function update_client_contacts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists client_contacts_updated_at_tg on client_contacts;
create trigger client_contacts_updated_at_tg
  before update on client_contacts
  for each row execute function update_client_contacts_updated_at();

-- ===== Backfill a partir dos shipments existentes =====
insert into client_contacts (
  name, trade_name, cnpj, phone, email, address,
  first_purchase_at, last_purchase_at, total_orders, total_spent
)
select
  s.client_name,
  max(s.client_trade_name)         filter (where s.client_trade_name is not null),
  s.client_cnpj,
  max(s.client_phone)              filter (where s.client_phone is not null),
  max(s.client_email)              filter (where s.client_email is not null),
  max(s.client_address)            filter (where s.client_address is not null),
  min(s.created_at),
  max(s.created_at),
  count(*)::int,
  coalesce(sum(s.valor_total), 0)
from shipments s
where s.client_cnpj is not null
  and not exists (select 1 from client_contacts c where c.cnpj = s.client_cnpj)
group by s.client_name, s.client_cnpj;

-- Backfill de clientes sem CNPJ (agrupados só por nome)
insert into client_contacts (
  name, trade_name, phone, email, address,
  first_purchase_at, last_purchase_at, total_orders, total_spent
)
select
  s.client_name,
  max(s.client_trade_name)         filter (where s.client_trade_name is not null),
  max(s.client_phone)              filter (where s.client_phone is not null),
  max(s.client_email)              filter (where s.client_email is not null),
  max(s.client_address)            filter (where s.client_address is not null),
  min(s.created_at),
  max(s.created_at),
  count(*)::int,
  coalesce(sum(s.valor_total), 0)
from shipments s
where s.client_cnpj is null
  and not exists (
    select 1 from client_contacts c where lower(c.name) = lower(s.client_name)
  )
group by s.client_name;
