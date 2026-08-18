-- «إحصائياتي» — أربع خاناتٍ كانت تقرأ جدولًا ميّتًا.
--
-- بلاغ المالك (١٢ أغسطس ٢٠٢٦): «الإحصائيات لا تعمل». والسبب أن `loadStats`
-- تقرأ `public.streaks`، وعدد صفوفه في الإنتاج **صفر**: لا يكتبه إلا
-- `submit-guess`، وهو مسار «تحدي اليوم» القديم الذي لم تعد تستعمله الألعاب
-- الستّ الحيّة. فكانت اللوحة تعرض:
--   لعبت = عدد صفوف player_progress
--   فوز  = **الرقم نفسه** حرفيًّا (لأن sum(total_won) صفر)
--   السلسلة / أفضل سلسلة = صفرٌ إلى الأبد
-- وحتى `player_totals.max_streak` لا يكتبه `submit-progress` إطلاقًا، فهو صفرٌ
-- للمستخدمين الثلاثة جميعًا.
--
-- العلاج: دالّةٌ واحدة تشتقّ الأربعة من `game_events` — المصدر الحيّ الذي فيه
-- ١٤١٢ حدثَ بدءٍ و٨٨ حدثَ إتمام. **مشتقّةٌ دائمًا، لا تُزاد أبدًا**، فلا يمكن
-- أن تنحرف كما انحرف الجدولان السابقان.
--
-- «السلسلة» = أيامُ لعبٍ متتالية (اختيار المالك، ١٢ أغسطس ٢٠٢٦) لا فوزًا
-- يوميًّا متتاليًا: المصدر القديم مات، وأغلب اللاعبين اليوم على الحملة لا على
-- «تحدي اليوم»، فكانت ستبقى صفرًا لهم.
--
-- اليوم بتوقيت الرياض لا UTC — القاعدة نفسها التي يمشي عليها «تحدي اليوم»
-- (منتصف ليل الرياض)، وإلا انقطعت سلسلةُ من يلعب بعد الثالثة فجرًا.
--
-- أمنيًّا: بلا وسيط `user_id`. الدالّة تقرأ `auth.uid()` وحدها، فلا يستطيع
-- حسابٌ أن يقرأ إحصاءات غيره — وسيطٌ كهذا ثغرةُ IDOR مكتملة. و`search_path`
-- مثبّتٌ كما في بقيّة دوالّ SECURITY DEFINER في هذا المستودع.

create or replace function public.my_stats()
returns table (played bigint, wins bigint, current_streak int, max_streak int)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid),
  -- أيامٌ فريدة فيها بدءُ مرحلةٍ أو بدءُ تحدٍّ — «لعبت اليوم» بمعناه البسيط.
  days as (
    select distinct (e.created_at at time zone 'Asia/Riyadh')::date as ksa_day
    from public.game_events e, me
    where e.user_id = me.uid
      and e.event_type in ('level_started', 'daily_started')
  ),
  -- حيلة الجزر: (اليوم − ترتيبه) ثابتٌ داخل كلّ سلسلةٍ متّصلة، فيصير عدّ
  -- المتتالية تجميعًا عاديًّا بدل مسحٍ إجرائيّ.
  islands as (
    select ksa_day,
           ksa_day - (row_number() over (order by ksa_day))::int as grp
    from days
  ),
  runs as (
    select count(*)::int as len, max(ksa_day) as last_day
    from islands group by grp
  )
  select
    (select count(*) from public.game_events e, me
      where e.user_id = me.uid and e.event_type = 'level_started')   as played,
    (select count(*) from public.game_events e, me
      where e.user_id = me.uid and e.event_type = 'level_completed') as wins,
    -- الحاليّة تبقى قائمةً إن كان آخر يومٍ فيها اليومَ أو أمس: لاعبٌ لعب أمس
    -- ولم يلعب بعدُ اليوم لم تنقطع سلسلته، بل هي في انتظاره.
    coalesce((select r.len from runs r
              where r.last_day >= (now() at time zone 'Asia/Riyadh')::date - 1
              order by r.last_day desc limit 1), 0)                  as current_streak,
    coalesce((select max(r.len) from runs r), 0)                     as max_streak;
$$;

revoke all on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;
