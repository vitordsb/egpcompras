-- Adiciona tipo de montagem ao componente: SMD (surface mount) ou PTH (through-hole).
-- Opcional — apenas componentes eletrônicos da placa têm esse atributo. Embalagem,
-- etiqueta, manual etc. ficam com NULL.
--
-- A IA deve preencher automaticamente quando o nome trouxer "SMD" ou "PTH"
-- (ex: "Resistor 1K 0603 SMD" → mount_type='SMD').

alter table components
  add column if not exists mount_type text
    check (mount_type in ('SMD', 'PTH'));

create index if not exists components_mount_type_idx on components(mount_type);
