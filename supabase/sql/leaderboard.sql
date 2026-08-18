-- ============================================================================
-- Sura — Phase 2 leaderboard/stats foundation (server-authoritative).
--
-- WHY
-- The meta-game (XP, rank, streak, games cleared) lived only in device
-- localStorage, so there was no cross-player leaderboard of it, and it was lost
-- on device change. These tables let the server own the authoritative totals.
-- Scoring is written ONLY by the `submit-progress` Edge Function (service role),
-- which re-validates each result against `level_keys` before crediting — the
-- client can never write XP directly (RLS: no client write policies).
--
-- TABLES
--  • level_keys      — precomputed answer key per (game_type, level). Service-role
--                      only (RLS enabled, no policies), like puzzle_bank. Solutions
--                      never leave the DB.
--  • player_progress — one row per (user, game, level) actually cleared. Owner may
--                      read their own; writes are service-role only. The PK is the
--                      idempotency key (a level credits XP exactly once).
--  • player_totals   — the aggregate that backs the global leaderboard. PUBLIC
--                      read (leaderboard); writes service-role only.
--
-- Apply in: Supabase dashboard → SQL Editor (or MCP apply_migration).
-- Additive + reversible (drop the three tables + the function to revert).
-- ============================================================================

begin;

-- ── level_keys ──────────────────────────────────────────────────────────────
create table if not exists public.level_keys (
  game_type  text    not null,
  level      int     not null,
  band       int     not null default 0,
  solution   jsonb   not null,
  updated_at timestamptz not null default now(),
  primary key (game_type, level)
);
alter table public.level_keys enable row level security;
-- No policies: only the service role (submit-progress) reads/writes it.

-- ── player_progress ─────────────────────────────────────────────────────────
create table if not exists public.player_progress (
  user_id    uuid   not null references public.profiles(id) on delete cascade,
  game_type  text   not null,
  level      int    not null,
  best_score int    not null default 0,
  best_time  int,
  xp_awarded int    not null default 0,
  cleared_at timestamptz not null default now(),
  primary key (user_id, game_type, level)
);
alter table public.player_progress enable row level security;
-- Owner may read their own cleared levels; writes are service-role only.
create policy player_progress_read_self on public.player_progress
  for select using ((select auth.uid()) = user_id);
create index if not exists player_progress_user_idx
  on public.player_progress (user_id);

-- ── player_totals ───────────────────────────────────────────────────────────
create table if not exists public.player_totals (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  total_xp      bigint not null default 0,
  rank_tier     int    not null default 0,   -- 0..4 (مُشارِك..أسطورة)
  max_streak    int    not null default 0,
  games_cleared int    not null default 0,
  updated_at    timestamptz not null default now()
);
alter table public.player_totals enable row level security;
-- Public read (this is the leaderboard source); writes are service-role only.
create policy player_totals_read_public on public.player_totals
  for select using (true);
create index if not exists player_totals_xp_idx
  on public.player_totals (total_xp desc);

-- ── get_global_leaderboard ──────────────────────────────────────────────────
-- The single sanctioned read of the global board projection (name + totals +
-- dense rank). SECURITY DEFINER so it works pre-auth; limit clamped 1..100.
create or replace function public.get_global_leaderboard(p_limit int default 20)
returns table (display_name text, total_xp bigint, rank_tier int,
               games_cleared int, rank bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce(p.display_name, 'لاعب') as display_name,
    t.total_xp,
    t.rank_tier,
    t.games_cleared,
    rank() over (order by t.total_xp desc) as rank
  from public.player_totals t
  left join public.profiles p on p.id = t.user_id
  where t.total_xp > 0
  order by t.total_xp desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.get_global_leaderboard(int) from public;
grant execute on function public.get_global_leaderboard(int) to anon, authenticated;

commit;
