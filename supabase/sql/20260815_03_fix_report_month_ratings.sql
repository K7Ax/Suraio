-- ============================================================
-- سُرى — إصلاحٌ عاجل: `/report` معطَّل
-- ‏١٥ أغسطس ٢٠٢٦
--
-- الصقها في: Supabase → SQL Editor → Run. تعيد تعريف دالّةٍ واحدةٍ للقراءة.
-- ============================================================
--
-- **عطبٌ أدخلتُه أنا في `20260815_02`، وهذا اعتذارُه وإصلاحُه.**
--
-- حين أعدتُ كتابة `report_month` نسختُ جسمَها من `migrations/feedback_and_ratings.sql`
-- في المستودع. وذلك الملفُّ **متأخّرٌ عن الإنتاج**: يسمّي الجدول
-- ‏`feedback_ratings` ويقرأ النجومَ من `context->>'stars'`. والحقيقةُ في القاعدة:
-- الجدولُ اسمُه **`game_ratings`** وفيه عمودٌ حقيقيٌّ اسمُه **`stars`**.
--
-- فصار `/report` يعيد:
--     ‏42P01: relation "feedback_ratings" does not exist
-- أي لا تقريرَ إطلاقًا — لا قسمَ التقييمات وحده.
--
-- **الدرسُ المكتوبُ لئلّا يتكرّر:** ملفُّ الهجرة في المستودع ليس مرآةَ الإنتاج.
-- قُرئ `pg_get_functiondef` للدالّة الحيّة **بعد** الانكسار وكان يجب أن يُقرأ
-- **قبل** إعادة كتابتها. أيُّ `create or replace` لدالّةٍ قائمةٍ يبدأ من تعريفها
-- الحيّ لا من ملفٍّ قديم.


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
        'devices',   count(distinct device_id),
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
    -- ✅ الاسمُ الصحيح `game_ratings`، والنجومُ من عمودها الحقيقيّ `stars`.
    -- وهما ما تستعمله `dash_ratings` الحيّة — فالمصدرُ واحدٌ للرقمين.
    'ratings', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
        select game_type, count(*) as votes,
          count(*) filter (where verdict = 'too_hard')   as too_hard,
          count(*) filter (where verdict = 'just_right') as just_right,
          count(*) filter (where verdict = 'too_easy')   as too_easy,
          round(avg(stars) filter (where stars is not null), 1) as avg_stars
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
        select id, game_type, happened
        from feedback_reports
        where created_at >= lo and created_at < hi
        order by created_at desc limit 5
      ) t)
  ) into r;
  return r;
end; $$;


-- ── التحقّق ──────────────────────────────────────────────────────────
--   select public.report_month('2026-08') -> 'totals';
-- المتوقّع: كائنٌ فيه `devices` و`players` و`finishers` — بلا خطأ.
