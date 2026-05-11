-- Galeria de imagens de marketing salvas pelo usuário (quando gostar do que
-- a IA gerou). Permite reusar/reenviar sem precisar regenerar do zero.

create table if not exists marketing_assets (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  title text not null,
  -- 'maes', 'pais', 'natal', 'ano_novo', 'namorados', 'crianca', 'professor',
  -- 'pascoa', 'independencia', 'consumidor', 'corpus_christi', 'finados',
  -- 'consciencia_negra', 'black_friday', 'cyber_monday', 'aniversario_empresa',
  -- 'institucional', 'promocao', 'lancamento', 'liquidacao', 'outro'
  holiday text,
  tags text[] not null default '{}',
  notes text,
  -- Prompt usado pra gerar (útil pra refazer variações)
  prompt_used text,
  -- Modelo usado (fal-flux-schnell, fal-flux-dev, etc.)
  model_used text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists marketing_assets_holiday_idx on marketing_assets(holiday);
create index if not exists marketing_assets_tags_idx on marketing_assets using gin(tags);
create index if not exists marketing_assets_created_at_idx on marketing_assets(created_at desc);

alter table marketing_assets disable row level security;
