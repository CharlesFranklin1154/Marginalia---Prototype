alter table public.entities
  drop constraint if exists entities_kind_check;

alter table public.entities
  add constraint entities_kind_check
  check (kind in ('character', 'location', 'item', 'lore'));
