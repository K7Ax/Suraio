-- Sura — analytics foundation: the game_events table.
-- Captures real player behavior (visits, opens, starts, completes, fails,
-- hints, quits, shares, daily returns) so we can measure retention/completion
-- /rage-quit instead of guessing. Purely additive; auth & gameplay untouched.
--
-- Apply via Supabase MCP `apply_migration` or paste into the SQL Editor.
-- Creating a table + insert-only RLS is non-destructive and safe to re-run.

create table if not exists public.game_events (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users(id) on delete set null,  -- null for anonymous visitors
  session_id   text not null,            -- per-tab session id from the client
  device_id    text,                     -- stable anonymous device id (localStorage)
  game_type    text,                     -- wordle|connections|... (null for site-wide events)
  level_number int,
  event_type   text not null check (event_type in (
    'site_visit','game_opened','level_started','level_completed',
    'level_failed','hint_used','level_quit','share_clicked','daily_return')),
  metadata     jsonb not null default '{}'::jsonb,  -- {seconds, attempts, score, hint_kind, source, ...}
  created_at   timestamptz not null default now()
);

create index if not exists game_events_type_time_idx   on public.game_events (event_type, created_at);
create index if not exists game_events_game_level_idx   on public.game_events (game_type, level_number, event_type);
create index if not exists game_events_device_time_idx  on public.game_events (device_id, created_at);

-- RLS: anyone (anon + authenticated) may INSERT events, but NOBODY may SELECT
-- through the public API. Dashboard reads happen via service_role / dedicated
-- RPCs added in Phase 3 — this prevents the events table leaking to clients.
-- NOTE: a hardened path later is an Edge Function `log-event` instead of direct
-- client insert; we start with constrained direct insert to avoid deploying now.
alter table public.game_events enable row level security;

drop policy if exists game_events_insert_anyone on public.game_events;
create policy game_events_insert_anyone
  on public.game_events
  for insert
  to anon, authenticated
  with check (true);
