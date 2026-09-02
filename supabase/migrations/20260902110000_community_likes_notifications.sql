-- Community likes for comments/replies + push notification support.

-- ============================================
-- COMMENT LIKES
-- ============================================

create table if not exists public.comment_likes (
  user_id uuid references auth.users(id) on delete cascade not null,
  comment_id uuid references public.comments(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create index if not exists idx_comment_likes_comment_id
on public.comment_likes(comment_id);

alter table public.comment_likes enable row level security;

drop policy if exists "Anyone can read comment likes" on public.comment_likes;
create policy "Anyone can read comment likes"
on public.comment_likes
for select
using (true);

drop policy if exists "Users can like comments" on public.comment_likes;
create policy "Users can like comments"
on public.comment_likes
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can unlike comments" on public.comment_likes;
create policy "Users can unlike comments"
on public.comment_likes
for delete
using (auth.uid() = user_id);


-- ============================================
-- NEW NOTIFICATION TYPE
-- ============================================

alter table public.notification_preferences
drop constraint if exists notification_preferences_type_chk;

alter table public.notification_preferences
add constraint notification_preferences_type_chk check (
  notification_type in (
    'morning_checkin',
    'bedtime_story',
    'workout_window',
    'weekly_score',
    'streak_at_risk',
    'weekly_challenge',
    'journal_prompt',
    'milestone_anniversary',
    'community_reply',
    'community_like',
    'co_parent_event_added',
    'present_dad_mode_complete'
  )
);

alter table public.notification_log
drop constraint if exists notification_log_type_chk;

alter table public.notification_log
add constraint notification_log_type_chk check (
  type in (
    'morning_checkin',
    'bedtime_story',
    'workout_window',
    'weekly_score',
    'streak_at_risk',
    'weekly_challenge',
    'journal_prompt',
    'milestone_anniversary',
    'community_reply',
    'community_like',
    'co_parent_event_added',
    'present_dad_mode_complete'
  )
);

alter table public.notification_delivery_claims
drop constraint if exists notification_delivery_claims_type_chk;

alter table public.notification_delivery_claims
add constraint notification_delivery_claims_type_chk check (
  type in (
    'morning_checkin',
    'bedtime_story',
    'workout_window',
    'weekly_score',
    'streak_at_risk',
    'weekly_challenge',
    'journal_prompt',
    'milestone_anniversary',
    'community_reply',
    'community_like',
    'co_parent_event_added',
    'present_dad_mode_complete'
  )
);


-- Existing users: make community-like preference follow their current
-- community-reply preference.
insert into public.notification_preferences (
  user_id,
  notification_type,
  enabled
)
select
  cr.user_id,
  'community_like',
  cr.enabled
from public.notification_preferences cr
where cr.notification_type = 'community_reply'
on conflict (user_id, notification_type) do nothing;


-- ============================================
-- EVENT PUSH BRIDGE
-- Reads URL + secret from Supabase Vault
-- ============================================

create or replace function public.invoke_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  webhook_url text;
  webhook_secret text;
  notification_type text;
  target_type text;
  request_id bigint;
begin
  select decrypted_secret
  into webhook_url
  from vault.decrypted_secrets
  where name = 'notification_webhook_url'
  limit 1;

  select decrypted_secret
  into webhook_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  if webhook_url is null or webhook_secret is null then
    raise warning 'Skipping notification event: webhook URL or secret is not configured';
    return new;
  end if;

  case tg_table_name
    when 'comments' then
      notification_type := 'community_reply';
      target_type := null;

    when 'likes' then
      notification_type := 'community_like';
      target_type := 'post';

    when 'comment_likes' then
      notification_type := 'community_like';
      target_type := 'comment';

    when 'co_parenting_events' then
      notification_type := 'co_parent_event_added';
      target_type := null;

    else
      return new;
  end case;

  select net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || webhook_secret
    ),
    body := jsonb_build_object(
      'type', notification_type,
      'record_id',
        case
          when tg_table_name = 'likes' then new.post_id
          when tg_table_name = 'comment_likes' then new.comment_id
          else new.id
        end,
      'actor_user_id',
        case
          when tg_table_name in ('likes', 'comment_likes') then new.user_id
          else auth.uid()
        end,
      'target_type', target_type
    )
  )
  into request_id;

  return new;
end;
$$;


-- Post likes
drop trigger if exists notify_community_like_on_insert on public.likes;

create trigger notify_community_like_on_insert
after insert on public.likes
for each row
execute function public.invoke_notification_event();


-- Comment / reply likes
drop trigger if exists notify_comment_like_on_insert on public.comment_likes;

create trigger notify_comment_like_on_insert
after insert on public.comment_likes
for each row
execute function public.invoke_notification_event();