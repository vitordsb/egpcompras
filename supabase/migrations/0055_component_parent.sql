-- Vínculo de "variante" entre componentes — quando um componente é criado
-- como fork de outro (via ComponentsPage > "Aplicar só pra produto X"),
-- guarda referência ao componente pai. Permite agrupar visualmente em
-- cascata e, no futuro, propagar custo/equivalência.
--
-- Nível 1: apenas metadado. Não afeta cotação, estoque ou BOM.
-- Quando o pai é deletado, variantes ficam órfãs (set null) mas continuam
-- funcionando como componentes independentes.

alter table components
  add column if not exists parent_component_id uuid references components(id) on delete set null;

create index if not exists components_parent_idx on components(parent_component_id);
