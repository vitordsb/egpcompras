-- Controla se o bot do WhatsApp pode mostrar o preço de venda ao cliente
alter table products
  add column if not exists show_price boolean not null default false;
