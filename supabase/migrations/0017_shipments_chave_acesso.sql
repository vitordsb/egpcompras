-- Adiciona chave de acesso da NF-e ao pedido (44 dígitos, identifica o doc fiscal no SEFAZ).
alter table shipments
  add column if not exists chave_acesso text;

create unique index if not exists shipments_chave_acesso_uniq
  on shipments(chave_acesso) where chave_acesso is not null;
