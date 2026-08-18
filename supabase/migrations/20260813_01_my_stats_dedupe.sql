-- «لعبتَ ٥٧» — والمالك لم يلعب هذا القدر. بلاغه في ١٣ أغسطس ٢٠٢٦.
--
-- السبب سببان، وكلاهما مقيسٌ على حسابه (username = 'fff'):
--
--   ١. إطلاقٌ مزدوج في العميل. ضغطُ «التالي ←» أو اختيارُ مستوًى من المنتقي
--      كان يطلق `level_started` مباشرةً، ثمّ `onChange` تعيد بناء اللوح
--      فتنادي اللعبةُ `startLevel()` فيُطلق ثانيةً. القياس: من ٥٨ حدثًا،
--      **١٩ مكرّرٌ خلال ٣ ثوانٍ** من مثيله بنفس اللعبة ونفس المستوى.
--      أُصلح في `src/main.js` — لكنّ الأحداث المخزَّنة تبقى.
--
--   ٢. المعنى نفسه. «لعبت» كانت تعدّ **بدءَ لوح**، فإعادةُ المحاولة على
--      نفس اللوح تُحسب لعبةً جديدة. عدد الألواح المختلفة التي بدأها
--      المالك فعلًا: **١٨**، وأتمّ ١٧.
--
-- هذا الترحيل يعالج (١) وحده: يطوي أيّ `level_started` يقع خلال خمس ثوانٍ
-- من سابقٍ له بنفس اللعبة ونفس المستوى. خمسٌ لا ثلاث: النافذة يجب أن تسع
-- جهازًا بطيئًا يتأخّر في إعادة البناء، ولا تسع لاعبًا خسر لوحًا وأعاده
-- عمدًا — وأسرع إعادةٍ حقيقيّة في القياس كانت أبعد من ذلك بكثير.
--
-- ولا يعالج (٢): «هل تعني لعبتَ عددَ المحاولات أم عددَ الألواح؟» قرارُ
-- منتَجٍ لا قرارُ إصلاح، وهو معلَّقٌ على المالك.
--
-- ما عدا `played` يبقى كما هو حرفيًّا: `wins` و«السلسلة» لم يشملهما البلاغ،
-- و`level_completed` لا يُطلق إلا من مسارٍ واحد فلا ازدواج فيه.

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
  -- كلّ بدءٍ ومعه سابقُه في الزمن، مقيَّدًا بنفس اللعبة ونفس المستوى: فإن
  -- كان الفارق دون خمس ثوانٍ فهو الصدى لا محاولةً ثانية.
  starts as (
    select e.created_at,
           lag(e.created_at) over (
             partition by e.game_type, e.level_number order by e.created_at
           ) as prev_at
    from public.game_events e, me
    where e.user_id = me.uid and e.event_type = 'level_started'
  )
  select
    (select count(*) from starts s
      where s.prev_at is null
         or s.created_at - s.prev_at >= interval '5 seconds')        as played,
    (select count(*) from public.game_events e, me
      where e.user_id = me.uid and e.event_type = 'level_completed') as wins,
    coalesce((select r.len from runs r
              where r.last_day >= (now() at time zone 'Asia/Riyadh')::date - 1
              order by r.last_day desc limit 1), 0)                  as current_streak,
    coalesce((select max(r.len) from runs r), 0)                     as max_streak;
$$;

revoke all on function public.my_stats() from public, anon;
grant execute on function public.my_stats() to authenticated;
