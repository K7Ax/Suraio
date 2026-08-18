-- Round 2 (2026-06-22). Applied to prod via Supabase MCP apply_migration.
-- A2: per-user daily rate limiting for the Groq-backed AI functions.
-- A dedicated counter table (RLS-locked: no client policies => unreachable via the
-- public API) plus a SECURITY DEFINER bump function the Edge Functions call.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default ((now() at time zone 'Asia/Riyadh')::date),
  kind    text not null,
  count   int  not null default 0,
  primary key (user_id, day, kind)
);
alter table public.ai_usage enable row level security;
-- intentionally NO policies: only bump_ai_usage (SECURITY DEFINER) touches it.

-- Atomically increment today's counter for (user, kind) and report whether the
-- caller is still within the cap. Returns false for anon (no auth.uid()).
create or replace function public.bump_ai_usage(p_kind text, p_cap int)
returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare uid uuid := auth.uid(); d date := (now() at time zone 'Asia/Riyadh')::date; c int;
begin
  if uid is null then return false; end if;
  insert into public.ai_usage(user_id, day, kind, count)
    values (uid, d, p_kind, 1)
  on conflict (user_id, day, kind)
    do update set count = ai_usage.count + 1
  returning count into c;
  return c <= greatest(p_cap, 1);
end; $$;

revoke execute on function public.bump_ai_usage(text, int) from public, anon;
grant  execute on function public.bump_ai_usage(text, int) to authenticated;
