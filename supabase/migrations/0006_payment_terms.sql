-- Pretensão de pagamento que o admin define ao criar a cotação.
-- Texto livre (ex: "à vista com 5% desc", "30/60/90", "50% entrada + 50% em 30 dias").
alter table quotations
  add column if not exists payment_terms text;
