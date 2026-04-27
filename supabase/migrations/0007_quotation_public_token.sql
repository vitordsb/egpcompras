-- Token público da cotação — usado quando o admin não cadastra fornecedores
-- previamente e quer apenas distribuir 1 link aberto. Fornecedores anônimos
-- abrem esse link e se identificam ao responder (nome do vendedor, CNPJ, etc).
alter table quotations
  add column if not exists public_token text
  default encode(gen_random_bytes(24), 'hex');

-- Backfill pra cotações que já existem antes da coluna ter sido criada.
update quotations set public_token = encode(gen_random_bytes(24), 'hex')
where public_token is null;

-- Garante unicidade
create unique index if not exists quotations_public_token_idx on quotations(public_token);

-- A partir de agora, public_token é obrigatório.
alter table quotations alter column public_token set not null;
