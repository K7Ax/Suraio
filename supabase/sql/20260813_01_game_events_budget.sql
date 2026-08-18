-- Sura — سقفُ إدخالٍ لكلّ جهازٍ على public.game_events  (نتيجة التدقيق F1)
--
-- المشكلة. `game_events` هي **الجدول الوحيد** في المخطّط الذي يستطيع متصفّحٌ
-- الكتابةَ فيه، وسياستُه `for insert to anon, authenticated` بلا أيّ سقف. وقد
-- أُثبت ذلك حيًّا في التدقيق: إدخالٌ مجهولٌ وصل إلى طبقة القيود (رمز 23514)
-- لا إلى طبقة RLS (‏42501) — أي أنّ RLS سمحت به. وعليه:
--   • كلّ رقمٍ في «الدستور» — نِسَب الإتمام، `dash_level_health`، `dash_funnel`،
--     `report_month()` — محسوبٌ من جدولٍ يستطيع غريبٌ حشوَه.
--   • و‏PostgREST يقبل مصفوفةً في الجسم، فطلبٌ واحدٌ يكتب آلاف الصفوف على
--     قاعدةٍ سقفُها ٥٠٠ ميغا.
--
-- ولماذا لا تُحذف السياسة. لأنّ حذفها يقتل التحليلات كلّها بصمت — وهو ما
-- حذّر منه التقرير نصًّا. المطلوب سقفٌ لا بابٌ مغلق.
--
-- الحلّ هنا: مُشغّلٌ قبل الإدخال يعدّ ما كتبه الجهاز نفسه في الساعة الماضية.
-- والعدّ لا يمسح الجدول: `offset N limit 1` يتوقّف عند الصفّ رقم N+1 على
-- الفهرس `game_events_device_time_idx` القائم — أي عملٌ ثابتٌ لا ينمو بحجم
-- الجدول. ولاعبٌ حقيقيّ لا يقترب من السقف: جلسةٌ محمومةٌ من ساعةٍ كاملة تكتب
-- بضع عشراتٍ من الأحداث، والسقف ٣٠٠.
--
-- يُلصَق في محرّر SQL. غير هدّام، وآمنُ الإعادة.

create or replace function public.game_events_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- مفتاحُ العدّ: الجهاز إن وُجد، وإلّا الجلسة (‏`session_id` NOT NULL دائمًا).
  k text := coalesce(new.device_id, new.session_id);
  hit boolean;
begin
  if k is null then
    return new;
  end if;

  select true into hit
  from public.game_events
  where coalesce(device_id, session_id) = k
    and created_at > now() - interval '1 hour'
  offset 300 limit 1;

  if hit then
    -- ‏`P0001` مع رسالةٍ صريحة: العميل يبتلعها (‏`track` لا يعرض شيئًا للاعب)،
    -- لكنّ من يقرأ السجلّ يعرف أنّ هذا سقفٌ لا عطب.
    raise exception 'game_events hourly budget exceeded for this device'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists game_events_budget_trg on public.game_events;
create trigger game_events_budget_trg
  before insert on public.game_events
  for each row execute function public.game_events_budget();

-- الاحتفاظ. الجدول بلا حدٍّ زمنيّ، والتحليلات كلّها شهريّة — فما مضى عليه
-- ١٨٠ يومًا لا يُقرأ من أحد. هذه الدالّة تُنادى يدويًّا أو تُجدوَل بـpg_cron
-- (‏`select cron.schedule('game_events_prune','0 4 * * *',$$select
-- public.game_events_prune()$$);`) — ولا تُجدوَل هنا كي لا يُفرَض امتدادٌ على
-- المشروع دون قرار المالك.
create or replace function public.game_events_prune()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  delete from public.game_events where created_at < now() - interval '180 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.game_events_prune() from public, anon, authenticated;
