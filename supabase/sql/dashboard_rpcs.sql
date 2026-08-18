-- Sura — Phase 3 dashboard read API.
-- RLS hides game_events from the public API (insert-only). The admin dashboard
-- reads aggregates ONLY through these SECURITY DEFINER functions, each gated on
-- the owner's email. No raw rows ever leave the DB to a non-admin.
--
-- "Today"/day boundaries use KSA (Asia/Riyadh) to match suraDailySeed() on the
-- client. Content Health Score is a heuristic (see dash_level_health).
--
-- Apply via Supabase MCP apply_migration or the SQL Editor.

-- who is allowed to read analytics
create or replace function public.is_sura_admin()
returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'khalid.alzahem@gmail.com';
$$;

-- top-line counters (KSA "today")
create or replace function public.dash_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb; day_start timestamptz;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  day_start := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  select jsonb_build_object(
    'total_events',        (select count(*) from game_events),
    'visits_today',        (select count(*) from game_events where event_type = 'site_visit' and created_at >= day_start),
    'players_today',       (select count(distinct device_id) from game_events where created_at >= day_start),
    'daily_returns_today', (select count(distinct device_id) from game_events where event_type = 'daily_return' and created_at >= day_start),
    'players_all_time',    (select count(distinct device_id) from game_events),
    'signed_in_players',   (select count(distinct user_id) from game_events where user_id is not null),
    'first_event',         (select min(created_at) from game_events),
    'last_event',          (select max(created_at) from game_events)
  ) into r;
  return r;
end; $$;

-- per-game rollup: popularity, completion, avg solve time, hints, quits, shares
create or replace function public.dash_games()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into r from (
    select game_type,
      count(*) filter (where event_type = 'game_opened')     as opened,
      count(*) filter (where event_type = 'level_started')   as started,
      count(*) filter (where event_type = 'level_completed') as completed,
      count(*) filter (where event_type = 'level_failed')    as failed,
      count(*) filter (where event_type = 'level_quit')      as quit,
      count(*) filter (where event_type = 'hint_used')       as hints,
      count(*) filter (where event_type = 'share_clicked')   as shares,
      round(avg((metadata->>'seconds')::numeric)
            filter (where event_type = 'level_completed' and metadata ? 'seconds'), 1) as avg_seconds,
      case when count(*) filter (where event_type = 'level_started') > 0
        then round(100.0 * count(*) filter (where event_type = 'level_completed')
                         / count(*) filter (where event_type = 'level_started'), 1)
        else null end as completion_pct
    from game_events
    where game_type is not null
    group by game_type
    order by opened desc
  ) t;
  return r;
end; $$;

-- per (game, level) health, incl. rage-quit and a heuristic Content Health Score:
--   health = completion_pct - quit_pct - 10*hint_rate   (raw, can go negative)
-- where quit_pct = quits / (quits+completions), hint_rate = hints / starts.
-- Surfaces the levels that drive players away (high quit / low completion).
create or replace function public.dash_level_health()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into r from (
    select game_type, level_number,
      count(*) filter (where event_type = 'level_started')   as started,
      count(*) filter (where event_type = 'level_completed') as completed,
      count(*) filter (where event_type = 'level_failed')    as failed,
      count(*) filter (where event_type = 'level_quit')      as quit,
      count(*) filter (where event_type = 'hint_used')       as hints,
      round(avg((metadata->>'seconds')::numeric)
            filter (where event_type = 'level_completed' and metadata ? 'seconds'), 1) as avg_seconds,
      case when count(*) filter (where event_type = 'level_started') > 0
        then round(100.0 * count(*) filter (where event_type = 'level_completed')
                         / count(*) filter (where event_type = 'level_started'), 1)
        else null end as completion_pct,
      round(
        coalesce(case when count(*) filter (where event_type = 'level_started') > 0
          then 100.0 * count(*) filter (where event_type = 'level_completed')
                     / count(*) filter (where event_type = 'level_started') end, 0)
        - coalesce(case when (count(*) filter (where event_type = 'level_quit')
                            + count(*) filter (where event_type = 'level_completed')) > 0
          then 100.0 * count(*) filter (where event_type = 'level_quit')
                     / (count(*) filter (where event_type = 'level_quit')
                      + count(*) filter (where event_type = 'level_completed')) end, 0)
        - coalesce(case when count(*) filter (where event_type = 'level_started') > 0
          then 10.0 * count(*) filter (where event_type = 'hint_used')
                    / count(*) filter (where event_type = 'level_started') end, 0)
      , 1) as health_score
    from game_events
    where game_type is not null and level_number is not null
    group by game_type, level_number
    order by health_score asc nulls last
  ) t;
  return r;
end; $$;

-- session funnel: how many sessions reach each stage of play
create or replace function public.dash_funnel()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'sessions',        (select count(distinct session_id) from game_events),
    'opened_a_game',   (select count(distinct session_id) from game_events where event_type = 'game_opened'),
    'started_a_level', (select count(distinct session_id) from game_events where event_type = 'level_started'),
    'completed',       (select count(distinct session_id) from game_events where event_type = 'level_completed'),
    'shared',          (select count(distinct session_id) from game_events where event_type = 'share_clicked')
  ) into r;
  return r;
end; $$;

-- last 14 days (KSA) timeseries of visits + unique players
create or replace function public.dash_daily()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into r from (
    select (created_at at time zone 'Asia/Riyadh')::date as day,
      count(*) filter (where event_type = 'site_visit')   as visits,
      count(*) filter (where event_type = 'daily_return') as returns,
      count(distinct device_id)                           as players
    from game_events
    where created_at >= now() - interval '14 days'
    group by 1 order by 1
  ) t;
  return r;
end; $$;

-- Defense-in-depth: these already gate on the owner email, but block the anon
-- role from executing them at the permission layer (dashboard requires sign-in).
revoke execute on function
  public.dash_overview(), public.dash_games(), public.dash_level_health(),
  public.dash_funnel(), public.dash_daily(), public.is_sura_admin()
from public, anon;

grant execute on function
  public.dash_overview(), public.dash_games(), public.dash_level_health(),
  public.dash_funnel(), public.dash_daily(), public.is_sura_admin()
to authenticated;
