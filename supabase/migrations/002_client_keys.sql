-- Run this once after the original schema.sql.
-- It preserves existing rows while adding the keys used by the V1-to-V2 adapter.

alter table public.books
  add column if not exists client_key text;
alter table public.documents
  add column if not exists client_key text;
alter table public.entities
  add column if not exists client_key text;

alter table public.documents
  drop constraint if exists documents_kind_check;
alter table public.documents
  add constraint documents_kind_check check (kind in ('chapter', 'scene', 'brain_dump'));

update public.books
set client_key = 'legacy-book-' || id::text
where client_key is null;

update public.documents
set client_key = 'legacy-document-' || id::text
where client_key is null;

update public.entities
set client_key = 'legacy-entity-' || id::text
where client_key is null;

alter table public.books
  alter column client_key set not null;
alter table public.documents
  alter column client_key set not null;
alter table public.entities
  alter column client_key set not null;

alter table public.books
  alter column user_id set default auth.uid();

create unique index if not exists books_client_key_idx
  on public.books(client_key);
create unique index if not exists documents_client_key_idx
  on public.documents(client_key);
create unique index if not exists entities_client_key_idx
  on public.entities(client_key);
