-- لوحة الصدارة تعرض **اسم المستخدم** لا الاسم المعروض
-- =============================================================================
-- بأمر المالك (١٢ أغسطس ٢٠٢٦): «المقصود بالاسم اسم المستخدم الي هو الـusername».
--
-- لماذا هذا خادميّ لا عميليّ: `display_name` وحده هو ما يخرج من الدالّتين، و
-- `username` لا يصل المتصفّح أصلًا — فلا سبيل للعميل أن يبحث بما لا يملك.
--
-- ولماذا بقي اسم العمود `display_name`: هو عقد الدالّة الذي تقرأه
-- `get-leaderboard` والعميل. تغييره يكسر الاثنين بلا مقابل — المطلوب تغيير
-- **القيمة** لا التسمية. والاحتياط `display_name` باقٍ خلفه: حسابٌ قديم بلا
-- اسم مستخدم يظهر باسمه المعروض بدل أن يختفي من اللوحة.
--
-- التطبيق: لصقٌ يدويّ في SQL Editor (لا `supabase db push` — docs/ai-agent-rules).
-- آمنة للتكرار: `create or replace` فقط، بلا DDL على الجداول وبلا لمس RLS.
begin;

create or replace function public.get_global_leaderboard(p_limit int default 20)
returns table (display_name text, total_xp bigint, rank_tier int,
               games_cleared int, rank bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(p.username, ''), p.display_name, 'لاعب') as display_name,
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

-- النسخة الحيّة من هذه الدالّة كانت في الإنتاج وحده (تقرير الأمن A20)، فهذه
-- أوّل مرّة يدخل جسدها المستودع. نُسخ حرفيًّا من الإنتاج ولم يتغيّر فيه سوى
-- سطر الاسم، كي تبقى الترتيبات والحدود كما هي بالضبط.
create or replace function public.get_leaderboard_today(p_game_type text default null, p_limit int default 20)
returns table (game_type text, display_name text, score int, attempts smallint,
               time_seconds int, rank bigint)
language sql stable security definer set search_path = public as $$
  with todays as (
    select s.*, d.game_type as gtype, d.puzzle_date
    from public.submissions s
    join public.daily_puzzles d on d.id = s.puzzle_id
    where s.completed = true
      and d.puzzle_date = (now() at time zone 'Asia/Riyadh')::date
      and (p_game_type is null or d.game_type = p_game_type)
  )
  select
    t.gtype as game_type,
    coalesce(nullif(p.username, ''), p.display_name, 'لاعب') as display_name,
    t.score,
    t.attempts,
    t.time_seconds,
    rank() over (partition by t.puzzle_id order by t.score desc, t.time_seconds asc nulls last) as rank
  from todays t
  left join public.profiles p on p.id = t.user_id
  order by score desc, time_seconds asc nulls last
  limit greatest(1, least(p_limit, 100));
$$;

revoke execute on function public.get_leaderboard_today(text, int) from public;
grant execute on function public.get_leaderboard_today(text, int) to anon, authenticated;

commit;
