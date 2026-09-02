create table if not exists public.circle_prompts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.circles(id) on delete cascade not null,
  prompt text not null,
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists circle_prompts_circle_id_idx on public.circle_prompts(circle_id);

alter table public.circle_prompts enable row level security;
drop policy if exists "Anyone can read circle prompts" on public.circle_prompts;
create policy "Anyone can read circle prompts"
  on public.circle_prompts for select using (true);

insert into public.circle_prompts (circle_id, prompt)
select c.id, p.prompt
from public.circles c
cross join (values
  ('What''s something you''re finding hard as a dad this week?'),
  ('What did you do with the kids this weekend?'),
  ('What''s one small win you''re proud of today?'),
  ('What would make this week feel a little easier?'),
  ('What''s something you wish other dads understood?')
) as p(prompt)
where not exists (
  select 1 from public.circle_prompts existing
  where existing.circle_id = c.id
);

insert into public.circle_prompts (circle_id, prompt, is_official)
select c.id, 'Dad Health weekly prompt: what is one moment with your kids you want to remember this week?', true
from public.circles c
where not exists (
  select 1 from public.circle_prompts existing
  where existing.circle_id = c.id and existing.is_official = true
);
