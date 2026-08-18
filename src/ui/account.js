// ‏نافذةُ الحساب — الاسمُ وكلمةُ المرور والإحصاءاتُ والمكانةُ والسجلّ.
//
// ‏لا تلتقط شيئًا من نطاق `DOMContentLoaded`: كلُّ ما تحتاجه إمّا استيرادُ وحدة
// ‏(`sb` و`arNum` و`escapeHtmlShared`) أو سطحٌ عامٌّ تقرأه من `window.__sura`
// وقتَ النداء لا وقتَ التركيب — وهذا الفرقُ هو ما جعل نقلَها آمنًا: `meta`
// و`ranks` و`openAuth` و`openVerifyOtp` و`refreshNav` قد لا تكون مركَّبةً بعدُ
// حين تُنادى هذه الدالّة، وكلُّها تُقرأ داخل مُعالِجاتٍ تعمل بعد ذلك بكثير.
//
// ‏وهي تركّب ثلاثةَ مداخلَ على `window.__sura`: `openAccount` و
// ‏`refreshAccountStats` و`refreshStanding`.
import { sb } from '../core/supabaseClient.js';
import { arNum, escapeHtmlShared } from '../core/util.js';

export function initAccount() {
    if (!sb) return;
    const modal = document.getElementById('account-modal');
    if (!modal) return;
    const closeBtn = document.getElementById('account-modal-close');
    const greeting = document.getElementById('account-greeting');
    const errBox = document.getElementById('account-error');
    const okBox = document.getElementById('account-success');
    const verifyBanner = document.getElementById('account-verify-banner');
    const verifyNowBtn = document.getElementById('account-verify-now');
    const unameForm = document.getElementById('account-username-form');
    const unameInput = document.getElementById('account-username');
    const unameHint = document.getElementById('account-username-hint');
    const pwForm = document.getElementById('account-password-form');
    const newPw = document.getElementById('account-new-password');
    const newPwConfirm = document.getElementById('account-new-password-confirm');
    const pwReqHint = document.getElementById('account-pw-req-hint');
    const pwMatchHint = document.getElementById('account-pw-match-hint');
    const statsEl = {
        played: document.getElementById('stat-played'),
        wins: document.getElementById('stat-wins'),
        streak: document.getElementById('stat-streak'),
        best: document.getElementById('stat-best')
    };
    const historyEl = document.getElementById('account-history');
    const signoutBtn = document.getElementById('account-signout');

    const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

    let busy = false;
    async function withBusy(btn, fn) {
        if (busy) return; busy = true;
        const prev = btn.textContent; btn.disabled = true; btn.textContent = '...';
        try { await fn(); } finally { busy = false; btn.disabled = false; btn.textContent = prev; }
    }
    function showError(msg) { okBox.classList.remove('visible'); okBox.textContent=''; errBox.textContent = msg; errBox.classList.add('visible'); }
    function showSuccess(msg) { errBox.classList.remove('visible'); errBox.textContent=''; okBox.textContent = msg; okBox.classList.add('visible'); }
    function clearMessages() { errBox.classList.remove('visible'); errBox.textContent=''; okBox.classList.remove('visible'); okBox.textContent=''; }

    function close() { modal.classList.remove('active'); clearMessages(); }
    closeBtn && closeBtn.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) close(); });

    // Password show/hide toggles within this modal (auth IIFE already wired the auth modal's)
    modal.querySelectorAll('.pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const next = input.type === 'password' ? 'text' : 'password';
            input.type = next;
            btn.textContent = next === 'password' ? 'إظهار' : 'إخفاء';
        });
    });

    // الأربعة كلّها من `my_stats()` — مشتقّةً من game_events في الخادم.
    //
    // كانت تُجمَع من `streaks`، وهو جدولٌ فارغٌ في الإنتاج (لا يكتبه إلا
    // `submit-guess`، مسارُ «تحدي اليوم» القديم الذي هجرته الألعاب الستّ).
    // فكان «لعبت» و«فوز» يخرجان **بالرقم نفسه** حرفيًّا — كلاهما عددُ صفوف
    // player_progress — و«السلسلة» و«أفضل سلسلة» صفرًا أبديًّا. وذلك بلاغ
    // المالك «الإحصائيات لا تعمل» (١٢ أغسطس ٢٠٢٦).
    //
    // `userId` لم يعد يُمرَّر: الدالّة تقرأ `auth.uid()` في الخادم، فلا
    // يستطيع حسابٌ أن يطلب إحصاءات غيره. أُبقي الوسيط لأن المنادين يمرّرونه.
    async function loadStats(userId) {
        const dash = () => { statsEl.played.textContent = statsEl.wins.textContent =
            statsEl.streak.textContent = statsEl.best.textContent = '—'; };
        try {
            const { data, error } = await sb.rpc('my_stats');
            const r = Array.isArray(data) ? data[0] : data;
            if (error || !r) return dash();
            // «—» لا «٠» للفراغ (docs/architecture/identity.md §83): لاعبٌ لم يبدأ بعدُ
            // ليس لاعبًا نتيجتُه صفر.
            const box = (el, n) => { el.textContent = n ? arNum(n) : '—'; };
            box(statsEl.played, r.played);
            box(statsEl.wins, r.wins);
            box(statsEl.streak, r.current_streak);
            box(statsEl.best, r.max_streak);
        } catch (e) { dash(); }
    }

    // Authoritative account standing from player_totals (server-owned).
    // SINGLE SOURCE OF TRUTH for the account's XP: it drives the level bar too,
    // so the panel never shows two competing XP numbers. The local per-win "+N"
    // toasts stay as momentary juice, but the persisted total shown here is the
    // server's (band-based) figure — the exact one that ranks you globally,
    // unified across devices and beyond client tampering.
    async function loadStanding(userId) {
        const box = document.getElementById('account-standing');
        const lvlEl = document.getElementById('account-level');
        const xpEl = document.getElementById('account-xp');
        const fillEl = document.getElementById('account-xp-fill');
        let t = null;
        try {
            const r = await sb.from('player_totals')
                .select('total_xp,rank_tier,games_cleared').eq('user_id', userId).maybeSingle();
            t = r.data;
        } catch (e) { /* fall through to the zero state */ }
        const xp = (t && t.total_xp) ? Number(t.total_xp) : 0;
        // The level bar reads the authoritative XP (one number everywhere).
        const meta = window.__sura.meta;
        const info = (meta && meta.xp.infoOf) ? meta.xp.infoOf(xp) : { level: 1, pct: 0 };
        if (lvlEl) lvlEl.textContent = `المستوى ${arNum(info.level)}`;
        if (xpEl) xpEl.textContent = `${arNum(xp)} نقطة خبرة`;
        if (fillEl) fillEl.style.width = `${info.pct}%`;
        if (!box) return;
        if (!t || !xp) { box.classList.add('hidden'); return; }
        try {
            // Global rank. This used to COUNT player_totals directly, which
            // only worked because that table was readable by anyone — audit
            // finding A10, since closed by 20260810_01_rls_tighten.sql. The
            // count now lives in get_my_rank(), a SECURITY DEFINER function
            // that takes no arguments and returns one integer: the caller's
            // own rank, and nothing that could be asked about anyone else.
            //
            // The old query would NOT have errored under the new policy — it
            // would have returned 0 and shown every player as #1. Silence is
            // why this line moved in the same round as the policy.
            const { data: myRank } = await sb.rpc('get_my_rank');
            const rank = Number(myRank) || 1;
            const TIERS = (window.__sura.ranks && window.__sura.ranks.TIERS) || [];
            const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, t.rank_tier | 0))] || { name: '—', icon: '🎖️' };
            // No XP here — the bar above already shows it (single number).
            const rankEl = document.getElementById('standing-rank');
            const globalEl = document.getElementById('standing-global');
            const gamesEl = document.getElementById('standing-games');
            if (rankEl) rankEl.innerHTML = `${tier.icon} <b>${escapeHtmlShared(tier.name)}</b>`;
            if (globalEl) globalEl.innerHTML = `🌍 ترتيبك <b>#${arNum(rank)}</b>`;
            if (gamesEl) gamesEl.innerHTML = `🎮 ${arNum(t.games_cleared || 0)} ألعاب`;
            box.classList.remove('hidden');
        } catch (e) { box.classList.add('hidden'); }
    }

    // Saudi badges only. The XP/level bar is owned by loadStanding (server
    // authoritative) so it is NOT set here — that avoids the local optimistic
    // number briefly overwriting the authoritative one after a win.
    function refreshAccountStats() {
        const meta = window.__sura.meta;
        if (!meta) return;
        const badgesEl = document.getElementById('account-badges');
        if (badgesEl) {
            const have = new Set(meta.badges.unlocked());
            badgesEl.innerHTML = meta.badges.all().map(b =>
                `<span class="badge-chip${have.has(b.id) ? '' : ' locked'}" title="${escapeHtmlShared(b.name)}">${b.icon} ${escapeHtmlShared(b.name)}</span>`
            ).join('');
        }
    }
    window.__sura.refreshAccountStats = refreshAccountStats;
    // Live-refresh the authoritative standing line after a credited win, so an
    // open account panel updates without reopening. No-op while it's hidden.
    window.__sura.refreshStanding = async () => {
        try { const { data: { user } } = await sb.auth.getUser(); if (user) loadStanding(user.id); } catch (e) { }
    };

    async function loadHistory(userId) {
        try {
            const { data } = await sb.from('submissions')
                .select('completed,attempts,score,submitted_at,game_type')
                .eq('user_id', userId)
                .order('submitted_at', { ascending: false })
                .limit(8);
            if (!data || !data.length) { historyEl.innerHTML = '<p class="auth-hint">لا يوجد سجل بعد. العب لتظهر نتائجك هنا.</p>'; return; }
            historyEl.innerHTML = data.map(r => {
                const d = r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('ar-u-nu-latn') : '';
                const cls = r.completed ? 'hist-win' : 'hist-loss';
                const label = r.completed ? `فوز (${arNum(r.attempts)} محاولات)` : 'لم يكتمل';
                return `<div class="hist-row"><span>${escapeHtmlShared(d)}</span><span class="${cls}">${label}</span><span>${arNum(r.score || 0)} نقطة</span></div>`;
            }).join('');
        } catch (e) {
            historyEl.innerHTML = '<p class="auth-hint">تعذّر تحميل السجل.</p>';
        }
    }

    async function open() {
        clearMessages();
        const { data: { session } } = await sb.auth.getSession();
        if (!session) { if (window.__sura.openAuth) window.__sura.openAuth('signin'); return; }
        // Server-authoritative user (getSession's cached JWT can carry a stale email_confirmed_at).
        const { data: { user: u } } = await sb.auth.getUser();
        if (!u) { if (window.__sura.openAuth) window.__sura.openAuth('signin'); return; }
        modal.classList.add('active');
        // Verify banner
        const verified = !!(u.email_confirmed_at || u.confirmed_at);
        verifyBanner.hidden = verified;
        // Greeting + current username
        let uname = '';
        try {
            const { data } = await sb.from('profiles').select('username,display_name').eq('id', u.id).maybeSingle();
            if (data) { uname = data.username || ''; greeting.textContent = (data.display_name || u.email) + (verified ? '' : ' — بريد غير مُفعّل'); }
        } catch (e) {}
        if (unameInput) { unameInput.value = uname; unameInput.dataset.current = uname; }
        unameHint.textContent = 'حروف إنجليزية وأرقام و«_» فقط (3–20).';
        unameHint.classList.remove('ok','bad');
        loadStats(u.id);
        loadHistory(u.id);
        refreshAccountStats();
        loadStanding(u.id);
    }
    window.__sura.openAccount = open;

    // Live availability check on username input
    if (unameInput && unameHint) {
        let timer = null;
        unameInput.addEventListener('input', () => {
            const val = unameInput.value.trim().toLowerCase();
            unameHint.classList.remove('ok','bad');
            if (timer) clearTimeout(timer);
            if (!val) { unameHint.textContent = 'حروف إنجليزية وأرقام و«_» فقط (3–20).'; return; }
            if (val === (unameInput.dataset.current || '')) { unameHint.textContent = 'هذا اسمك الحالي.'; return; }
            if (!USERNAME_RE.test(val)) { unameHint.textContent = 'حروف إنجليزية صغيرة وأرقام و«_» فقط (3–20).'; unameHint.classList.add('bad'); return; }
            unameHint.textContent = 'جارٍ التحقق…';
            timer = setTimeout(async () => {
                try {
                    const { data, error } = await sb.rpc('username_available', { p: val });
                    if (error) { unameHint.textContent = ''; return; }
                    if (data) { unameHint.textContent = 'متاح ✓'; unameHint.classList.add('ok'); }
                    else { unameHint.textContent = 'غير متاح أو غير مسموح.'; unameHint.classList.add('bad'); }
                } catch (e) { unameHint.textContent = ''; }
            }, 450);
        });
    }

    // Save username
    unameForm && unameForm.addEventListener('submit', async (e) => {
        e.preventDefault(); clearMessages();
        const val = String(unameInput.value || '').trim().toLowerCase();
        if (val === (unameInput.dataset.current || '')) return showError('لم تُغيّر اسم المستخدم.');
        if (!USERNAME_RE.test(val)) return showError('اسم المستخدم يجب أن يكون حروفاً إنجليزية وأرقاماً و«_» فقط (3–20).');
        await withBusy(document.getElementById('account-username-submit'), async () => {
            const { error } = await sb.rpc('set_username', { p: val });
            if (error) {
                const m = (error.message || '').toLowerCase();
                if (m.includes('taken')) return showError('اسم المستخدم محجوز. اختر اسماً آخر.');
                if (m.includes('not_allowed')) return showError('اسم المستخدم غير مسموح.');
                if (m.includes('format')) return showError('صيغة اسم المستخدم غير صحيحة.');
                if (m.includes('not_authenticated')) return showError('انتهت الجلسة. سجّل الدخول مجدداً.');
                return showError('تعذّر حفظ اسم المستخدم.');
            }
            unameInput.dataset.current = val;
            // set_username also syncs display_name, so re-render every surface
            // that shows the name: the nav button, and the account greeting here.
            if (window.__sura && window.__sura.refreshNav) window.__sura.refreshNav();
            if (greeting) greeting.textContent = val;
            showSuccess('تم حفظ اسم المستخدم.');
        });
    });

    // Live password conditions (length + match), mirroring the signup form
    function updatePwHints() {
        const a = String(newPw.value || ''); const b = String(newPwConfirm.value || '');
        if (pwReqHint) {
            pwReqHint.classList.remove('ok','bad');
            if (!a) { pwReqHint.textContent = '8 أحرف على الأقل.'; }
            else if (a.length < 8) { pwReqHint.textContent = `8 أحرف على الأقل (${arNum(a.length)}/${arNum(8)}).`; pwReqHint.classList.add('bad'); }
            else { pwReqHint.textContent = 'طول مناسب ✓'; pwReqHint.classList.add('ok'); }
        }
        if (pwMatchHint) {
            pwMatchHint.classList.remove('ok','bad');
            if (!b) { pwMatchHint.textContent = ''; }
            else if (a === b) { pwMatchHint.textContent = 'متطابقتان ✓'; pwMatchHint.classList.add('ok'); }
            else { pwMatchHint.textContent = 'كلمتا المرور غير متطابقتين.'; pwMatchHint.classList.add('bad'); }
        }
    }
    newPw && newPw.addEventListener('input', updatePwHints);
    newPwConfirm && newPwConfirm.addEventListener('input', updatePwHints);

    // Change password
    pwForm && pwForm.addEventListener('submit', async (e) => {
        e.preventDefault(); clearMessages();
        const a = String(newPw.value || ''); const b = String(newPwConfirm.value || '');
        if (a.length < 8 || a.length > 128) return showError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
        if (a !== b) return showError('كلمتا المرور غير متطابقتين.');
        await withBusy(document.getElementById('account-password-submit'), async () => {
            const { error } = await sb.auth.updateUser({ password: a });
            if (error) {
                const m = (error.message || '').toLowerCase();
                if (m.includes('different') || m.includes('should be different')) {
                    return showError('كلمة المرور الجديدة يجب أن تختلف عن القديمة.');
                }
                if (m.includes('weak') || m.includes('at least') || m.includes('characters')) {
                    return showError('كلمة المرور ضعيفة جداً. استخدم 8 أحرف على الأقل.');
                }
                if (m.includes('reauth') || m.includes('session') || m.includes('jwt') || m.includes('expired')) {
                    return showError('انتهت الجلسة. سجّل الخروج ثم الدخول وأعد المحاولة.');
                }
                return showError('تعذّر تحديث كلمة المرور: ' + (error.message || 'حاول مجدداً.'));
            }
            newPw.value = ''; newPwConfirm.value = '';
            if (pwReqHint) { pwReqHint.textContent = '8 أحرف على الأقل.'; pwReqHint.classList.remove('ok','bad'); }
            if (pwMatchHint) { pwMatchHint.textContent = ''; pwMatchHint.classList.remove('ok','bad'); }
            showSuccess('تم تحديث كلمة المرور بنجاح.');
        });
    });

    // Verify-now -> open OTP flow
    verifyNowBtn && verifyNowBtn.addEventListener('click', async () => {
        const { data: { session } } = await sb.auth.getSession();
        close();
        if (window.__sura.openVerifyOtp) window.__sura.openVerifyOtp(session && session.user ? session.user.email : '');
    });

    // Sign out
    signoutBtn && signoutBtn.addEventListener('click', async () => {
        try { await sb.auth.signOut(); } catch (e) {}
        close();
    });
}
