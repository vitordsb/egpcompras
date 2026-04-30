-- Anexos dos pedidos: PDF de venda (Conta Azul), PDF da NF-e (DANFE), XML NF-e, XML CC-e
create table if not exists shipment_attachments (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references shipments(id) on delete cascade,
  file_path     text not null,                       -- caminho dentro do bucket 'shipments'
  file_name     text not null,                       -- nome original do arquivo
  file_type     text not null check (file_type in ('venda_pdf','nfe_pdf','nfe_xml','cce_xml','outro')),
  mime_type     text not null,
  size_bytes    bigint,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   text                                 -- email/master do usuário que fez upload
);

create index if not exists shipment_attachments_shipment_idx on shipment_attachments(shipment_id);
create index if not exists shipment_attachments_type_idx on shipment_attachments(file_type);

alter table shipment_attachments disable row level security;

-- Policy de leitura pública para o bucket shipments (com signed URL via JWT)
-- Storage policies: permitir authenticated/anon usar o bucket
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'shipments') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('shipments', 'shipments', false, 10485760);
  end if;
end$$;
