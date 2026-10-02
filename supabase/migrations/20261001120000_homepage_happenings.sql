-- Homepage Happening announcements. Admin writes use the service role;
-- public clients can only read announcements that are currently live.
create table if not exists public.homepage_happenings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  event_at timestamptz not null,
  summary text not null check (char_length(summary) between 1 and 240),
  image_url text,
  button_label text check (button_label is null or char_length(button_label) between 1 and 50),
  button_url text,
  show_until timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homepage_happenings_button_pair check (
    (button_label is null and button_url is null)
    or (button_label is not null and button_url is not null)
  )
);

create index if not exists homepage_happenings_live_idx
  on public.homepage_happenings (active, show_until, event_at);

create or replace function public.set_homepage_happening_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_homepage_happening_updated_at on public.homepage_happenings;
create trigger set_homepage_happening_updated_at
before update on public.homepage_happenings
for each row execute function public.set_homepage_happening_updated_at();

-- The API checks this limit for a clear error. The trigger also makes the
-- invariant concurrency-safe if two Admin requests arrive together.
create or replace function public.enforce_homepage_happening_live_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  live_count integer;
begin
  if new.active and new.show_until > now() then
    perform pg_advisory_xact_lock(hashtextextended('public.homepage_happenings.live_limit', 0));

    select count(*)
      into live_count
      from public.homepage_happenings
     where active is true
       and show_until > now()
       and id <> new.id;

    if live_count >= 3 then
      raise exception 'homepage_happenings_live_limit'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_homepage_happening_live_limit on public.homepage_happenings;
create trigger enforce_homepage_happening_live_limit
before insert or update of active, show_until on public.homepage_happenings
for each row execute function public.enforce_homepage_happening_live_limit();

alter table public.homepage_happenings enable row level security;

revoke all privileges on table public.homepage_happenings from anon, authenticated;
grant select on table public.homepage_happenings to anon, authenticated;
grant all on table public.homepage_happenings to service_role;

drop policy if exists "Public can read live homepage happenings" on public.homepage_happenings;
create policy "Public can read live homepage happenings"
on public.homepage_happenings
for select
to anon, authenticated
using (active is true and show_until > now());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'happening-images',
  'happening-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public images are readable. Uploads and deletes happen through the Admin
-- API with the service role, so no public write policy is created.
drop policy if exists "Public can view happening images" on storage.objects;
create policy "Public can view happening images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'happening-images');

