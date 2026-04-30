-- Trigger: sincroniza client_contacts automaticamente ao criar shipment.
-- Mantém last_purchase_at, total_orders e total_spent sempre atualizados.

create or replace function sync_client_contact_from_shipment()
returns trigger language plpgsql as $$
declare
  v_client_id uuid;
  v_normalized_cnpj text;
begin
  v_normalized_cnpj := nullif(trim(new.client_cnpj), '');

  -- 1) Tenta achar pelo CNPJ
  if v_normalized_cnpj is not null then
    select id into v_client_id from client_contacts where cnpj = v_normalized_cnpj limit 1;
  end if;

  -- 2) Se não achou, tenta pelo nome (case-insensitive)
  if v_client_id is null then
    select id into v_client_id
    from client_contacts
    where lower(name) = lower(new.client_name)
    limit 1;
  end if;

  if v_client_id is null then
    -- 3) Não existe → cria
    insert into client_contacts (
      name, trade_name, cnpj, phone, email, address,
      first_purchase_at, last_purchase_at, total_orders, total_spent
    ) values (
      new.client_name,
      new.client_trade_name,
      v_normalized_cnpj,
      new.client_phone,
      new.client_email,
      new.client_address,
      new.created_at,
      new.created_at,
      1,
      coalesce(new.valor_total, 0)
    );
  else
    -- 4) Existe → atualiza métricas e refresca info de contato (se nova)
    update client_contacts set
      last_purchase_at  = greatest(coalesce(last_purchase_at, new.created_at), new.created_at),
      first_purchase_at = least(coalesce(first_purchase_at, new.created_at), new.created_at),
      total_orders      = total_orders + 1,
      total_spent       = total_spent + coalesce(new.valor_total, 0),
      trade_name        = coalesce(new.client_trade_name, trade_name),
      phone             = coalesce(new.client_phone,      phone),
      email             = coalesce(new.client_email,      email),
      address           = coalesce(new.client_address,    address),
      cnpj              = coalesce(cnpj, v_normalized_cnpj)
    where id = v_client_id;
  end if;

  return new;
end;
$$;

drop trigger if exists shipment_sync_client_contact_tg on shipments;
create trigger shipment_sync_client_contact_tg
  after insert on shipments
  for each row execute function sync_client_contact_from_shipment();


-- Função auxiliar: recalcula métricas de um cliente do zero (útil pra correção manual)
create or replace function refresh_client_metrics(p_client_id uuid)
returns void language plpgsql as $$
declare
  v_cnpj text;
  v_name text;
begin
  select cnpj, name into v_cnpj, v_name from client_contacts where id = p_client_id;

  update client_contacts c set
    total_orders      = sub.cnt,
    total_spent       = coalesce(sub.total, 0),
    first_purchase_at = sub.first_at,
    last_purchase_at  = sub.last_at
  from (
    select
      count(*)::int as cnt,
      sum(valor_total) as total,
      min(created_at) as first_at,
      max(created_at) as last_at
    from shipments
    where (v_cnpj is not null and client_cnpj = v_cnpj)
       or (v_cnpj is null and lower(client_name) = lower(v_name))
  ) sub
  where c.id = p_client_id;
end;
$$;
