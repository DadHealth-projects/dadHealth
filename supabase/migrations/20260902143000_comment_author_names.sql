-- Store the public display name on comments so community readers do not
-- depend on owner-only user_profile RLS to resolve another author's name.

alter table public.comments
  add column if not exists author_name text;

create or replace function public.get_comment_author_names(p_user_ids uuid[])
returns table (user_id uuid, display_name text)
language sql
security definer
set search_path = public
as $$
  select u.id,
    coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(coalesce(
        u.raw_user_meta_data->>'display_name',
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name',
        split_part(u.email, '@', 1)
      )), ''),
      'Dad'
    )
  from auth.users u
  left join public.user_profile p on p.user_id = u.id
  where u.id = any(p_user_ids);
$$;

grant execute on function public.get_comment_author_names(uuid[]) to anon, authenticated;

create or replace function public.resolve_comment_author_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_name text;
begin
  select nullif(trim(display_name), '')
    into resolved_name
    from public.user_profile
   where user_id = new.user_id;

  if resolved_name is null then
    select nullif(trim(coalesce(
      raw_user_meta_data->>'display_name',
      raw_user_meta_data->>'full_name',
      raw_user_meta_data->>'name',
      split_part(email, '@', 1)
    )), '')
      into resolved_name
      from auth.users
     where id = new.user_id;
  end if;

  new.author_name := coalesce(resolved_name, 'Dad');
  return new;
end;
$$;

drop trigger if exists set_comment_author_name on public.comments;
create trigger set_comment_author_name
before insert or update of user_id on public.comments
for each row
execute function public.resolve_comment_author_name();

update public.comments c
   set author_name = coalesce(
     nullif(trim((
       select p.display_name
         from public.user_profile p
        where p.user_id = c.user_id
     )), ''),
     nullif(trim(coalesce(
       u.raw_user_meta_data->>'display_name',
       u.raw_user_meta_data->>'full_name',
       u.raw_user_meta_data->>'name',
       split_part(u.email, '@', 1)
     )), ''),
     'Dad'
   )
  from auth.users u
 where c.user_id = u.id
   and (c.author_name is null or trim(c.author_name) = '' or c.author_name = 'Member');
