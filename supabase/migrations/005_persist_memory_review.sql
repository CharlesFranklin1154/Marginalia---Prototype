-- Stable client keys make repeated scene analysis idempotent while preserving review decisions.
alter table public.ai_suggestions
  add column if not exists client_key text;

alter table public.ai_suggestions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.ai_suggestions
set client_key = 'legacy-suggestion-' || id::text
where client_key is null;

alter table public.ai_suggestions
  alter column client_key set not null;

create unique index if not exists ai_suggestions_client_key_idx
  on public.ai_suggestions(client_key);
