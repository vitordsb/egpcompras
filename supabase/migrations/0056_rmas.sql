-- Módulo RMA (Return Merchandise Authorization).
-- Workflow paralelo aos pedidos: cliente devolve produto pra conserto/troca/refund.
-- Distinto de shipments (saída de venda) — tem campos específicos de RMA.

-- Sequência pra numeração visual (RMA #001, #002, ...)
create sequence if not exists rmas_numero_seq;

create table if not exists rmas (
  id uuid primary key default gen_random_uuid(),
  numero integer not null default nextval('rmas_numero_seq') unique,

  -- Cliente que devolveu
  client_name        text not null,
  client_trade_name  text,
  client_cnpj        text,
  client_phone       text,
  client_email       text,

  -- Motivo da devolução
  motivo text not null default 'defeito'
    check (motivo in ('defeito','desistencia','garantia','outro')),

  -- Status do fluxo (espelha as colunas do kanban)
  status text not null default 'recebido'
    check (status in ('recebido','analise','conserto','pronto','devolvido','cancelado')),

  -- Análise técnica
  diagnostico text,                          -- preenchido após inspeção
  solucao text                               -- ação aplicada (troca/reparo/refund/descartado)
    check (solucao in ('pendente','troca','reparo','refund','descartado','outro'))
    default 'pendente',

  -- Datas-chave
  data_recebido date default current_date,   -- quando o RMA chegou na EGP
  data_devolvido date,                       -- quando foi enviado de volta ao cliente

  -- Vínculo opcional com pedido de venda original (rastreabilidade)
  shipment_origem_id uuid references shipments(id) on delete set null,
  numero_venda_origem text,                  -- backup textual pra quando o pedido não está no sistema

  notes text,                                -- texto livre interno
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rma_items (
  id uuid primary key default gen_random_uuid(),
  rma_id uuid not null references rmas(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  item_name text,                            -- nome livre quando não bate com produto
  item_code text,
  serial_number text,                        -- nº de série (se houver)
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  notes text,                                -- defeito específico desse item
  created_at timestamptz not null default now()
);

create table if not exists rma_observations (
  id uuid primary key default gen_random_uuid(),
  rma_id uuid not null references rmas(id) on delete cascade,
  content text not null,
  author text,                               -- email/label de quem anotou
  created_at timestamptz not null default now()
);

create index if not exists rmas_status_idx       on rmas(status);
create index if not exists rmas_client_name_idx  on rmas(lower(client_name));
create index if not exists rmas_data_recebido_idx on rmas(data_recebido);
create index if not exists rma_items_rma_idx    on rma_items(rma_id);
create index if not exists rma_observations_rma_idx on rma_observations(rma_id);
create index if not exists rmas_name_trgm_idx   on rmas using gin (client_name gin_trgm_ops);

alter table rmas             disable row level security;
alter table rma_items        disable row level security;
alter table rma_observations disable row level security;
