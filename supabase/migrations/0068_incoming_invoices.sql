-- Pipeline de NF-es destinadas ao CNPJ da EGP (recebidas).
--
-- Arquitetura:
--   1. Edge Function consulta SEFAZ webservice NFeDistribuicaoDFe a cada 1h
--   2. SEFAZ devolve lote de até 50 documentos (resNFe, procNFe, eventos)
--   3. Cada documento é parseado e inserido em incoming_invoices
--   4. Cron auto-manifesta "Ciência da Operação" (210210) em notas resNFe
--   5. Após Ciência aceita, re-consulta SEFAZ pra pegar procNFe completo
--   6. Classifica por CFOP (compra → estoque, devolução → RMA)
--   7. Auto-processa: register_stock_entry ou create_rma
--
-- Estados (status):
--   resumo_apenas      → só resNFe, sem itens (ainda não foi manifestada)
--   ciencia_pendente   → vamos enviar Ciência no próximo ciclo
--   ciencia_enviada    → Ciência despachada, aguardando aceitação
--   completa           → procNFe baixada, com itens, pronta pra classificar
--   processada         → virou stock_movement OU rma
--   ignorada           → user marcou pra não processar
--   erro               → algo deu errado, precisa de intervenção manual

create table if not exists incoming_invoices (
  id uuid primary key default gen_random_uuid(),

  -- Identificação fiscal
  chave_acesso text not null unique,  -- 44 dígitos
  numero_nfe text,
  serie text,
  modelo text,  -- 55 = NF-e, 65 = NFC-e

  -- Emitente (quem MANDOU pra EGP)
  emitente_cnpj text,
  emitente_nome text,
  emitente_ie text,
  emitente_uf text,

  -- Destinatário (EGP normalmente, mas guardamos pra debug)
  destinatario_cnpj text,
  destinatario_nome text,

  -- Operação
  natureza_operacao text,
  cfop_principal text,        -- CFOP do primeiro item ou predominante (auto)
  finalidade_emissao text,    -- 1=Normal | 2=Complementar | 3=Ajuste | 4=Devolução

  -- Valores (totais da nota)
  valor_total numeric(14, 2),
  valor_produtos numeric(14, 2),
  valor_frete numeric(14, 2),
  valor_seguro numeric(14, 2),
  valor_desconto numeric(14, 2),
  valor_outras_despesas numeric(14, 2),
  valor_ipi numeric(14, 2),
  valor_icms numeric(14, 2),
  valor_st numeric(14, 2),

  -- Datas
  data_emissao timestamptz,
  data_saida_entrada timestamptz,
  data_recebimento timestamptz not null default now(),  -- quando entrou no nosso sistema

  -- Classificação automática (interna)
  tipo_classificado text not null default 'pendente'
    check (tipo_classificado in (
      'compra',
      'rma_devolucao',
      'remessa_conserto',
      'remessa_industria',
      'retorno_industria',
      'transferencia',
      'outro',
      'pendente'
    )),

  -- Status do fluxo
  status text not null default 'resumo_apenas'
    check (status in (
      'resumo_apenas',
      'ciencia_pendente',
      'ciencia_enviada',
      'completa',
      'processada',
      'ignorada',
      'erro'
    )),

  -- SEFAZ tracking
  nsu text,                   -- NSU do documento na consulta
  schema_version text,        -- 1.00, 4.00, etc

  -- Arquivos (lazy: gerados quando precisamos)
  xml_resumo_content text,    -- resNFe cru (sempre que veio via SEFAZ)
  xml_completo_content text,  -- procNFe cru (depois da Ciência)
  xml_url text,               -- backup no Storage
  pdf_url text,               -- DANFE renderizado on-demand

  -- Vínculos com o sistema (preenchidos quando processada)
  shipment_id uuid references shipments(id) on delete set null,
  rma_id uuid references rmas(id) on delete set null,
  stock_movement_ids uuid[] default '{}',  -- pode gerar várias entradas

  -- Manifestação automática (Ciência da Operação - 210210)
  ciencia_enviada_at timestamptz,
  ciencia_aceita_at timestamptz,
  ciencia_status_code text,   -- 135 OK, etc
  ciencia_motivo text,
  ciencia_protocolo text,

  -- Confirmação (210200) — manual após dar entrada estoque
  confirmacao_enviada_at timestamptz,
  confirmacao_aceita_at timestamptz,
  confirmacao_protocolo text,

  -- Auditoria
  source text not null default 'sefaz'
    check (source in ('sefaz', 'email', 'manual', 'arquivei')),
  processed_at timestamptz,
  processed_by text,
  error_message text,         -- preenchido quando status='erro'
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incoming_invoices_emitente_idx on incoming_invoices(emitente_cnpj);
create index if not exists incoming_invoices_status_idx on incoming_invoices(status);
create index if not exists incoming_invoices_tipo_idx on incoming_invoices(tipo_classificado);
create index if not exists incoming_invoices_data_emissao_idx on incoming_invoices(data_emissao desc);
create index if not exists incoming_invoices_data_recebimento_idx on incoming_invoices(data_recebimento desc);
create index if not exists incoming_invoices_shipment_idx on incoming_invoices(shipment_id) where shipment_id is not null;
create index if not exists incoming_invoices_rma_idx on incoming_invoices(rma_id) where rma_id is not null;

alter table incoming_invoices disable row level security;

-- ── Itens da NF-e (preenchidos quando temos o XML completo) ──────────────
create table if not exists incoming_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references incoming_invoices(id) on delete cascade,

  numero_item int not null,         -- nItem na NF-e
  codigo_produto text,              -- cProd
  ean text,                         -- cEAN
  descricao text,                   -- xProd
  ncm text,
  cfop text,
  unidade_comercial text,           -- uCom
  quantidade numeric(15, 4),
  valor_unitario numeric(15, 10),
  valor_total numeric(15, 2),
  valor_desconto numeric(15, 2),

  -- Match opcional com componente/produto do nosso catálogo
  -- (preenchido pelo classificador quando consegue identificar)
  matched_component_id uuid references components(id) on delete set null,
  matched_product_id uuid references products(id) on delete set null,

  created_at timestamptz not null default now()
);

create index if not exists incoming_invoice_items_invoice_idx on incoming_invoice_items(invoice_id);
create index if not exists incoming_invoice_items_codigo_idx on incoming_invoice_items(codigo_produto);
create index if not exists incoming_invoice_items_component_idx on incoming_invoice_items(matched_component_id) where matched_component_id is not null;

alter table incoming_invoice_items disable row level security;

-- ── Estado do NSU por CNPJ destinatário ─────────────────────────────────
-- SEFAZ controla entrega por NSU sequencial. Guardamos o último NSU
-- consultado pra próxima chamada saber de onde retomar.
create table if not exists sefaz_distribution_state (
  cnpj text primary key,
  ultimo_nsu text not null default '000000000000000',  -- 15 dígitos
  ultimo_max_nsu text not null default '000000000000000',  -- maior NSU disponível na última consulta
  ambiente text not null default 'homologacao'
    check (ambiente in ('producao', 'homologacao')),

  last_consulta_at timestamptz,
  last_status_code text,    -- 137 = nenhum documento, 138 = documentos localizados
  last_status_motivo text,
  consultas_total int not null default 0,
  documentos_recebidos_total int not null default 0,

  -- Backoff em caso de erro/rate limit
  next_consulta_after timestamptz,

  updated_at timestamptz not null default now()
);

alter table sefaz_distribution_state disable row level security;

-- ── Histórico de eventos enviados (Manifestação) ────────────────────────
create table if not exists incoming_invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references incoming_invoices(id) on delete cascade,
  chave_acesso text not null,

  tipo_evento text not null
    check (tipo_evento in (
      'ciencia',           -- 210210 - Ciência da Operação
      'confirmacao',       -- 210200 - Confirmação da Operação
      'desconhecimento',   -- 210220 - Desconhecimento da Operação
      'nao_realizada'      -- 210240 - Operação Não Realizada
    )),
  sequencia int not null default 1,

  enviado_at timestamptz not null default now(),
  enviado_por text,                 -- 'cron-auto' | email do user

  response_status_code text,
  response_motivo text,
  response_protocolo text,
  response_xml text,                -- XML cru da resposta SEFAZ pra debug
  response_data_evento timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists incoming_invoice_events_invoice_idx on incoming_invoice_events(invoice_id);
create index if not exists incoming_invoice_events_chave_idx on incoming_invoice_events(chave_acesso);

alter table incoming_invoice_events disable row level security;

-- ── Trigger pra atualizar updated_at em incoming_invoices ──────────────
create or replace function update_incoming_invoices_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists incoming_invoices_updated_at on incoming_invoices;
create trigger incoming_invoices_updated_at
  before update on incoming_invoices
  for each row
  execute function update_incoming_invoices_updated_at();

-- rollback:
-- drop table if exists incoming_invoice_events;
-- drop table if exists incoming_invoice_items;
-- drop table if exists incoming_invoices;
-- drop table if exists sefaz_distribution_state;
-- drop function if exists update_incoming_invoices_updated_at;
