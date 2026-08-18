# Security Policy

Sura runs a **live production service** at [suraio.com](https://suraio.com) with
real user accounts. Please read this before testing anything.

## Reporting a vulnerability

Email **khalid.alzahem@gmail.com** with `[SURA SECURITY]` in the subject.

Please include what you found, the steps to reproduce it, and what an attacker
could do with it. If you have a proof of concept, a description is enough — do
not attach working exploit code to the first message.

You will get an acknowledgement within **72 hours**. This is a one-person
project, not a funded program: there is no bounty, and a fix may take longer
than a company's would. Findings are credited in the release notes unless you
ask otherwise.

Please give a reasonable window before disclosing publicly. If a report goes
unanswered for two weeks, treat that as the window having closed.

## What you may test

Anything in this repository, running **locally**. Clone it, point it at your own
Supabase project, and attack it as hard as you like.

## What you may not do

- **No automated scanning against production.** No fuzzers, no vulnerability
  scanners, no credential-stuffing, no load generators against `suraio.com` or
  the `*.supabase.co` endpoints it uses. The backend runs on a free tier; a
  scanner is indistinguishable from a denial-of-service attempt and will simply
  take the site down for real players.
- **Do not touch accounts that are not yours.** Register your own; do not access,
  modify, or exfiltrate another user's data, submissions, or streaks.
- **Do not write to the leaderboard.** If you find a way to forge a result,
  report it — do not demonstrate it on the live board.

Staying inside these lines means a report is welcome. Outside them, it is an
attack on a live service with real users.

## What is *not* a vulnerability

Two things get reported often enough to name here:

**The Supabase anon key in `index.html` is public by design.** It is a
publishable key. Authorization comes from Row Level Security on every table, not
from the key being secret. Finding it in the page source is not a finding; using
it to read a row you should not be able to read *is*, and is exactly the kind of
report this policy wants.

**Edge Function names are visible in network traffic.** That is inherent to
calling them from a browser. The secret is the service role key, which exists
only in the Supabase function environment and never in this repository or the
bundle.

## Scope

| In scope | Out of scope |
|---|---|
| The web client (`src/`, `index.html`, the built `app.js`) | Supabase, Cloudflare, Groq, and Resend themselves — report those upstream |
| Edge Functions in `supabase/functions/` | Denial of service, volumetric or otherwise |
| RLS policies, RPCs, and migrations under `supabase/` | Missing security headers with no demonstrated impact |
| Authentication, session handling, and account recovery | Social engineering, physical access, or anything requiring a compromised device |
| Anything letting a client forge a score, XP total, or streak | Findings that need an already-compromised admin account |

## How this project handles security

The trust model, and three rounds of findings that were located and closed
(including a leaderboard-forgery hole that let any signed-in user POST a perfect
score directly to the REST API), are written up in
[`docs/security/security.md`](docs/security/security.md) — including the
mechanism of each fix, not just the fact of it.
