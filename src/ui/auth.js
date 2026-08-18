// ============================================================
// Sura Auth — secure email/password signup, signin, reset
// ============================================================
//
// ‏أخطرُ كتلةٍ في المشروع، لأنَّ انحدارَها الصّامت يكلّف اللّاعبَ حسابَه
// ‏لا إعادةَ رسم. تملك: بوّابةَ البريد الواحدة التي توجّه إلى
// ‏«دخول» أو «إنشاء»، والمعالجَ ثلاثيَّ الخطوات، ورمزَ التّحقّق
// ‏(OTP)، واستعادةَ كلمة المرور، وGoogle، ومطالبةَ اسم المستخدم.
//
// ‏تُسجّل على `window.__sura`: `openAuth` و`openVerifyOtp` و`refreshNav`.
//
// ‏وتُنادى مبكّراً كما كانت بالضبط: تقرأ جلسةَ Supabase من
// ‏الـURL عند الإقلاع (استعادةٌ أو تأكيدٌ أو عودةٌ من Google)،
// ‏فتأخيرُها يعني أنَّ شيئًا آخرَ قد يمسح الـhash قبلَ أن تقرأه.
//
// ‏وهي تخرج بلا عملٍ إن لم يكن `sb` موجوداً — وهذا مقصود: الموقع
// ‏يُلعَب بلا حساب، فغيابُ العميل يُسقِط الدّخول وحدَه لا اللّعب.
// ============================================================
import { sb, SURA_URL_HASH } from '../core/supabaseClient.js';
import * as D from '../core/daily.mjs';

export function initAuth() {
    if (!sb) return;

    const authModal = document.getElementById('auth-modal');
    const authClose = document.getElementById('auth-modal-close');
    const tabs = document.querySelectorAll('.auth-tab');
    const formSignin = document.getElementById('auth-signin-form');
    const formSignup = document.getElementById('auth-signup-form');
    const formReset = document.getElementById('auth-reset-form');
    const formNewPw = document.getElementById('auth-newpw-form');
    const formOtp = document.getElementById('auth-otp-form');
    const formClaim = document.getElementById('auth-claim-form');
    const errBox = document.getElementById('auth-error');
    const okBox = document.getElementById('auth-success');
    const forgotLink = document.getElementById('auth-forgot-link');
    const backSigninLink = document.getElementById('auth-back-signin');
    // Email-first (merged) entry: one email field decides sign-in vs. register.
    const formGate = document.getElementById('auth-gate-form');
    const gateEmail = document.getElementById('gate-email');
    const emailChip = document.getElementById('auth-emailchip');
    const emailChipVal = document.getElementById('auth-emailchip-val');
    const emailChipChange = document.getElementById('auth-emailchip-change');
    const signinCross = document.getElementById('auth-signin-cross');
    const signupCross = document.getElementById('auth-signup-cross');
    // Auth lives in the nav bar: #login-button toggles to user's name when signed in,
    // and #logout-button (sibling) appears next to it.
    const loginBtn = document.getElementById('login-button');
    const logoutBtn = document.getElementById('logout-button');
    const loginBtnOriginalText = loginBtn ? loginBtn.textContent : 'تسجيل الدخول';

    if (!authModal) return;

    // ---- Validation helpers ----
    // Conservative email regex (RFC-5322 simplified). Browser native validation also runs.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const NAME_RE = /^[\p{L}\p{N}_ \-\.]{2,40}$/u; // letters (any script) + digits + a few safe chars
    const USERNAME_RE = /^[a-z0-9_]{3,20}$/; // English lowercase + digits + underscore, matches backend CHECK
    const MIN_PW = 8;

    // Live username availability check against the backend RPC (format + profanity + uniqueness)
    // true = free · false = taken · null = unknown (RPC not deployed, rate
    // limited, or offline). Null must never block signup — the post-submit
    // check in the signup handler stays as the backstop.
    async function checkEmailAvailable(email) {
        try {
            const { data, error } = await sb.rpc('email_available', { p: email });
            if (error) return null;
            return (data === true || data === false) ? data : null;
        } catch (e) { return null; }
    }
    async function checkUsernameAvailable(username) {
        try {
            const { data, error } = await sb.rpc('username_available', { p: username });
            if (error) return null; // unknown — don't block on transient errors
            return !!data;
        } catch (e) { return null; }
    }
    // Debounced live-validation wiring for a username input + hint element
    function wireUsernameField(input, hint, opts) {
        if (!input || !hint) return;
        opts = opts || {};
        let timer = null;
        const baseHint = hint.textContent;
        input.addEventListener('input', () => {
            const raw = input.value.trim();
            const val = raw.toLowerCase();
            hint.classList.remove('ok', 'bad');
            if (timer) clearTimeout(timer);
            if (!raw) { hint.textContent = baseHint; return; }
            if (!USERNAME_RE.test(val)) {
                hint.textContent = 'حروف إنجليزية صغيرة وأرقام و«_» فقط (3–20).';
                hint.classList.add('bad');
                return;
            }
            if (opts.current && val === opts.current) {
                hint.textContent = 'هذا اسمك الحالي.';
                return;
            }
            hint.textContent = 'جارٍ التحقق…';
            timer = setTimeout(async () => {
                const ok = await checkUsernameAvailable(val);
                if (ok === true) { hint.textContent = 'متاح ✓'; hint.classList.add('ok'); }
                else if (ok === false) { hint.textContent = 'غير متاح أو غير مسموح. جرّب اسماً آخر.'; hint.classList.add('bad'); }
                else { hint.textContent = baseHint; }
            }, 450);
        });
    }

    function isStrongPassword(pw) {
        if (typeof pw !== 'string') return false;
        return pw.length >= MIN_PW && pw.length <= 128;
    }
    function pwScore(pw) {
        let s = 0;
        if (!pw) return 0;
        if (pw.length >= 10) s++;
        if (pw.length >= 14) s++;
        if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
        if (/\d/.test(pw)) s++;
        if (/[^A-Za-z0-9]/.test(pw)) s++;
        return Math.min(s, 5);
    }
    function sanitizeName(n) {
        const s = String(n || '');
        const banned = '<>"\'`\\';
        let out = '';
        for (const ch of s) {
            const code = ch.charCodeAt(0);
            if (code < 0x20 || code === 0x7f) continue;
            if (banned.indexOf(ch) !== -1) continue;
            out += ch;
        }
        return out.trim().slice(0, 40);
    }
    function showError(msg) {
        okBox.classList.remove('visible'); okBox.textContent = '';
        errBox.textContent = msg || 'حدث خطأ. حاول مجدداً.';
        errBox.classList.add('visible');
    }
    function showSuccess(msg) {
        errBox.classList.remove('visible'); errBox.textContent = '';
        okBox.textContent = msg;
        okBox.classList.add('visible');
    }
    function clearMessages() {
        errBox.classList.remove('visible'); errBox.textContent = '';
        okBox.classList.remove('visible'); okBox.textContent = '';
    }
    // Map Supabase auth errors to specific, actionable messages.
    function friendlyError(err) {
        const msg = (err && (err.message || err.error_description || '')).toLowerCase();
        const code = (err && (err.code || err.error || '')).toString().toLowerCase();
        if (!msg && !code) return 'حدث خطأ غير متوقع. حاول مجدداً.';
        // --- OTP / token (signup confirm, magic link). Supabase returns the same
        //     "expired or is invalid" string/code for both wrong AND expired codes. ---
        if (msg.includes('expired or is invalid') || msg.includes('expired or invalid'))
            return 'رمز التحقق غير صحيح أو انتهت صلاحيته. تأكد من الرمز كما وصلك، أو اطلب رمزاً جديداً عبر «إعادة إرسال الرمز».';
        if (code.includes('otp_expired') || (msg.includes('expired') && (msg.includes('token') || msg.includes('otp'))))
            return 'انتهت صلاحية الرمز. اطلب رمزاً جديداً عبر «إعادة إرسال الرمز».';
        if ((msg.includes('invalid') || msg.includes('incorrect')) && (msg.includes('token') || msg.includes('otp')))
            return 'رمز التحقق غير صحيح. تأكد من الرمز كما وصلك في البريد وحاول مجدداً.';
        // --- Sign in ---
        if (msg.includes('email not confirmed') || (msg.includes('email') && msg.includes('not') && msg.includes('confirm')))
            return 'بريدك غير مُفعّل بعد. أدخل رمز التحقق المرسل إلى بريدك أولاً.';
        if (msg.includes('invalid login credentials') || (msg.includes('invalid') && msg.includes('credentials')))
            return 'البريد أو كلمة المرور غير صحيحة.';
        // --- Sign up ---
        if (msg.includes('user already registered') || msg.includes('already been registered') || msg.includes('user already'))
            return 'هذا البريد مسجَّل بالفعل. سجّل الدخول أو استخدم «نسيت كلمة المرور».';
        if (code.includes('email_address_invalid') || msg.includes('email_address_invalid') || (msg.includes('email') && msg.includes('invalid')))
            return 'صيغة البريد غير مقبولة. جرّب بريداً آخر.';
        if (msg.includes('password should be at least') || msg.includes('weak password') || (msg.includes('password') && msg.includes('short')))
            return 'كلمة المرور قصيرة جداً. استخدم 8 أحرف على الأقل.';
        // --- Rate limiting ---
        if (code.includes('over_email_send_rate_limit') || msg.includes('rate limit') || msg.includes('too many') || msg.includes('email rate'))
            return 'حاولت كثيراً خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.';
        // --- Connectivity ---
        if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('networkerror'))
            return 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.';
        // Fall back to the server's own message when we have one (better than a blank generic).
        return (err && err.message) ? ('تعذّر إتمام العملية: ' + err.message) : 'تعذّر إتمام العملية. حاول مجدداً.';
    }

    // ---- Modal open/close ----
    function openAuth(tab = 'gate') {
        clearMessages();
        // The email gate is the single entry for both sign-in and register, so
        // any caller asking for one of those simply starts at the gate.
        if (tab === 'signin' || tab === 'signup') tab = 'gate';
        if (tab === 'gate') authModal.classList.remove('merged');
        switchTab(tab);
        authModal.classList.add('active');
        setTimeout(() => {
            const focusEl = tab === 'gate' ? gateEmail
                : tab === 'otp' ? document.getElementById('otp-code')
                : tab === 'reset' ? document.getElementById('reset-email')
                : null;
            if (focusEl) focusEl.focus();
        }, 50);
    }
    // While the username claim is open the modal is MODAL in the real sense:
    // every dismissal path funnels through closeAuth(), so gating it here
    // covers the close button, the backdrop click and Escape at once.
    let claimLock = false;
    function closeAuth() {
        if (claimLock) return;
        authModal.classList.remove('active');
        clearMessages();
    }
    authClose && authClose.addEventListener('click', closeAuth);
    authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuth(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && authModal.classList.contains('active')) closeAuth();
    });
    if (loginBtn) {
        loginBtn.addEventListener('click', (e) => {
            e.preventDefault(); // don't follow href="#login"
            // Signed in -> open account settings; signed out -> open sign-in.
            if (loginBtn.dataset.signedIn) {
                if (window.__sura && window.__sura.openAccount) window.__sura.openAccount();
            } else {
                openAuth('gate');
            }
        });
    }

    function switchTab(name) {
        clearMessages();
        tabs.forEach(t => {
            const active = t.dataset.tab === name;
            t.classList.toggle('active', active);
            t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        if (formGate) formGate.hidden = name !== 'gate';
        formSignin.hidden = name !== 'signin';
        formSignup.hidden = name !== 'signup';
        formReset.hidden = name !== 'reset';
        formOtp.hidden = name !== 'otp';
        if (formNewPw) formNewPw.hidden = name !== 'newpw';
        if (formClaim) formClaim.hidden = name !== 'claim';
        // «سجّل الدخول لحفظ تقدمك» is addressed to a signed-OUT visitor; the
        // claim view only ever appears to someone already signed in, where it
        // reads as a contradiction. The form carries its own intro line.
        const sub = document.getElementById('auth-subtitle');
        if (sub) sub.hidden = name === 'claim';
        // The old signin/signup tab strip is retired by the email gate.
        const tabStrip = document.querySelector('.auth-tabs');
        if (tabStrip) tabStrip.style.display = 'none';
        // Google + the email field are one entry point: OAuth shows on the gate only.
        const oauth = document.getElementById('auth-oauth');
        if (oauth) oauth.style.display = (name === 'gate') ? '' : 'none';
        // Email chip + cross-links belong to the merged signin/signup views.
        const merged = authModal.classList.contains('merged');
        if (emailChip) emailChip.hidden = !(merged && (name === 'signin' || name === 'signup'));
        if (signinCross) signinCross.hidden = !(merged && name === 'signin');
        if (signupCross) signupCross.hidden = !(merged && name === 'signup');
        if (name === 'signup') wizGo(1);
    }

    // ---- Email-first routing (gate → signin | signup) ----
    function setEmailChip(email) { if (emailChipVal) emailChipVal.textContent = email; }
    function goSignin(email) {
        const el = document.getElementById('signin-email');
        if (el) el.value = email;            // hidden in merged mode, but the submit reads it
        authModal.classList.add('merged');
        setEmailChip(email);
        switchTab('signin');
        const p = document.getElementById('signin-password');
        if (p) { p.value = ''; setTimeout(() => p.focus(), 60); }
    }
    function goSignup(email) {
        const el = document.getElementById('signup-email');
        if (el) el.value = email;
        authModal.classList.add('merged');
        setEmailChip(email);
        switchTab('signup');
        wizGo(2);                            // email already collected → start at username
        const u = document.getElementById('signup-username');
        if (u && !matchMedia('(hover: none)').matches) setTimeout(() => u.focus(), 60);
    }

    // ---- Sequential signup wizard (email → username → password) ----
    const wizSteps = () => Array.from(document.querySelectorAll('#auth-signup-form .wiz-step'));
    const wizDots = () => Array.from(document.querySelectorAll('#auth-signup-form .wiz-dot'));
    function wizGo(n) {
        wizSteps().forEach(s => { s.hidden = Number(s.dataset.step) !== n; });
        wizDots().forEach((d, i) => d.classList.toggle('on', i < n));
        const active = wizSteps().find(s => Number(s.dataset.step) === n);
        const input = active && active.querySelector('input');
        // Focus the one field on screen, but not on touch — the keyboard
        // slamming open on every step transition is worse than one extra tap.
        if (input && !matchMedia('(hover: none)').matches) setTimeout(() => input.focus(), 60);
    }
    // Each step validates only its own field, so an error points at the box in
    // front of you instead of one three screens back.
    async function wizValidate(step) {
        clearMessages();
        if (step === 1) {
            const email = String(document.getElementById('signup-email').value || '').trim().toLowerCase();
            if (!EMAIL_RE.test(email) || email.length > 254) { showError('صيغة البريد غير صحيحة.'); return false; }
            // Catch an already-registered email HERE, not after they have also
            // picked a username and a password. Returns null when the RPC is
            // absent or rate-limited, in which case we carry on and the old
            // post-submit detection still catches it.
            const free = await checkEmailAvailable(email);
            if (free === false) {
                showError('هذا البريد مسجَّل بالفعل. سجّل الدخول أو استخدم «نسيت كلمة المرور».');
                switchTab('signin');
                document.getElementById('signin-email').value = email;
                return false;
            }
            return true;
        }
        if (step === 2) {
            const username = String(document.getElementById('signup-username').value || '').trim().toLowerCase();
            if (!USERNAME_RE.test(username)) { showError('اسم المستخدم يجب أن يكون حروفاً إنجليزية وأرقاماً و«_» فقط (3–20).'); return false; }
            // Catch a taken name here rather than after they've picked a password.
            const available = await checkUsernameAvailable(username);
            if (available === false) { showError('اسم المستخدم غير متاح. اختر اسماً آخر.'); return false; }
            return true;
        }
        return true;
    }
    document.querySelectorAll('#auth-signup-form .wiz-next').forEach(btn => {
        btn.addEventListener('click', async () => {
            const from = Number(btn.closest('.wiz-step').dataset.step);
            btn.disabled = true;
            try { if (await wizValidate(from)) wizGo(Number(btn.dataset.goto)); }
            finally { btn.disabled = false; }
        });
    });
    document.querySelectorAll('#auth-signup-form .wiz-back').forEach(btn => {
        btn.addEventListener('click', () => { clearMessages(); wizGo(Number(btn.dataset.goto)); });
    });
    // Enter advances instead of submitting a half-filled form from step 1.
    document.getElementById('auth-signup-form').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const step = e.target.closest && e.target.closest('.wiz-step');
        if (!step || Number(step.dataset.step) === 3) return;
        e.preventDefault();
        const nextBtn = step.querySelector('.wiz-next');
        if (nextBtn) nextBtn.click();
    });

    // ---- OAuth (Google) ----
    // Apple was removed: it needs a paid Apple Developer account + a
    // Services ID, so the button could only ever have been dead here.
    // The handler stays provider-generic if it is ever added back.
    // Requires the provider to be enabled in the Supabase dashboard; until then
    // Supabase returns "provider is not enabled" and we say so plainly rather
    // than leaving a dead button.
    document.querySelectorAll('.oauth-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const provider = btn.dataset.provider;
            clearMessages();
            btn.disabled = true;
            try {
                const { error } = await sb.auth.signInWithOAuth({
                    provider,
                    options: { redirectTo: window.location.origin + window.location.pathname }
                });
                if (error) {
                    const m = (error.message || '').toLowerCase();
                    if (m.includes('not enabled') || m.includes('unsupported')) {
                        showError('هذه الطريقة غير مفعّلة بعد. استخدم البريد الإلكتروني.');
                    } else {
                        showError(friendlyError(error));
                    }
                }
                // On success the browser navigates away; nothing else to do.
            } catch (e) {
                showError('تعذّر بدء تسجيل الدخول. حاول مرة أخرى.');
            } finally {
                btn.disabled = false;
            }
        });
    });
    tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    forgotLink && forgotLink.addEventListener('click', () => {
        // Carry the email forward — in merged mode the signin email field is hidden.
        const known = (document.getElementById('signin-email').value || gateEmail.value || '').trim();
        const rEmail = document.getElementById('reset-email');
        if (rEmail && known) rEmail.value = known;
        switchTab('reset');
    });
    backSigninLink && backSigninLink.addEventListener('click', () => switchTab('signin'));

    const verifyLink = document.getElementById('auth-verify-link');
    const otpBack = document.getElementById('auth-otp-back');
    const resendOtpBtn = document.getElementById('auth-resend-otp');

    // Send the signup-confirmation CODE. Uses auth.resend(type:'signup'), which triggers the
    // "Confirm signup" template (the one that carries {{ .Token }}) — so the email contains a
    // CODE, not a link. Only UNCONFIRMED accounts need this; a confirmed account has nothing to
    // verify, so we route it to sign-in instead of sending a useless link.
    async function sendSignupCode(email) {
        if (!EMAIL_RE.test(email)) { showError('صيغة البريد غير صحيحة.'); return false; }
        const { error } = await sb.auth.resend({ type: 'signup', email });
        if (error) {
            const m = (error.message || '').toLowerCase();
            const code = (error.code || '').toString().toLowerCase();
            if (m.includes('already') && m.includes('confirm')) {
                showSuccess('بريدك مُفعّل بالفعل — سجّل الدخول بكلمة المرور.');
                document.getElementById('signin-email').value = email;
                setTimeout(() => switchTab('signin'), 1200);
                return true;
            }
            if (m.includes('rate') || m.includes('too many') || (m.includes('email') && m.includes('send')) || code.includes('rate')) {
                showSuccess('أرسلنا لك رمزاً مؤخراً. تحقق من بريدك (وSpam) أو انتظر دقيقة قبل طلب رمز جديد.');
                return true;
            }
            showError(friendlyError(error));
            return false;
        }
        showSuccess('أرسلنا رمز التحقق إلى بريدك. افحص أيضاً مجلد الـ Spam.');
        return true;
    }

    verifyLink && verifyLink.addEventListener('click', async () => {
        clearMessages();
        const email = (document.getElementById('signin-email').value || '').trim().toLowerCase();
        const password = String(document.getElementById('signin-password').value || '');
        if (!EMAIL_RE.test(email)) {
            return showError('أدخل بريدك في خانة الدخول أولاً، ثم انقر «تحقق ببريدك (رمز)».');
        }
        await withBusy(verifyLink, async () => {
            // Probe with the password first (no email side-effect): a verified account just
            // signs in — sending a "code" would be a lie since resend() silently no-ops on
            // confirmed accounts. Only an unconfirmed account ("email not confirmed") needs a code.
            if (password.length >= 8) {
                const { error } = await sb.auth.signInWithPassword({ email, password });
                if (!error) {
                    showSuccess('بريدك مُفعّل بالفعل — تم تسجيل دخولك.');
                    setTimeout(closeAuth, 700);
                    return;
                }
                const m = (error.message || '').toLowerCase();
                const unconfirmed = m.includes('not confirmed') || (m.includes('email') && m.includes('confirm'));
                if (!unconfirmed) {
                    // Wrong password / unknown email — surface the real reason, don't send a code.
                    return showError(friendlyError(error));
                }
                // else: genuinely unconfirmed — fall through and send the code.
            }
            document.getElementById('otp-email').value = email;
            switchTab('otp');
            await sendSignupCode(email);
        });
    });
    otpBack && otpBack.addEventListener('click', () => switchTab('signin'));

    // ---- Show/hide password toggles ---- (scope to the auth modal; the account modal wires its own)
    document.querySelectorAll('#auth-modal .pw-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (!input) return;
            const next = input.type === 'password' ? 'text' : 'password';
            input.type = next;
            btn.textContent = next === 'password' ? 'إظهار' : 'إخفاء';
            btn.setAttribute('aria-label', next === 'password' ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
        });
    });

    // ---- Password strength meter ----
    const pwBar = document.getElementById('pw-strength-bar');
    const signupPw = document.getElementById('signup-password');
    signupPw && signupPw.addEventListener('input', () => {
        const s = pwScore(signupPw.value);
        const pct = (s / 5) * 100;
        const colors = ['#ef4444', '#f59e0b', '#eab308', '#84cc16', '#22c55e'];
        pwBar.style.width = pct + '%';
        pwBar.style.backgroundColor = colors[Math.max(0, Math.min(s - 1, 4))] || '#ef4444';
    });

    // ---- Live username availability (signup) ----
    wireUsernameField(
        document.getElementById('signup-username'),
        document.getElementById('signup-username-hint')
    );

    // No confirm-password field any more: the show/hide toggle lets you read
    // what you typed, which catches typos without a fifth box to fill.

    // ---- Anti double-submit (Supabase enforces server-side rate limits) ----
    let busy = false;
    async function withBusy(btn, fn) {
        if (busy) return; busy = true;
        const prev = btn.textContent;
        btn.disabled = true; btn.textContent = '...';
        try { await fn(); } finally { busy = false; btn.disabled = false; btn.textContent = prev; }
    }

    // ---- Sign in ----
    formSignin.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const email = String(document.getElementById('signin-email').value || '').trim().toLowerCase();
        const password = String(document.getElementById('signin-password').value || '');
        if (!EMAIL_RE.test(email)) return showError('صيغة البريد غير صحيحة.');
        if (password.length < 8) return showError('كلمة المرور قصيرة جداً.');
        await withBusy(document.getElementById('auth-signin-submit'), async () => {
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) {
                const m = (error.message || '').toLowerCase();
                // Unconfirmed email is a distinct, recoverable case — guide straight to OTP verify.
                if (m.includes('not confirmed') || (m.includes('email') && m.includes('confirm'))) {
                    showError('بريدك غير مُفعّل بعد. أدخل رمز التحقق المرسل إلى بريدك لتفعيله.');
                    document.getElementById('otp-email').value = email;
                    setTimeout(() => switchTab('otp'), 900);
                    return;
                }
                // Everything else (wrong password / unknown email) shares one message by design.
                showError(friendlyError(error));
                return;
            }
            showSuccess('تم الدخول. أهلاً بك!');
            setTimeout(closeAuth, 600);
        });
    });

    // ---- Email gate: decide sign-in vs. register from the email alone ----
    formGate && formGate.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const email = String(gateEmail.value || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email) || email.length > 254) return showError('صيغة البريد غير صحيحة.');
        await withBusy(document.getElementById('auth-gate-submit'), async () => {
            const free = await checkEmailAvailable(email);
            if (free === false) {
                goSignin(email);                 // account exists → password only
            } else if (free === true) {
                goSignup(email);                 // no account → username + password
            } else {
                // Unknown (RPC rate-limited / offline): default to sign-in and let the
                // cross-link cover the "actually I'm new" case.
                goSignin(email);
                showSuccess('أدخل كلمة المرور. إن لم يكن لديك حساب، اضغط «ليس لديك حساب؟».');
            }
        });
    });
    emailChipChange && emailChipChange.addEventListener('click', () => {
        authModal.classList.remove('merged');
        const prev = (document.getElementById('signin-email').value
            || document.getElementById('signup-email').value || '').trim();
        if (gateEmail && prev) gateEmail.value = prev;
        switchTab('gate');
        setTimeout(() => gateEmail && gateEmail.focus(), 60);
    });
    // Cross-links for the RPC-unknown case or a mis-route.
    const toSignupLink = document.getElementById('auth-to-signup');
    const toSigninLink = document.getElementById('auth-to-signin');
    toSignupLink && toSignupLink.addEventListener('click', () => {
        const email = String(document.getElementById('signin-email').value || gateEmail.value || '').trim().toLowerCase();
        goSignup(email);
    });
    toSigninLink && toSigninLink.addEventListener('click', () => {
        const email = String(document.getElementById('signup-email').value || gateEmail.value || '').trim().toLowerCase();
        goSignin(email);
    });

    // ---- Sign up ----
    formSignup.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const username = String(document.getElementById('signup-username').value || '').trim().toLowerCase();
        const email = String(document.getElementById('signup-email').value || '').trim().toLowerCase();
        const password = String(document.getElementById('signup-password').value || '');
        // Seeded from the username (which already satisfies NAME_RE's charset)
        // and editable later — one less box between a stranger and playing.
        const display_name = sanitizeName(username);
        // Steps 1 and 2 were validated on the way in; re-check so a pasted or
        // autofilled value can't slip past by skipping the wizard.
        if (!EMAIL_RE.test(email) || email.length > 254) { wizGo(1); return showError('صيغة البريد غير صحيحة.'); }
        if (!USERNAME_RE.test(username)) { wizGo(2); return showError('اسم المستخدم يجب أن يكون حروفاً إنجليزية وأرقاماً و«_» فقط (3–20).'); }
        if (!NAME_RE.test(display_name)) { wizGo(2); return showError('اسم المستخدم غير صالح.'); }
        if (!isStrongPassword(password)) return showError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
        await withBusy(document.getElementById('auth-signup-submit'), async () => {
            // Pre-check username so the user isn't created with a rejected/duplicate name
            const available = await checkUsernameAvailable(username);
            if (available === false) {
                return showError('اسم المستخدم غير متاح أو غير مسموح. اختر اسماً آخر.');
            }
            const { data, error } = await sb.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin,
                    data: { display_name, username }
                }
            });
            if (error) {
                // Match on CODE as well as message. Supabase v2 reports this as
                // code 'over_email_send_rate_limit' with the message "For security
                // purposes, you can only request this after N seconds" — which
                // contains none of the substrings below, so a message-only test
                // lets the throttle surface as an error and undoes a2f13a1.
                // friendlyError() already keys off `code` for exactly this reason.
                const m = (error.message || '').toLowerCase();
                const c = (error.code || '').toString().toLowerCase();
                const isEmailQuota = m.includes('rate') || m.includes('too many') || m.includes('email_send')
                    || c.includes('rate') || m.includes('security purposes');
                if (!isEmailQuota) return showError(friendlyError(error));
            }
            // Supabase returns a fake success (empty identities, no email sent) when the
            // email is already registered. Don't pretend a new account was created.
            if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
                showError('هذا البريد مسجَّل بالفعل. سجّل الدخول أو استخدم "نسيت كلمة المرور".');
                switchTab('signin');
                document.getElementById('signin-email').value = email;
                return;
            }
            // Mail confirmation removed: when Supabase returns a session (Confirm
            // email is OFF), sign the user straight in — no verification step.
            if (data && data.session) {
                showSuccess('تم إنشاء حسابك. أهلاً بك في سُرى!');
                setTimeout(closeAuth, 700);
                return;
            }
            // Fallback (Confirm email still ON in Supabase): offer OTP verification.
            document.getElementById('otp-email').value = email;
            switchTab('otp');
            showSuccess('وصلتك رسالة بها رمز التحقق. افحص أيضاً مجلد الـ Spam.');
            formSignup.reset();
            if (pwBar) { pwBar.style.width = '0%'; }
        });
    });

    // ---- Password reset ----
    formReset.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const email = String(document.getElementById('reset-email').value || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return showError('صيغة البريد غير صحيحة.');
        await withBusy(document.getElementById('auth-reset-submit'), async () => {
            // Don't reveal if account exists — same UX whether it does or not.
            // redirectTo MUST NOT contain a hash fragment: the implicit recovery
            // flow returns the session in its own hash (#access_token=...&type=recovery),
            // and a second '#' here would mangle it so PASSWORD_RECOVERY never fires.
            await sb.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname
            }).catch(() => {});
            showSuccess('إن كان لديك حساب بهذا البريد فستصلك رسالة بالتفاصيل.');
        });
    });

    // ---- Set new password (recovery link landed) ----
    // Opened by enterRecoveryMode() when the user arrives via the reset email link.
    function enterRecoveryMode() {
        openAuth('newpw');
        showSuccess('أدخل كلمة المرور الجديدة لحسابك.');
        setTimeout(() => { const f = document.getElementById('newpw-password'); if (f) f.focus(); }, 80);
    }
    if (formNewPw) formNewPw.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const pw = String(document.getElementById('newpw-password').value || '');
        const pw2 = String(document.getElementById('newpw-password-confirm').value || '');
        if (!isStrongPassword(pw)) return showError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
        if (pw !== pw2) return showError('كلمتا المرور غير متطابقتين.');
        await withBusy(document.getElementById('auth-newpw-submit'), async () => {
            // The recovery link established a temporary session; updateUser sets the new password.
            const { error } = await sb.auth.updateUser({ password: pw });
            if (error) return showError(friendlyError(error));
            document.getElementById('newpw-password').value = '';
            document.getElementById('newpw-password-confirm').value = '';
            showSuccess('تم تحديث كلمة المرور بنجاح. يمكنك استخدامها الآن.');
            // Clean the recovery hash from the URL so a refresh doesn't re-trigger.
            try { history.replaceState(null, '', window.location.pathname); } catch (_) {}
            setTimeout(() => switchTab('signin'), 1600);
        });
    });

    // ---- OTP verification (email confirm) ----
    formOtp.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearMessages();
        const email = String(document.getElementById('otp-email').value || '').trim().toLowerCase();
        const token = String(document.getElementById('otp-code').value || '').trim().replace(/\D/g, '');
        if (!EMAIL_RE.test(email)) return showError('صيغة البريد غير صحيحة.');
        if (token.length < 6 || token.length > 8) return showError('الرمز غير صحيح. أدخل الرمز كما وصلك في البريد.');
        await withBusy(document.getElementById('auth-otp-submit'), async () => {
            // Try 'email' type first (signup confirm); fall back to 'magiclink' if rejected.
            let { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
            if (error) {
                const r2 = await sb.auth.verifyOtp({ email, token, type: 'magiclink' });
                error = r2.error;
            }
            if (error) return showError(friendlyError(error));
            showSuccess('تم التحقق. مرحباً بك!');
            setTimeout(closeAuth, 600);
        });
    });

    // ---- Resend OTP (sends a CODE via the Confirm-signup template, not a magic link) ----
    resendOtpBtn && resendOtpBtn.addEventListener('click', async () => {
        clearMessages();
        const email = String(document.getElementById('otp-email').value || '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return showError('صيغة البريد غير صحيحة.');
        await withBusy(resendOtpBtn, () => sendSignupCode(email));
    });

    // ---- Logout ----
    logoutBtn && logoutBtn.addEventListener('click', async () => {
        try { await sb.auth.signOut(); } catch (e) {}
    });

    // ---- Session state -> UI ----
    async function refreshUserUI(session) {
        if (!loginBtn) return;
        if (session && session.user) {
            let label = (session.user.user_metadata && session.user.user_metadata.display_name)
                || (session.user.email ? session.user.email.split('@')[0] : 'لاعب');
            try {
                // `username` rides along on the row we already fetch — a second
                // round trip just to learn whether it is null would double the
                // auth-state cost on every token refresh.
                const { data } = await sb.from('profiles').select('display_name,username').eq('id', session.user.id).maybeSingle();
                if (data && data.display_name) label = data.display_name;
                if (data && !data.username) requireUsername();
            } catch (e) { /* ignore */ }
            loginBtn.textContent = label;
            loginBtn.dataset.signedIn = '1';
            loginBtn.style.cursor = 'default';
            if (logoutBtn) logoutBtn.hidden = false;
        } else {
            loginBtn.textContent = loginBtnOriginalText;
            delete loginBtn.dataset.signedIn;
            loginBtn.style.cursor = '';
            if (logoutBtn) logoutBtn.hidden = true;
        }
    }
    // ---- Mandatory username for accounts that arrived without one ----------
    //
    // Only Google (and any future OAuth provider) can reach this state: the
    // email wizard makes the username a required step, but an OAuth provider
    // sends `full_name` and nothing else, so handle_new_user stores
    // `username = NULL`. Such a player was never asked afterwards, and showed
    // up on the leaderboard under whatever name Google happened to hold.
    //
    // It is deliberately a LOCK, not a nudge. A dismissible prompt for a field
    // the leaderboard depends on is a prompt that gets dismissed forever.
    // Recovery is the one flow allowed to win the modal: someone following a
    // password-reset link must finish setting the password first, and both
    // views cannot occupy the modal at once.
    function requireUsername() {
        if (claimLock) return;                                   // already asking
        if (formNewPw && !formNewPw.hidden) return;              // recovery owns the modal
        claimLock = true;
        if (authClose) authClose.hidden = true;
        switchTab('claim');
        authModal.classList.add('active');
        setTimeout(() => { const el = document.getElementById('claim-username'); if (el) el.focus(); }, 50);
    }
    function releaseUsernameLock() {
        claimLock = false;
        if (authClose) authClose.hidden = false;
    }
    formClaim && formClaim.addEventListener('submit', async (e) => {
        e.preventDefault(); clearMessages();
        const val = String((document.getElementById('claim-username') || {}).value || '').trim().toLowerCase();
        if (!USERNAME_RE.test(val)) return showError('حروف إنجليزية صغيرة وأرقام و«_» فقط (3–20).');
        await withBusy(document.getElementById('auth-claim-submit'), async () => {
            // set_username does the real enforcement — format, profanity and
            // uniqueness — and syncs display_name, so the nav button and the
            // leaderboard agree with the account panel from this moment on.
            const { error } = await sb.rpc('set_username', { p: val });
            if (error) {
                const m = (error.message || '').toLowerCase();
                if (m.includes('taken')) return showError('اسم المستخدم محجوز. اختر اسماً آخر.');
                if (m.includes('not_allowed')) return showError('اسم المستخدم غير مسموح.');
                if (m.includes('format')) return showError('صيغة اسم المستخدم غير صحيحة.');
                if (m.includes('not_authenticated')) return showError('انتهت الجلسة. سجّل الدخول مجدداً.');
                return showError('تعذّر حفظ اسم المستخدم.');
            }
            releaseUsernameLock();
            closeAuth();
            if (window.__sura && window.__sura.refreshNav) window.__sura.refreshNav();
        });
    });
    wireUsernameField(
        document.getElementById('claim-username'),
        document.getElementById('claim-username-hint')
    );
    const claimSignout = document.getElementById('auth-claim-signout');
    claimSignout && claimSignout.addEventListener('click', async () => {
        releaseUsernameLock();                 // the session is going away
        try { await sb.auth.signOut(); } catch (e) { }
        closeAuth();
    });

    sb.auth.getSession().then(({ data }) => refreshUserUI(data.session));
    // Let other panels (e.g. the account username editor) re-render the nav
    // button label after they change the profile, without a page reload.
    window.__sura.refreshNav = async () => {
        try { const { data } = await sb.auth.getSession(); await refreshUserUI(data.session); } catch (_) {}
    };
    let recoveryHandled = false;
    sb.auth.onAuthStateChange(async (event, session) => {
        refreshUserUI(session);
        if (event === 'PASSWORD_RECOVERY' && !recoveryHandled) {
            recoveryHandled = true;
            enterRecoveryMode();
        }
    });

    // Robust recovery/error detection from the URL hash we captured BEFORE the
    // SDK scrubbed it. onAuthStateChange's PASSWORD_RECOVERY can be missed by a
    // late subscriber (the client parses the hash at module load), so we also
    // drive the flow directly from the captured hash — and surface link errors
    // (expired / already-used) instead of silently landing on the home page.
    (function handleRecoveryFromUrl() {
        const raw = (SURA_URL_HASH || '').replace(/^#/, '');
        if (!raw) return;
        const hp = new URLSearchParams(raw);
        const err = hp.get('error') || hp.get('error_code');
        if (err) {
            const desc = hp.get('error_description');
            const human = /expired|otp_expired|invalid/i.test(err + ' ' + (desc || ''))
                ? 'انتهت صلاحية رابط إعادة التعيين أو استُخدم من قبل. اطلب رابطاً جديداً.'
                : 'تعذّر فتح رابط إعادة التعيين. اطلب رابطاً جديداً.';
            openAuth('reset');
            showError(human);
            try { history.replaceState(null, '', window.location.pathname); } catch (_) {}
            return;
        }
        // ONLY a genuine recovery link (type=recovery) opens the new-password form.
        // A normal OAuth/implicit login (Google) ALSO returns access_token+refresh_token
        // in the hash, so keying off those tokens wrongly forced Google sign-ins into
        // "set a new password" — they must just log straight in.
        if (hp.get('type') === 'recovery') {
            if (recoveryHandled) return;
            recoveryHandled = true;
            // Give the SDK a beat to establish the recovery session, then open the form.
            setTimeout(enterRecoveryMode, 200);
        }
    })();

    // Expose openAuth so other UI (e.g., Wordle gating) can prompt sign-in
    window.__sura.openAuth = openAuth;
    // Open the OTP-verify step with the email prefilled AND send a fresh code (used by
    // the play-gate / unconfirmed sign-in — the user is here to verify, so send the code).
    window.__sura.openVerifyOtp = async (email) => {
        openAuth('otp');
        const f = document.getElementById('otp-email');
        if (f) f.value = email || '';
        const c = document.getElementById('otp-code');
        if (c) setTimeout(() => c.focus(), 60);
        if (EMAIL_RE.test(String(email || '').toLowerCase())) {
            await sendSignupCode(String(email).toLowerCase());
        }
    };
}
