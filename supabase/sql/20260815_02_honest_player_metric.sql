-- ============================================================
-- سُرى — «لاعب» تعني لاعبًا
-- ‏١٥ أغسطس ٢٠٢٦
--
-- الصقها في: Supabase → SQL Editor → Run. تعيد تعريف دالّتين للقراءة فقط.
-- لا جدولَ يُمَسّ، ولا صفَّ يُحذف.
-- ============================================================
--
-- **العطب:** `players` كانت `count(distinct device_id)` على كلّ الأحداث. وأيُّ
-- متصفّحٍ يفتح الصفحة يُسجّل `site_visit` بمعرّفِ جهازٍ جديد — فمتصفّحٌ آليٌّ
-- فُتح وأُغلق يُحسَب «لاعبًا» كاملًا.
--
-- والقياسُ على الإنتاج اليوم:
--     ‏1,215 حدثَ `site_visit` موزّعةً على 1,162 جهازًا — أي زيارةٌ واحدةٌ
--     لكلّ جهازٍ ثمّ لا شيء.
--     و **85.1٪** من الأجهزة (998 من 1,173) سجّلت **حدثًا واحدًا فقط**.
--     و72 جهازًا (6.1٪) سجّلت 4,069 حدثًا من أصل 4,517 — وهي جلساتُ الاختبار
--     الحقيقيّة وتشغيلاتُ الحمل.
--
-- فرقمُ «705 لاعبًا» لم يكن كذبًا في الحساب، بل كان **سؤالًا خاطئًا**: كان
-- يَعُدّ ملفّاتِ متصفّحٍ لا بشرًا. والموقعُ لم يُنشر بعد، فالجوابُ الصحيح
-- للاعبين الحقيقيّين اليوم هو صفرٌ تقريبًا.
--
-- **الإصلاح:** يُفصَل الرقمان بدل أن يُسمّى أحدُهما باسم الآخر:
--   `devices` — أجهزةٌ حمّلت الصفحة. رقمُ حركةِ مرور، لا رقمُ لعب.
--   `players` — أجهزةٌ **بدأت مستوًى فعلًا** (`level_started`). هذا لاعب.
-- ولا يُصلح هذا البياناتِ الاصطناعيّةَ الموجودة — يُصلح ما تعنيه الكلمة.


-- ────────────────────────────────────────
-- 1/2 — report_month
-- ────────────────────────────────────────
create or replace function public.report_month(p_month text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb; lo timestamptz; hi timestamptz;
begin
  if not (public.is_sura_admin()
          or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'not authorized';
  end if;
  if p_month !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'bad month'; end if;
  lo := ((p_month || '-01')::date)::timestamp at time zone 'Asia/Riyadh';
  hi := (((p_month || '-01')::date + interval '1 month'))::timestamp at time zone 'Asia/Riyadh';

  select jsonb_build_object(
    'month', p_month,
    'totals', (select jsonb_build_object(
        'events',    count(*),
        -- أجهزةٌ حمّلت الصفحة — حركةُ مرور.
        'devices',   count(distinct device_id),
        -- ولاعبٌ هو من بدأ مستوًى. هذا هو الفرق كلُّه.
        'players',   count(distinct device_id) filter (where event_type = 'level_started'),
        'finishers', count(distinct device_id) filter (where event_type = 'level_completed'),
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
    -- **شرطٌ ثانٍ أُضيف هنا.** كان الشرطُ «٥ بداياتٍ فأكثر» وحده، فكان التقرير
    -- يسمّي «نقطةَ تعثّر» مستوًى فيه ٨ بداياتٍ و**صفرُ** إكمالاتٍ و**صفرُ**
    -- انسحابات — وذلك ليس تعثّرًا، بل مستوًى فُتح ثمّ أُغلقت النافذة. لا إشارةَ
    -- فيه أصلًا.
    -- فيُشترط الآن **ثلاثُ نهاياتٍ فأكثر** (إكمالٌ أو انسحاب): لا يُبلَّغ عن
    -- مستوًى إلّا إذا وصل إليه ناسٌ وخرجوا منه بنتيجة.
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
           and count(*) filter (where event_type in ('level_completed', 'level_quit')) >= 3
        order by completion_pct asc nulls last
        limit 6
      ) t),
    'ratings', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select game_type, count(*) as votes,
          count(*) filter (where verdict = 'too_hard')   as too_hard,
          count(*) filter (where verdict = 'just_right') as just_right,
          count(*) filter (where verdict = 'too_easy')   as too_easy,
          round(avg((context->>'stars')::numeric), 1)    as avg_stars
        from feedback_ratings
        where created_at >= lo and created_at < hi
        group by game_type order by votes desc
      ) t),
    'reports', (select jsonb_build_object(
        'total', count(*),
        'new',   count(*) filter (where status = 'new'),
        'fixed', count(*) filter (where status = 'fixed')
      ) from feedback_reports where created_at >= lo and created_at < hi),
    'recent', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select id, game_type, happened
        from feedback_reports
        where created_at >= lo and created_at < hi
        order by created_at desc limit 5
      ) t)
  ) into r;
  return r;
end; $$;


-- ────────────────────────────────────────
-- 2/2 — dash_overview: الفصلُ نفسه
-- ────────────────────────────────────────
-- اللوحةُ و`/stats` تقرآن هذه، فلو صُحّح التقريرُ وحدَه لتناقض الرقمان.
create or replace function public.dash_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb; day_start timestamptz;
begin
  if not public.is_sura_admin() then raise exception 'not authorized'; end if;
  day_start := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  select jsonb_build_object(
    'total_events',        (select count(*) from game_events),
    'visits_today',        (select count(*) from game_events where event_type = 'site_visit' and created_at >= day_start),
    'devices_today',       (select count(distinct device_id) from game_events where created_at >= day_start),
    'players_today',       (select count(distinct device_id) from game_events
                             where event_type = 'level_started' and created_at >= day_start),
    'daily_returns_today', (select count(distinct device_id) from game_events where event_type = 'daily_return' and created_at >= day_start),
    'devices_all_time',    (select count(distinct device_id) from game_events),
    'players_all_time',    (select count(distinct device_id) from game_events where event_type = 'level_started'),
    'signed_in_players',   (select count(distinct user_id) from game_events where user_id is not null),
    'first_event',         (select min(created_at) from game_events),
    'last_event',          (select max(created_at) from game_events)
  ) into r;
  return r;
end; $$;


-- ────────────────────────────────────────
-- التحقّق — بعد اللصق مباشرةً
-- ────────────────────────────────────────
--   select (public.report_month('2026-08') -> 'totals');
-- المتوقّع الآن: `devices` رقمٌ كبير (مئات)، و`players` رقمٌ **أصغرُ بكثير**.
-- إن تساويا فالتصحيحُ لم يُطبَّق.
