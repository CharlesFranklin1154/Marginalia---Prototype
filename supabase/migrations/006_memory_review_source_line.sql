alter table public.ai_suggestions
  add column if not exists source_line integer not null default 1;

notify pgrst, 'reload schema';
