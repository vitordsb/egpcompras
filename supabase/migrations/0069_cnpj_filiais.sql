-- Catálogo de CNPJs (empresas/filiais) que recebem NF-es no sistema.
-- Permite múltiplos CNPJs (matriz + filiais) cada um com seu próprio
-- certificado A1 e estado de consulta SEFAZ independente.

create table if not exists cnpj_filiais (
  cnpj text primary key
    check (length(cnpj) = 14 and cnpj ~ '^[0-9]+$'),

  -- Label legível pra UI (ex: "Filial 1 - final 51")
  tag text not null,

  -- Nome curto pra exibir em listas compactas (ex: "Filial 1")
  nome_curto text,

  -- Razão social oficial (preenchida via SEFAZ na primeira consulta)
  razao_social text,

  ativo boolean not null default true,

  -- Nome do Supabase Secret que guarda o certificado A1 desse CNPJ.
  -- Edge Function lê via Deno.env.get(cert_secret_name).
  -- Cada empresa tem seu PEM + key + senha em secrets separados:
  --   NFE_CERT_40116124_PEM
  --   NFE_CERT_40116124_KEY
  --   NFE_CERT_40116124_PASSWORD
  cert_secret_prefix text,

  ambiente text not null default 'homologacao'
    check (ambiente in ('producao', 'homologacao')),

  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table cnpj_filiais disable row level security;

-- Popula com os 2 CNPJs da EGP
insert into cnpj_filiais (cnpj, tag, nome_curto, cert_secret_prefix, ambiente)
values
  ('40116124000151', 'Filial 1 - final 51', 'Filial 1', 'NFE_CERT_40116124', 'homologacao'),
  ('43154404000142', 'Filial 2 - final 42', 'Filial 2', 'NFE_CERT_43154404', 'homologacao')
on conflict (cnpj) do update
  set tag = excluded.tag,
      nome_curto = excluded.nome_curto,
      cert_secret_prefix = excluded.cert_secret_prefix,
      updated_at = now();

-- ── Adiciona tag de filial na incoming_invoices ─────────────────────────
-- Preenchido automaticamente quando a Edge Function insere a nota,
-- baseado no destinatario_cnpj.
alter table incoming_invoices
  add column if not exists destinatario_filial_tag text;

create index if not exists incoming_invoices_filial_idx
  on incoming_invoices(destinatario_filial_tag);

-- ── Bootstrap do state SEFAZ pra cada CNPJ ──────────────────────────────
-- Inicia com NSU=0 (puxa tudo dos 90 dias se rodar a primeira vez)
-- ou pode setar manualmente pro NSU atual antes de ligar o cron.
insert into sefaz_distribution_state (cnpj, ambiente)
values
  ('40116124000151', 'homologacao'),
  ('43154404000142', 'homologacao')
on conflict (cnpj) do nothing;

-- rollback:
-- alter table incoming_invoices drop column if exists destinatario_filial_tag;
-- drop table if exists cnpj_filiais;
