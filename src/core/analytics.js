// ‏قياسُ الاستعمال — مُجمَّعٌ ومحصورٌ في أنّه لا يكسر لعبةً أبدًا.
//
// ‏تُنادى من `main.js` بعد إنشاء `window.__sura` مباشرةً وقبل أيّ شيءٍ يقيس،
// لأنّها هي من يركّب `window.__sura.track`.
import { sb, SURA } from './supabaseClient.js';
import { suraDailySeed } from './util.js';

export function initAnalytics() {
    function rid() {
        try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { }
        return 'x' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    }
    // stable anonymous device id (persists across sessions) + per-tab session id
    let deviceId, sessionId;
    try { deviceId = localStorage.getItem('sura.device_id') || (localStorage.setItem('sura.device_id', deviceId = rid()), deviceId); }
    catch (e) { deviceId = rid(); }
    try { sessionId = sessionStorage.getItem('sura.session_id') || (sessionStorage.setItem('sura.session_id', sessionId = rid()), sessionId); }
    catch (e) { sessionId = rid(); }

    // --- batching -------------------------------------------------------
    // A visit that opens six games fired 21 separate inserts — 75% of every
    // request the site makes. They are queued here and sent as one bulk
    // insert instead.
    //
    // The flush uses fetch(keepalive) rather than navigator.sendBeacon.
    // sendBeacon cannot set headers, and the RLS check on game_events is
    // (user_id IS NULL OR user_id = auth.uid()) — so a beacon, running as
    // anon, would have every signed-in player's row rejected unless we
    // nulled user_id first. keepalive survives unload AND carries the
    // Authorization header, which is the whole requirement.
    const MAX_BATCH = 12;      // bounds the body well under the 64KB keepalive cap
    const FLUSH_MS = 10000;    // ceiling on how stale a queued event can get
    let queue = [];
    let flushTimer = null;
    let accessToken = null;

    // The token has to be readable SYNCHRONOUSLY: a pagehide flush has no
    // time to await getSession().
    if (sb) {
        try {
            sb.auth.getSession().then(function (r) {
                accessToken = (r && r.data && r.data.session) ? r.data.session.access_token : null;
            }, function () { });
            sb.auth.onAuthStateChange(function (_evt, session) {
                // Flush BEFORE the identity changes. Rows already queued carry
                // the old user_id, and RLS rejects the whole batch if even one
                // row's user_id disagrees with the token we would send.
                flush();
                accessToken = session ? session.access_token : null;
            });
        } catch (e) { /* analytics must never break gameplay */ }
    }

    function flush() {
        if (!queue.length || !sb) return;
        const rows = queue;
        queue = [];
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        try {
            const headers = {
                'Content-Type': 'application/json',
                apikey: SURA.SUPABASE_ANON_KEY,
                Authorization: 'Bearer ' + (accessToken || SURA.SUPABASE_ANON_KEY),
                Prefer: 'return=minimal'
            };
            fetch(SURA.SUPABASE_URL + '/rest/v1/game_events', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(rows),
                keepalive: true
            }).then(function () { }, function () { });
        } catch (e) { /* analytics must never break gameplay */ }
    }

    function track(eventType, props) {
        props = props || {};
        try {
            if (!sb) return;
            const uid = (window.__sura && window.__sura.__uid) || null;
            queue.push({
                user_id: (uid && uid !== 'anon') ? uid : null,
                session_id: sessionId,
                device_id: deviceId,
                game_type: props.game || props.game_type || null,
                level_number: (props.level != null) ? props.level : null,
                event_type: eventType,
                metadata: props.metadata || {}
            });
            if (queue.length >= MAX_BATCH) flush();
            else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
        } catch (e) { /* analytics must never break gameplay */ }
    }

    // Rage-quits happen immediately before the tab closes, so the tail of a
    // session is the most interesting part of it — losing it to a timer that
    // never fired would defeat the point of collecting any of this.
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
    });
    window.__sura.track = track;

    // session start + daily-return detection
    try {
        if (!sessionStorage.getItem('sura.visited')) {
            sessionStorage.setItem('sura.visited', '1');
            track('site_visit', {});
        }
    } catch (e) { track('site_visit', {}); }
    try {
        const today = String(suraDailySeed());
        const last = localStorage.getItem('sura.last_visit_day');
        if (last && last !== today) track('daily_return', { metadata: { from: last, to: today } });
        localStorage.setItem('sura.last_visit_day', today);
    } catch (e) { }
}
