-- Retenção do bucket wa-images: deletar arquivos > 30 dias.
--
-- Motivação: Free plan do Supabase tem 1GB de Storage total. Flyers da IA
-- + imagens enviadas por clientes via WhatsApp acumulam sem limite.
-- Sem retenção, em 8-12 meses o bucket bloqueia uploads silenciosamente
-- e geração de flyer começa a falhar.
--
-- Estratégia: cron semanal (segunda 03:00 UTC) que apaga arquivos
-- criados há mais de 30 dias E que não estão referenciados em
-- marketing_assets (galeria curada — esses ficam pra sempre).

create extension if not exists pg_cron with schema extensions;

-- Função que faz a limpeza
create or replace function cleanup_old_wa_images()
returns table(deleted_count int, kept_count int) language plpgsql security definer as $$
declare
  v_deleted int := 0;
  v_kept int := 0;
begin
  -- Deleta arquivos do bucket wa-images com mais de 30 dias
  -- que NÃO estão na galeria marketing_assets (preservados pelo user)
  with old_files as (
    select name
    from storage.objects
    where bucket_id = 'wa-images'
      and created_at < now() - interval '30 days'
      and not exists (
        select 1 from marketing_assets ma
        where ma.image_url like '%/' || storage.objects.name
      )
  ),
  deleted as (
    delete from storage.objects
    where bucket_id = 'wa-images'
      and name in (select name from old_files)
    returning 1
  )
  select count(*)::int into v_deleted from deleted;

  -- Conta quantos foram preservados (em marketing_assets)
  select count(*)::int into v_kept
  from storage.objects
  where bucket_id = 'wa-images'
    and created_at < now() - interval '30 days'
    and exists (
      select 1 from marketing_assets ma
      where ma.image_url like '%/' || storage.objects.name
    );

  -- Log estruturado pro Supabase logs
  raise log 'cleanup_old_wa_images: deleted=% kept=%', v_deleted, v_kept;

  return query select v_deleted, v_kept;
end;
$$;

-- Agenda execução semanal (toda segunda às 03:00 UTC)
-- Se já existe job com mesmo nome, atualiza
select cron.unschedule('cleanup-wa-images-weekly') where exists (
  select 1 from cron.job where jobname = 'cleanup-wa-images-weekly'
);

select cron.schedule(
  'cleanup-wa-images-weekly',
  '0 3 * * 1',  -- toda segunda às 03:00 UTC
  $$ select cleanup_old_wa_images() $$
);

-- rollback:
-- select cron.unschedule('cleanup-wa-images-weekly');
-- drop function if exists cleanup_old_wa_images();
