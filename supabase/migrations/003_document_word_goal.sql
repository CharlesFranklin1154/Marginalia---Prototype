alter table public.documents
  add column if not exists word_goal integer
  check (word_goal is null or word_goal >= 0);