-- Store the new daily check-in answers without changing existing scoring.
-- Nullable fields keep historical rows and older app versions compatible.
alter table public.mood_logs
  add column if not exists energy_level smallint,
  add column if not exists connection_level smallint;

alter table public.mood_logs
  drop constraint if exists mood_logs_energy_level_chk,
  add constraint mood_logs_energy_level_chk
    check (energy_level between 1 and 5),
  drop constraint if exists mood_logs_connection_level_chk,
  add constraint mood_logs_connection_level_chk
    check (connection_level between 1 and 5);

comment on column public.mood_logs.energy_level is
  'Daily check-in energy response, 1–5. Null for historical or older-client records.';
comment on column public.mood_logs.connection_level is
  'Daily check-in connection response, 1–5. Null for historical or older-client records.';

-- Older app versions omit newer/optional answers from same-day upserts. Keep
-- those stored values when an update sends NULL for an omitted field.
create or replace function public.preserve_mood_checkin_optional_values()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stress_level is null then new.stress_level := old.stress_level; end if;
  if new.energy_level is null then new.energy_level := old.energy_level; end if;
  if new.connection_level is null then new.connection_level := old.connection_level; end if;
  return new;
end;
$$;

drop trigger if exists mood_logs_preserve_checkin_optional_values on public.mood_logs;
create trigger mood_logs_preserve_checkin_optional_values
before update on public.mood_logs
for each row execute function public.preserve_mood_checkin_optional_values();

-- Existing owner-only mood_logs RLS policy continues to protect both fields.
