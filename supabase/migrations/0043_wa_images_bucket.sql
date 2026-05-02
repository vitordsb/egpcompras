-- Bucket público para imagens geradas pela IA e enviadas via WhatsApp
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wa-images',
  'wa-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Leitura pública (qualquer um pode visualizar as imagens — necessário para o WhatsApp)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa-images public read'
  ) then
    create policy "wa-images public read"
      on storage.objects for select
      using (bucket_id = 'wa-images');
  end if;
end $$;

-- Inserção apenas via service role (Edge Function generate-image)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa-images service insert'
  ) then
    create policy "wa-images service insert"
      on storage.objects for insert
      with check (bucket_id = 'wa-images');
  end if;
end $$;
