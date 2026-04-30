-- Adiciona nome fantasia separado da razão social no controle de saída
alter table shipments add column if not exists client_trade_name text;

-- O campo client_name continua sendo a razão social (xNome do destinatário)
-- O campo client_trade_name é o nome fantasia (xFant) — visível na tabela quando diferente
