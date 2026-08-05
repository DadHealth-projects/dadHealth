alter table public.journal_entries
  add column if not exists prompt text;
