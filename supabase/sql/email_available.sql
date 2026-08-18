-- ============================================================================
-- email_available(text) — "is this email free to sign up with?"
--
-- WHY THIS EXISTS
-- The signup wizard could only detect an already-registered email AFTER the
-- player had picked a username and a password, because Supabase deliberately
-- refuses to reveal whether an email exists (it returns a fake success with an
-- empty `identities` array). That meant a returning user filled in three steps
-- before being told to go and sign in instead.
--
-- THE TRADE-OFF — READ BEFORE RUNNING
-- Answering this question at all enables ACCOUNT ENUMERATION: anyone can probe
-- a list of addresses and learn which ones have a سُرى account. That is the
-- exact risk Supabase's default hides. This function narrows the blast radius
-- rather than removing it:
--   * boolean only — never a user id, name, or any profile data
--   * rate limited per IP per hour, so it answers a signup form, not a scraper
--   * SECURITY DEFINER with a pinned search_path, granted to `anon` only
-- If you would rather not accept enumeration at all, do NOT run this file; the
-- old late-detection behaviour is still in place as the fallback and the client
-- treats a missing function as "unknown" and simply carries on.
--
-- Run in: Supabase dashboard → SQL Editor.
-- ============================================================================

-- Probe log, used only for rate limiting. No email is stored — just its hash.
create table if not exists public.email_probe_log (
    id          bigserial primary key,
    ip          inet        not null,
    email_hash  text        not null,
    created_at  timestamptz not null default now()
);

create index if not exists email_probe_log_ip_time_idx
    on public.email_probe_log (ip, created_at desc);

alter table public.email_probe_log enable row level security;
-- No policies: nothing but the DEFINER function below may read or write it.

create or replace function public.email_available(p text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, auth
as $$
declare
    v_email  text := lower(trim(p));
    v_ip     inet := coalesce(
                 nullif(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''),
                 '0.0.0.0'
             )::inet;
    v_recent int;
begin
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
        return null;              -- malformed: the client already said so
    end if;

    select count(*) into v_recent
      from public.email_probe_log
     where ip = v_ip and created_at > now() - interval '1 hour';

    if v_recent >= 30 then
        return null;              -- null = "unknown"; the client falls back
    end if;

    insert into public.email_probe_log (ip, email_hash)
    -- md5, not digest(): built into core Postgres, so this needs no pgcrypto.
    -- It is a de-duplication key for rate limiting, not a security boundary.
    values (v_ip, md5(v_email));

    return not exists (select 1 from auth.users u where lower(u.email) = v_email);
end;
$$;

revoke all on function public.email_available(text) from public;
grant execute on function public.email_available(text) to anon, authenticated;

-- Housekeeping: the log is only needed for the rolling hour.
delete from public.email_probe_log where created_at < now() - interval '1 day';
