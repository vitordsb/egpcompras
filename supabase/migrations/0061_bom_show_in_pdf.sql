-- Flag por linha de BOM: aparece no PDF de exportação de componentes ou não.
-- Default true (todo item aparece). User pode desmarcar manualmente na
-- página Componentes ou via IA: "manda relatório do 12V sem o gabinete".

alter table bom_items
  add column if not exists show_in_pdf boolean not null default true;
