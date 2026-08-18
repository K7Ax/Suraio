-- ============================================================
-- سُرى — إعداداتُ الموقع + فتحُ التحليلات للبوت
-- ‏١٥ أغسطس ٢٠٢٦ · الإطلاق ٤
--
-- الصقها كاملةً في: Supabase → SQL Editor → Run. إضافيّةٌ بالكامل وقابلةٌ
-- لإعادة التشغيل. لا تمسّ الدخول ولا المصادقة ولا أيّ جدولٍ قائم.
-- ============================================================


-- ────────────────────────────────────────
-- 1/3 — جدولُ الإعدادات: صفٌّ واحدٌ لا غير
-- ────────────────────────────────────────
-- **ما هو، بصراحة:** لوحُ إعلانٍ يتحكّم به المالك بلا نشرٍ جديد. لا أكثر.
-- ليس بوّابةَ صلاحيّات ولا مفتاحَ إطفاءٍ للموقع — وأيُّ مفتاحٍ من ذلك النوع
-- يجب أن يُفرَض في الخادم لا في المتصفّح، وإلّا فهو مسرحٌ لا أمن. فلم يُبنَ.
--
-- ‏`id boolean primary key default true` + قيدُ `check (id)`: حيلةٌ معروفة
-- تجعل الجدولَ **عاجزًا** عن حمل أكثر من صفّ. البديلُ — «اقرأ أحدثَ صفّ» —
-- يفتح بابَ صفَّين متضاربين لا يعرف أحدٌ أيُّهما الحقّ.
create table if not exists public.site_settings (
    id                boolean primary key default true,
    announcement      text        not null default '',
    announcement_kind text        not null default 'info',
    updated_at        timestamptz not null default now(),
    updated_by        text,
    constraint site_settings_singleton check (id),
    constraint site_settings_kind      check (announcement_kind in ('info', 'warn')),
    -- سقفٌ في طبقة البيانات لا في الواجهة: الشريطُ يُقرأ في سطرٍ أو سطرين،
    -- ونصٌّ من ألفِ حرفٍ يكسر التخطيط ويُشحن لكلّ زائر.
    constraint site_settings_len       check (char_length(announcement) <= 280)
);

insert into public.site_settings (id) values (true) on conflict (id) do nothing;

alter table public.site_settings enable row level security;

-- القراءة للجميع: هذا **إعلانٌ علنيّ**، غرضُه أن يراه الزائرُ قبل أن يسجّل.
drop policy if exists site_settings_read on public.site_settings;
create policy site_settings_read on public.site_settings
    for select to anon, authenticated using (true);

-- ولا سياسةَ كتابةٍ إطلاقًا. الكتابةُ تمرّ حصرًا بالدالّة أدناه، فلا يوجد
-- مسارٌ يستطيع فيه مفتاحُ المتصفّح العلنيُّ أن يكتب سطرًا يراه كلّ الناس.


-- ────────────────────────────────────────
-- 2/3 — الكتابة: دالّةٌ واحدةٌ مبوّبة
-- ────────────────────────────────────────
create or replace function public.set_site_settings(
    p_announcement text default '',
    p_kind         text default 'info'
) returns public.site_settings
language plpgsql volatile security definer set search_path = public, auth as $$
declare
    row public.site_settings;
begin
    if not public.is_sura_admin() then
        raise exception 'not authorized' using errcode = 'P0001';
    end if;

    update public.site_settings set
        announcement      = coalesce(btrim(p_announcement), ''),
        announcement_kind = case when p_kind = 'warn' then 'warn' else 'info' end,
        updated_at        = now(),
        updated_by        = coalesce(auth.jwt() ->> 'email', 'service')
    where id
    returning * into row;

    return row;
end $$;

revoke all on function public.set_site_settings(text, text) from public;
grant execute on function public.set_site_settings(text, text) to authenticated;


-- ────────────────────────────────────────
-- 3/3 — ‏is_sura_admin يقبل service_role كذلك
-- ────────────────────────────────────────
-- **لماذا هذا ليس تخفيفًا للأمن:** مفتاحُ service_role يتجاوز RLS أصلًا ويقرأ
-- كلّ جدولٍ في القاعدة مباشرةً. فمنعُه من `dash_overview()` لم يكن يحمي شيئًا —
-- كان يجبر البوت على إعادة كتابة كلّ استعلامٍ تجميعيٍّ بيده، فتنشأ نسخةٌ ثانيةٌ
-- من التعريفات تنجرف عن الأولى بصمت (وهو بالضبط العطبُ الذي أُصلح اليوم في
-- ‏`dashboard.js`). فالمكسبُ تعريفٌ واحدٌ للرقم، والكلفةُ صفر.
--
-- ويبقى الحدُّ الحقيقيّ كما هو: المفتاحُ خادميٌّ فقط، لا يُشحن في متصفّح ولا
-- يُكتب في مستودع.
create or replace function public.is_sura_admin()
returns boolean
language sql stable security definer set search_path = public, auth as $$
    select coalesce(auth.jwt() ->> 'email', '') = 'khalid.alzahem@gmail.com'
        or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
$$;


-- ────────────────────────────────────────
-- التحقّق — شغّله فورًا بعد اللصق
-- ────────────────────────────────────────
-- الشيفرةُ فُحصت في المتصفّح، لكنّ **صلاحيّاتِ هذه الكائنات لا يمكن إثباتُها
-- قبل تطبيقها** — فلا تُصدَّق سليمةً حتى تعود هذه الأسطرُ الأربعة بما هو مكتوب
-- بجانبها. وحتّى ذلك الحين، الحكمُ عليها: «غيرُ متحقَّق منه».
--
-- 1) صفٌّ واحدٌ لا غير:
--      select count(*) from public.site_settings;                  -- ‏1
--
-- 2) الجدولُ محميّ، وله سياسةُ قراءةٍ واحدةٌ ولا سياسةَ كتابةٍ إطلاقًا:
--      select relrowsecurity from pg_class where oid = 'public.site_settings'::regclass;   -- ‏t
--      select cmd, count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'site_settings' group by cmd;          -- ‏SELECT | 1  (ولا سطرَ غيره)
--
-- 3) الكتابةُ ممنوعةٌ على المفتاح العلنيّ. تُجرَّب من **المتصفّح** لا من هنا،
--    لأنّ محرّرَ SQL يعمل بصلاحيّةٍ كاملةٍ ولا يمثّل الزائر. في وحدة تحكّم
--    الموقع (بلا تسجيل دخول):
--      await __sura.sb.from('site_settings').update({ announcement: 'اختراق' }).eq('id', true)
--    المتوقّع: صفرُ صفوفٍ متأثّرة أو خطأ صلاحيّات — **لا** كتابةٌ ناجحة.
--      await __sura.sb.rpc('set_site_settings', { p_announcement: 'اختراق', p_kind: 'info' })
--    المتوقّع: ‏`not authorized`.
--
-- 4) البوت يقرأ الدوالَّ نفسها: أرسل `/stats` في تلغرام.
--    المتوقّع: أرقام. وإن جاء «لا صلاحية» فالجزءُ الثالثُ من الهجرة لم يُطبَّق.
