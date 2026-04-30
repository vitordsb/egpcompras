-- Estrutura de campanhas de marketing (templates WhatsApp + segmentação + cron)
create table if not exists marketing_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                 -- nome interno da campanha
  description     text,
  template_name   text not null,                 -- nome do template aprovado na Meta (ex: 'cliente_inativo')
  template_lang   text not null default 'pt_BR',
  -- Mapeia variáveis {{1}}, {{2}}... do template:
  -- ex: { "1": "{{name}}", "2": "{{days_inactive}}", "3": "https://grupoegp.com.br/catalogo" }
  -- Variáveis suportadas dinamicamente: {{name}}, {{trade_name}}, {{days_inactive}}, {{first_name}}
  template_params jsonb not null default '{}'::jsonb,

  -- Filtro de segmento (mesmos do list_client_contacts)
  segment_filter  text not null default 'opt_in_promo'
                  check (segment_filter in ('all','active','inactive','no_whatsapp','opt_in_promo','opt_in_catalog','tag')),
  segment_tag     text,                          -- usado quando segment_filter='tag'

  -- Agendamento (cron expression em UTC ou null pra envio manual)
  schedule_cron   text,                          -- ex: '0 13 * * MON' = toda segunda 10h BRT
  next_run_at     timestamptz,                   -- próxima execução calculada

  -- Limites de envio
  max_per_run     int not null default 100,      -- segurança contra disparo em massa
  enabled         boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      text
);

create index if not exists marketing_campaigns_enabled_idx on marketing_campaigns (enabled, next_run_at);

create trigger marketing_campaigns_updated_at_tg
  before update on marketing_campaigns
  for each row execute function update_client_contacts_updated_at();

alter table marketing_campaigns disable row level security;


-- Log de cada envio individual
create table if not exists marketing_sends (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references marketing_campaigns(id) on delete cascade,
  client_id       uuid references client_contacts(id) on delete set null,
  whatsapp_phone  text not null,                 -- snapshot do número no momento do envio
  status          text not null default 'pending'
                  check (status in ('pending','sent','delivered','read','failed','opted_out')),
  message_id      text,                          -- wamid retornado pela Meta
  error           text,
  sent_at         timestamptz,
  responded_at    timestamptz,                   -- quando o cliente respondeu (gera engajamento)
  created_at      timestamptz not null default now()
);

create index if not exists marketing_sends_campaign_idx on marketing_sends (campaign_id, created_at desc);
create index if not exists marketing_sends_client_idx on marketing_sends (client_id, created_at desc);
create index if not exists marketing_sends_status_idx on marketing_sends (status);

alter table marketing_sends disable row level security;
