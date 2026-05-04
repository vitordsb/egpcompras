-- Handoff: status da sessão + dados coletados pelo bot
alter table whatsapp_sessions
  add column if not exists status               text        not null default 'active',
  add column if not exists assigned_agent_phone text,
  add column if not exists handoff_requested_at timestamptz,
  add column if not exists collected_lead_data  jsonb;

-- status: 'active' | 'handoff' | 'closed'
create index if not exists whatsapp_sessions_status_idx
  on whatsapp_sessions (status)
  where status = 'handoff';
