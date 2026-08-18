// core/streak — «السلسلة اليوميّة»: how many days in a row the player showed up
// for «تحدي اليوم».
//
// WHY IT IS ITS OWN MODULE AND NOT THREE LINES INSIDE finishDaily: the same rule
// has to hold in three places — the browser (so an anonymous or offline player
// sees a streak at all), the `submit-daily` Edge Function (the only writer of the
// server row), and the tests. Two of those are different languages, so a shared
// import is impossible; what IS possible is a single readable definition here
// that the function mirrors line for line, with a test that reads both files. The
// repo already does exactly this for `normalize_arabic` — see tests/normalize.test.js.
//
// THE RULE, stated once:
//   • Finishing today's challenge on a day you already finished changes nothing.
//     It is idempotent, not additive — six Friday games are still one day.
//   • Yesterday → today extends the streak by one.
//   • Any other gap resets it to 1. Not to 0: you DID play today, and a counter
//     that reads «٠» the moment you come back after a break punishes the return.
//   • `max` only ever rises.
//
// WHAT IS DELIBERATELY NOT HERE: a freeze/streak-saver. The daily already has one
// safety net in `main.js` (the once-a-day retry), and stacking a second forgiveness
// mechanism on a 24-hour window makes the number mean nothing. If it is ever added
// it belongs in the Edge Function, where it can be rate-limited — never here,
// where a client could grant itself one every day.

import { dayNumber } from './daily.mjs';

// prev: { current, max, lastDay }  — lastDay is a YYYYMMDD int, or null/0 if never.
// Returns the NEW state plus what happened, so the caller can decide what to say
// without re-deriving it (and without a second, drifting copy of the comparison).
export function advanceStreak(prev, todayInt) {
    const p = prev || {};
    const cur = Math.max(0, p.current | 0);
    const max = Math.max(0, p.max | 0);
    const last = (p.lastDay | 0) || 0;
    const today = todayInt | 0;

    if (last === today) {
        return { current: cur, max, lastDay: last, changed: false, already: true, extended: false, reset: false };
    }
    // Exactly one day apart — computed on the day COUNTER, never on the YYYYMMDD
    // integer, which jumps by ~70 at every month boundary and would break every
    // streak that crossed the 1st of a month.
    const continued = last > 0 && (dayNumber(today) - dayNumber(last)) === 1;
    const current = continued ? cur + 1 : 1;
    return {
        current, max: Math.max(current, max), lastDay: today,
        changed: true, already: false,
        extended: continued,
        reset: !continued && cur > 0
    };
}

// Is a stored streak still alive as of `todayInt`, or has the player already let
// it lapse? Read-only — used to render the flame honestly BEFORE today's play,
// so a broken streak is not displayed as if it were intact.
export function streakAsOf(prev, todayInt) {
    const p = prev || {};
    const cur = Math.max(0, p.current | 0);
    const last = (p.lastDay | 0) || 0;
    if (!last || !cur) return 0;
    const gap = dayNumber(todayInt | 0) - dayNumber(last);
    return (gap === 0 || gap === 1) ? cur : 0;   // today or yesterday ⇒ still standing
}
