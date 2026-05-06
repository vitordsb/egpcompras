-- Estende RMA pra refletir o formato real da planilha técnica:
-- header com setor/técnico/volume/OS + por item: posição, componentes
-- trocados, observação de status, data fabricação, garantia, valor.

alter table rmas
  add column if not exists setor              text default 'Manutenção',
  add column if not exists tecnico_nome       text,
  add column if not exists tecnico_phone      text,
  add column if not exists volume             integer default 1,
  add column if not exists numero_os          text,           -- OS interna do reparo
  add column if not exists desconto           numeric(12,2) default 0,
  add column if not exists prazo_entrega      date,
  add column if not exists condicao_pagamento text;

alter table rma_items
  add column if not exists posicao              integer,         -- 1, 2, 3... ordem na planilha
  add column if not exists componentes_trocados text,            -- "Res. 100K 3W, Res. 2M7"
  add column if not exists observacao_status    text,            -- "Desgaste", "Testada", "Erro de Ligação", "Sem Defeito"
  add column if not exists data_fabricacao      date,
  add column if not exists tem_garantia         boolean default false,
  add column if not exists valor_total          numeric(12,2);

create index if not exists rma_items_posicao_idx on rma_items(rma_id, posicao);
