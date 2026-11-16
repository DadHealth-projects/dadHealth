-- Store canonical overall score on future captures.
-- Existing immutable snapshots are not rewritten.
begin;

do $migration$
declare
  definition text;
  anchor constant text :=
    $anchor$payload:=jsonb_build_object('version',2,'period',period,$anchor$;
  occurrences integer;
begin
  definition := pg_get_functiondef(
    'public.build_weekly_report_candidate(uuid,date,timestamptz)'::regprocedure
  );

  if position('''totalScore''' in definition) > 0 then
    raise exception 'Overall-score storage already exists; nothing changed';
  end if;

  occurrences := (
    length(definition)
    - length(replace(definition, anchor, ''))
  ) / length(anchor);

  if occurrences <> 1 then
    raise exception
      'Candidate differs from inspected source; nothing changed';
  end if;

  definition := replace(
    definition,
    anchor,
    anchor || $addition$
   'totalScore',
     case
       when pillars#>>'{mind,score,value}' is not null
        and pillars#>>'{body,score,value}' is not null
        and pillars#>>'{bond,score,value}' is not null
       then jsonb_build_object(
         'state', 'available',
         'value', round((
           (pillars#>>'{mind,score,value}')::numeric
           + (pillars#>>'{body,score,value}')::numeric
           + (pillars#>>'{bond,score,value}')::numeric
         ) / 3.0)
       )
       else jsonb_build_object('state', 'unavailable')
     end,
$addition$
  );

  execute definition;
end;
$migration$;

commit;
