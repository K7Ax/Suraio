-- ============================================================
-- سُرى — المرحلة هـ: البلاغ والتقييم.
--
-- الصقها كاملةً في: Supabase → SQL Editor → Run.
-- إضافيّة بالكامل وقابلة لإعادة التشغيل — لا حذف، ولا مساس بالدخول/المصادقة.
-- (لا `supabase db push`: الترحيلات لصقٌ يدويّ، كما في بقيّة هذا المجلّد.)
-- ============================================================


-- ────────────────────────────────────────
-- 1/4 — feedback_reports: بلاغات اللاعبين
-- ────────────────────────────────────────
-- WHY A TABLE AND NOT «تلغرام فقط»: a Telegram message is a notification, not a
-- record. It cannot be counted, filtered by game, or joined against the level a
-- report was filed from — and it disappears the day the bot token is rotated.
-- The row is the record; the Telegram alert is a courtesy on top of it.
--
-- AUTHORITY: RLS on, **zero client policies** — the same shape as puzzle_bank and
-- authored_items. The only writer is the `submit-feedback` Edge Function via the
-- service role. A table a browser can write is a table strangers can fill, and a
-- report queue full of junk is a report queue nobody reads.
--
-- THE IMAGE IS NOT STORED HERE. `photo_file_id` is a Telegram file_id: the bytes
-- live in Telegram's CDN, this column is a pointer. Zero bytes of Supabase
-- Storage, which is the whole reason the owner chose this route.

create table if not exists public.feedback_reports (
  id            uuid primary key default gen_random_uuid(),
  -- Null for an anonymous reporter, which is the common case: the player who hits
  -- a bug is usually the one who never signed in.
  user_id       uuid references auth.users(id) on delete set null,
  device_id     text,
  session_id    text,
  game_type     text,
  level_number  int,

  -- The three guided fields, kept separate rather than concatenated. «ماذا
  -- توقّعت» versus «ماذا حدث» is the entire diagnostic value of a bug report, and
  -- a single blob loses it the moment the first one is written.
  doing         text not null,
  expected      text,
  happened      text not null,

  photo_file_id text,
  -- Auto-attached slice: {device, browser, ua, viewport, url, lang, theme, build}.
  -- Collected by the client so the reporter never has to describe their phone.
  context       jsonb not null default '{}'::jsonb,

  status        text not null default 'new'
                check (status in ('new','triaged','fixed','wontfix')),
  github_issue  int,
  created_at    timestamptz not null default now()
);

create index if not exists feedback_reports_new_idx
  on public.feedback_reports (status, created_at desc);
create index if not exists feedback_reports_game_idx
  on public.feedback_reports (game_type, created_at desc);

alter table public.feedback_reports enable row level security;
-- No policies, deliberately. RLS on with no policy = nothing for anon or
-- authenticated; the service role bypasses RLS. Reads happen through
-- `dash_reports()` below, which gates on the owner's email.

comment on table public.feedback_reports is
  'Player bug reports. Written only by the submit-feedback Edge Function (service role). photo_file_id points at Telegram, not Storage.';


-- ────────────────────────────────────────
-- 2/4 — game_ratings: تقييم الصعوبة
-- ────────────────────────────────────────
-- WHY IT EXISTS: the Constitution states difficulty targets as completion rates
-- (85% / 70% / 40%). `game_events` already measures the real rate. This table
-- measures what players *feel*. Neither number is the signal on its own — the
-- DIVERGENCE is: «they call level 14 fair, and 40% of them abandon it».
--
-- ONE RATING PER RATER PER GAME. `rater` is the user id when signed in and the
-- device id otherwise, computed server-side in the Edge Function — never sent by
-- the client, or one player becomes a hundred voters. A unique constraint on a
-- real column (rather than an expression index over two nullable ones) is what
-- makes the upsert on re-rate a plain `onConflict`.

create table if not exists public.game_ratings (
  id            uuid primary key default gen_random_uuid(),
  rater         text not null,
  user_id       uuid references auth.users(id) on delete set null,
  device_id     text,
  game_type     text not null,
  level_number  int,
  -- The one-tap post-win question. Three answers, because a fourth is a survey.
  verdict       text not null check (verdict in ('too_hard','just_right','too_easy')),
  -- The fuller rating from the section card. Optional on purpose: a verdict with
  -- no stars is still a complete answer to the question that was asked.
  stars         smallint check (stars between 1 and 5),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists game_ratings_identity
  on public.game_ratings (rater, game_type);
create index if not exists game_ratings_game_idx
  on public.game_ratings (game_type, verdict);

alter table public.game_ratings enable row level security;
-- Same as above: no client policies. Written only by submit-feedback.

comment on table public.game_ratings is
  'Perceived difficulty, one row per (rater, game). Compared against real completion rate from game_events — the divergence is the signal.';


-- ────────────────────────────────────────
-- 3/4 — توسيع CHECK على game_events.event_type
-- ────────────────────────────────────────
-- The closed list is the point (it stops a typo becoming a third spelling of an
-- event nobody can aggregate), so a new event costs an explicit migration. Same
-- shape as migrations_pending.sql §1/3. Additive: every existing row already
-- satisfies the new list.
--
-- `report_sent` and `rating_given` are tracked so the FUNNEL is measurable, not
-- just the outcome: how many people open the report form versus how many finish
-- it tells us whether the form itself is the obstacle. Without it, «few reports»
-- is unreadable — it could mean few bugs or an unusable form.

alter table public.game_events drop constraint if exists game_events_event_type_check;

alter table public.game_events add constraint game_events_event_type_check
  check (event_type in (
    'site_visit','game_opened','level_started','level_completed',
    'level_failed','hint_used','level_quit','share_clicked','daily_return',
    'daily_started','daily_finished',
    -- المرحلة هـ: البلاغ والتقييم.
    -- report_opened: فتح النموذج · report_sent: أُرسل فعلًا · rating_given: قيّم.
    'report_opened','report_sent','rating_given'));


-- ────────────────────────────────────────
-- 4/4 — قراءات اللوحة: dash_reports / dash_ratings
-- ────────────────────────────────────────
-- Same pattern as migrations/dashboard_rpcs.sql: SECURITY DEFINER, gated on
-- is_sura_admin(), execute revoked from anon. Raw rows never leave the database
-- to a non-admin — and a bug report can contain anything a player typed,
-- including their own email address, so this is not a formality here.

create or replace function public.dash_reports(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into r from (
    select id, created_at, status, game_type, level_number,
           doing, expected, happened,
           photo_file_id is not null as has_photo,
           github_issue,
           user_id is not null as signed_in,
           context->>'device'  as device,
           context->>'browser' as browser
    from feedback_reports
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) t;
  return r;
end; $$;

-- Perceived difficulty per game, next to the real completion rate from
-- game_events — the two numbers are useless apart and only mean something in the
-- same row, so they are joined here rather than in the browser.
create or replace function public.dash_ratings()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into r from (
    select g.game_type,
      count(*)                                             as votes,
      count(*) filter (where g.verdict = 'too_hard')       as too_hard,
      count(*) filter (where g.verdict = 'just_right')     as just_right,
      count(*) filter (where g.verdict = 'too_easy')       as too_easy,
      round(avg(g.stars) filter (where g.stars is not null), 2) as avg_stars,
      (select case when count(*) filter (where e.event_type = 'level_started') > 0
         then round(100.0 * count(*) filter (where e.event_type = 'level_completed')
                          / count(*) filter (where e.event_type = 'level_started'), 1)
         end
       from game_events e where e.game_type = g.game_type)  as completion_pct
    from game_ratings g
    group by g.game_type
    order by votes desc
  ) t;
  return r;
end; $$;

revoke execute on function public.dash_reports(int), public.dash_ratings() from public, anon;
grant  execute on function public.dash_reports(int), public.dash_ratings() to authenticated;


-- ---------------------------------------------------------------------------
-- 5. report_month — the whole of the bot's `/report` in ONE round trip.
--
-- WHY IT EXISTS SEPARATELY FROM dash_*. `is_sura_admin()` reads
-- `auth.jwt()->>'email'`, and the Telegram bot authenticates with the SERVICE
-- KEY, whose token carries a role and no email. Every dash_* function would
-- raise 'not authorized' for it. The bot is a legitimate admin surface (it is
-- gated on ADMIN_IDS and runs on the owner's own machine) so it needs a door
-- that its credential can actually open.
--
-- WHY THE service_role BRANCH IS NOT A WIDENING. Whoever holds the service key
-- can already `select * from game_events` and compute every one of these numbers
-- by hand — the key bypasses RLS entirely, by definition. This grants no
-- capability that credential did not already have; it only saves pulling a month
-- of raw rows across the network to aggregate them in Node. Nothing here is
-- reachable by `anon` or by an ordinary signed-in player.
--
-- WHY AGGREGATES AND NOT ROWS. A monthly report is counts. Sending raw events or
-- raw report text to a chat would put whatever a player typed — possibly their
-- own email — into a Telegram history. Only the newest reports' text is exposed,
-- and that is the one thing the report is for.
create or replace function public.report_month(p_month text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb; lo timestamptz; hi timestamptz;
begin
  if not (public.is_sura_admin()
          or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not authorized';
  end if;
  -- Riyadh, to match suraDailySeed() on the client and every other day boundary
  -- in this system. A report whose month starts at UTC midnight would count the
  -- first three hours of each day into the wrong one.
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'bad month'; end if;
  lo := ((p_month || '-01')::date)::timestamp at time zone 'Asia/Riyadh';
  hi := (((p_month || '-01')::date + interval '1 month'))::timestamp at time zone 'Asia/Riyadh';

  select jsonb_build_object(
    'month', p_month,
    'totals', (select jsonb_build_object(
        'events',    count(*),
        'players',   count(distinct device_id),
        'signed_in', count(distinct user_id) filter (where user_id is not null),
        'visits',    count(*) filter (where event_type = 'site_visit'),
        'returns',   count(*) filter (where event_type = 'daily_return')
      ) from game_events where created_at >= lo and created_at < hi),
    'games', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select game_type,
          count(*) filter (where event_type = 'game_opened')     as opened,
          count(*) filter (where event_type = 'level_started')   as started,
          count(*) filter (where event_type = 'level_completed') as completed,
          count(*) filter (where event_type = 'level_quit')      as quit,
          count(*) filter (where event_type = 'hint_used')       as hints,
          case when count(*) filter (where event_type = 'level_started') > 0
            then round(100.0 * count(*) filter (where event_type = 'level_completed')
                             / count(*) filter (where event_type = 'level_started'), 1)
            end as completion_pct
        from game_events
        where created_at >= lo and created_at < hi and game_type is not null
        group by game_type order by opened desc
      ) t),
    -- The stuck points: worst first, and only levels with enough starts to mean
    -- anything. One player quitting once is not a difficulty signal.
    'stuck', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select game_type, level_number,
          count(*) filter (where event_type = 'level_started')   as started,
          count(*) filter (where event_type = 'level_completed') as completed,
          count(*) filter (where event_type = 'level_quit')      as quit,
          round(100.0 * count(*) filter (where event_type = 'level_completed')
                      / nullif(count(*) filter (where event_type = 'level_started'), 0), 1) as completion_pct
        from game_events
        where created_at >= lo and created_at < hi
          and game_type is not null and level_number is not null
        group by game_type, level_number
        having count(*) filter (where event_type = 'level_started') >= 5
        order by completion_pct asc nulls last
        limit 8
      ) t),
    'ratings', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select game_type, count(*) as votes,
          count(*) filter (where verdict = 'too_hard')   as too_hard,
          count(*) filter (where verdict = 'just_right') as just_right,
          count(*) filter (where verdict = 'too_easy')   as too_easy,
          round(avg(stars) filter (where stars is not null), 2) as avg_stars
        from game_ratings
        where created_at >= lo and created_at < hi
        group by game_type order by votes desc
      ) t),
    'reports', (select jsonb_build_object(
        'total', count(*),
        'new',   count(*) filter (where status = 'new'),
        'fixed', count(*) filter (where status = 'fixed')
      ) from feedback_reports where created_at >= lo and created_at < hi),
    'recent', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select id, created_at, status, game_type, level_number, happened, github_issue
        from feedback_reports
        where created_at >= lo and created_at < hi
        order by created_at desc limit 5
      ) t)
  ) into r;
  return r;
end; $$;

revoke execute on function public.report_month(text) from public, anon;
grant  execute on function public.report_month(text) to authenticated;
