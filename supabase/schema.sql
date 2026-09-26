create extension if not exists pgcrypto;

create table public.books (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  theme text not null default 'rainy',
  cover_url text,
  brain_dump text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  book_id uuid not null references public.books(id) on delete cascade,
  kind text not null check (kind in ('chapter', 'scene', 'brain_dump')),
  title text not null default '',
  content_html text not null default '',
  content_text text not null default '',
  word_goal integer check (word_goal is null or word_goal >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique,
  book_id uuid not null references public.books(id) on delete cascade,
  kind text not null check (kind in ('character', 'location', 'item')),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  entity_id uuid references public.entities(id) on delete set null,
  type text not null,
  field text not null,
  operation text not null check (operation in ('append', 'replace', 'remove')),
  value text not null,
  evidence text not null,
  source_line integer not null default 1,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index documents_book_id_idx on public.documents(book_id);
create index entities_book_id_idx on public.entities(book_id);
create index ai_suggestions_book_id_status_idx on public.ai_suggestions(book_id, status);

alter table public.books enable row level security;
alter table public.documents enable row level security;
alter table public.entities enable row level security;
alter table public.ai_suggestions enable row level security;

create or replace function public.owns_book(target_book_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books
    where id = target_book_id and user_id = auth.uid()
  );
$$;

create policy "Users manage their books"
  on public.books for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users manage their documents"
  on public.documents for all
  using (public.owns_book(book_id))
  with check (public.owns_book(book_id));

create policy "Users manage their entities"
  on public.entities for all
  using (public.owns_book(book_id))
  with check (public.owns_book(book_id));

create policy "Users manage their suggestions"
  on public.ai_suggestions for all
  using (public.owns_book(book_id))
  with check (public.owns_book(book_id));
