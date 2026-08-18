-- «لعبت —» و«فوز —» بجوار سلسلةٍ مشتعلة  (نتيجة التدقيق P2-3)
--
-- داخل `my_stats()` الواحدة كانت ثلاثة تعريفاتٍ لـ«لعبت»:
--   • «السلسلة» تعدّ الأيّام من `level_started` **و** `daily_started`.
--   • `played`  تعدّ `level_started` وحدها.
--   • `wins`    تعدّ `level_completed` وحدها.
-- و`finishDaily` تُطلق `daily_finished` عمدًا لا `level_completed`
-- (‏`src/main.js`، ومعه تعليقٌ يشرح لماذا يجب أن يبقى القُمعان منفصلين).
--
-- فمن يلعب «تحدي اليوم» وحده — وهو ما يدفعه المنتَج كلّ يومٍ لكلّ لعبة — يقرأ
-- «لعبت —» و«فوز —» بجوار سلسلةٍ من أيّامٍ متّصلة. والفراغ يُرسم «—» لا «٠»
-- (‏docs/identity.md §83)، فيبدو الأمر عطبًا في الإحصاء لا فراغًا حقيقيًّا —
-- وهو بالضبط الشكوى التي كُتب الترحيلُ السابق ليجيب عنها.
--
-- الاختيار هنا: **يوحَّد المقياس على أوسع التعريفات الثلاثة** — أي التعريف
-- الذي تستعمله «السلسلة» أصلًا — فتصير الأعمدة الأربعة تجيب عن سؤالٍ واحد.
-- ولم تُقسَم اللوحة إلى عمودين (حملة/يوميّ) لأنّ ذلك تغييرُ واجهةٍ لم يُطلَب.
--
-- وطيُّ الصدى (خمس ثوانٍ · نفس اللعبة · نفس المستوى) يبقى كما هو، **ويُطبَّق
-- الآن على `wins` أيضًا**: كان `wins` بلا طيٍّ بينما `played` مطويّة، فلوحٌ
-- أُتمّ مرّتين كان يستطيع دفع «فوز» فوق «لعبت» — رقمٌ مستحيلٌ على وجهه.
--
-- يُلصَق في محرّر SQL. `create or replace` — غير هدّام، وآمنُ الإعادة.

create or replace function public.my_stats()
returns table (played bigint, wins bigint, current_streak int, max_streak int)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as uid),
  days as (
    select distinct (e.created_at at time zone 'Asia/Riyadh')::date as ksa_day
    from public.game_events e, me
    where e.user_id = me.uid
      and e.event_type in ('level_started', 'daily_started')
  ),
  islands as (
    select ksa_day,
           ksa_day - (row_number() over (order by ksa_day))::int as grp
    from days
  ),
  runs as (
    select count(*)::int as len, max(ksa_day) as last_day
    from islands group by grp
  ),
  -- كلّ حدثٍ ومعه سابقُه، مقيَّدًا بنوعه ولعبته ومستواه: فارقٌ دون خمس ثوانٍ
  -- = صدًى لا محاولةٌ ثانية. `daily_*` يُقسَّم كذلك بـ`event_type` كي لا
  -- يطوي بدءُ اليوميّ بدءَ الحملة على نفس اللعبة.
  ev as (
    select e.event_type,
           e.created_at,
           lag(e.created_at) over (
             partition by e.event_type, e.game_type, e.level_number
             order by e.created_at
           ) as prev_at
    from public.game_events e, me
    where e.user_id = me.uid
      and e.event_type in ('level_started', 'daily_started',
                           'level_completed', 'daily_finished')
  ),
  deduped as (
    select event_type from ev
    where prev_at is null or created_at - prev_at >= interval '5 seconds'
  )
  select
    (select count(*) from deduped
      where event_type in ('level_started', 'daily_started'))     as played,
    (select count(*) from deduped
      where event_type in ('level_completed', 'daily_finished'))  as wins,
    coalesce((select r.len from runs r
              where r.last_day >= (now() at time zone 'Asia/Riyadh')::date - 1
              order by r.last_day desc limit 1), 0)               as current_streak,
    coalesce((select max(r.len) from runs r), 0)                  as max_streak;
$$;

revoke all on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;
