-- Adiciona campos visuais/comerciais em products + bucket de imagens.

alter table products
  add column if not exists image_url       text,
  add column if not exists sale_price_brl  numeric(14,4);

-- Bucket público para fotos de produto.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Policies permissivas no bucket enquanto não há Auth.
-- Quando Auth for ativado, restringir to authenticated.
do $$
begin
  -- SELECT (leitura via API; URL pública já funciona sem policy quando bucket é public)
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='public read product-images'
  ) then
    create policy "public read product-images"
      on storage.objects for select
      to public
      using (bucket_id = 'product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='anon insert product-images'
  ) then
    create policy "anon insert product-images"
      on storage.objects for insert
      to anon
      with check (bucket_id = 'product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='anon update product-images'
  ) then
    create policy "anon update product-images"
      on storage.objects for update
      to anon
      using (bucket_id = 'product-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects' and policyname='anon delete product-images'
  ) then
    create policy "anon delete product-images"
      on storage.objects for delete
      to anon
      using (bucket_id = 'product-images');
  end if;
end $$;
