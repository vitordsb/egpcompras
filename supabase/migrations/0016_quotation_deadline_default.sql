-- Links de cotação expiram por padrão depois de 2 horas.
-- O app e a IA podem sobrescrever esse prazo por cotação.

alter table quotations
  alter column deadline set default (now() + interval '2 hours');

create index if not exists quotations_deadline_idx
  on quotations(deadline)
  where deadline is not null;
