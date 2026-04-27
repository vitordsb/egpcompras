-- Permite invites anônimos (supplier_id null) — caso fornecedor responda
-- via link público sem cadastro prévio.
alter table quotation_invites alter column supplier_id drop not null;

-- Campos de identificação que o fornecedor preenche ao responder.
-- Quando invite nominal, esses campos podem ser pré-preenchidos com dados do
-- supplier mas o fornecedor confirma/atualiza (informação chega "fresca").
alter table quotation_responses
  add column if not exists supplier_name    text,
  add column if not exists supplier_cnpj    text,
  add column if not exists supplier_email   text,
  add column if not exists seller_name      text,
  add column if not exists payment_response text;

-- Recria as views que dependem das tabelas (caso outros campos sejam usados em
-- versões futuras). Não há mudança nas views existentes hoje, mas mantemos o
-- comentário pra rastreabilidade.
