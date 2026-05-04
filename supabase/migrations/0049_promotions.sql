-- Promoções ativas consumidas pelo bot
create table if not exists promotions (
  id                  uuid        primary key default gen_random_uuid(),
  title               text        not null,
  description_for_bot text        not null,
  -- texto que a IA cita literalmente, ex: "10% OFF no Controle 4 Botões até 10/05"
  product_id          uuid        references products(id) on delete set null,
  sku                 text,       -- atalho para filtro sem JOIN
  discount_type       text        not null default 'percent',
  -- 'percent' | 'fixed' | 'frete_gratis' | 'brinde'
  discount_value      numeric(10,2),
  min_quantity        integer     not null default 1,
  starts_at           timestamptz not null default now(),
  ends_at             timestamptz not null,
  active              boolean     not null default true,
  created_at          timestamptz not null default now()
);

-- Índice para a query do bot: promoções vigentes e ativas
create index if not exists promotions_active_dates_idx
  on promotions (active, starts_at, ends_at)
  where active = true;
