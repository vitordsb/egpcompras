-- Templates de marketing salvos pelos usuários.
-- Armazena a imagem pré-renderizada (URL pública) + dados do formulário
-- para que a IA possa enviar pelo nome sem precisar renderizar novamente.
create table if not exists marketing_templates (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null unique,       -- nome amigável (ex: "Promoção Controle Maio")
  template_id      text        not null,              -- 'promocao' | 'feriado' | 'lancamento'
  form_data        jsonb       not null default '{}'::jsonb, -- campos do formulário
  product_filename text,                              -- foto do produto (sem extensão)
  image_url        text        not null,              -- URL permanente no Supabase Storage
  caption          text,                              -- legenda padrão do WhatsApp
  created_at       timestamptz default now(),
  created_by       text                               -- email/label do usuário
);

alter table marketing_templates disable row level security;

create index if not exists marketing_templates_name_lower_idx
  on marketing_templates (lower(name));
