-- Agenda de contatos WhatsApp — associa nome/apelido ao número
create table if not exists whatsapp_contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,           -- nome completo ou apelido (ex: "Felipe Enbracon")
  phone      text not null,           -- número normalizado com DDI (ex: "5511912345678")
  notes      text,                    -- empresa, cargo, obs livre
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- índice para busca por nome (case-insensitive)
create index if not exists whatsapp_contacts_name_idx on whatsapp_contacts using gin (to_tsvector('portuguese', name));
-- índice para busca por número
create index if not exists whatsapp_contacts_phone_idx on whatsapp_contacts (phone);

-- trigger para updated_at
create or replace function update_whatsapp_contacts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger whatsapp_contacts_updated_at
  before update on whatsapp_contacts
  for each row execute function update_whatsapp_contacts_updated_at();
