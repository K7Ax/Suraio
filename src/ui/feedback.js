// ============================================================
// «أبلغ وقيّم» — the report + rating system (المرحلة هـ).
//
// Three deliberate positions, because each one is a place this could have
// been built more cheaply and worse:
//
// 1. THE FORM ASKS THREE QUESTIONS, NOT ONE. A single textarea collects «ما
//    يشتغل» — which is a notification that something is wrong, not a bug
//    report. «What did you expect» versus «what happened» is the entire
//    diagnostic content, and a form that does not ask for it does not get it.
//
// 2. THE TECHNICAL SLICE IS COLLECTED, NEVER REQUESTED. Game, level, device,
//    browser, viewport, session — the reporter should not have to know or
//    describe any of it, and what they would describe would be wrong.
//
// 3. DICTATION DISAPPEARS WHERE IT DOES NOT EXIST. Web Speech is Chromium and
//    Safari only. A mic button that silently does nothing in Firefox is worse
//    than no mic button, so it is `hidden` until the API is confirmed present.
//    Typing is the path that always works; voice is the shortcut.
//
// The image never reaches Supabase Storage: it is downscaled here, posted to
// the Edge Function, forwarded to Telegram, and only the file_id is kept.
//
// ‏وموضعُها في `main.js` مشروط: تقرأ `window.__sura.demo` (زرُّ «▶ شرح» هو
// ‏ما يفتح لوحَ البلاغ) و`meta` و`levels` و`track` — فتأتي بعدهنّ جميعًا،
// وهو حيث كانت بالضبط.
// ============================================================
import { weaveIn } from './weave.js';
import { sb, SURA } from '../core/supabaseClient.js';
import { arNum, escapeHtmlShared } from '../core/util.js';

export function initFeedback() {
    const $ = id => document.getElementById(id);
    const form = $('fb-form');
    const ideaForm = $('idea-form');
    if (!form && !ideaForm) return;      // section not on this page

    const esc = escapeHtmlShared;
    const ENDPOINT = SURA.SUPABASE_URL ? `${SURA.SUPABASE_URL}/functions/v1/submit-feedback` : null;

    // The one place that knows how to reach the function. Sends the access
    // token when there is one so the row carries a real user_id, and the anon
    // key otherwise — the function accepts both by design.
    async function post(payload) {
        if (!ENDPOINT) return { ok: false, error: 'offline' };
        let token = null;
        try {
            if (sb) {
                const r = await sb.auth.getSession();
                token = (r && r.data && r.data.session) ? r.data.session.access_token : null;
            }
        } catch (e) { /* an anonymous report is still a report */ }
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    apikey: SURA.SUPABASE_ANON_KEY,
                    Authorization: 'Bearer ' + (token || SURA.SUPABASE_ANON_KEY)
                },
                body: JSON.stringify(payload)
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) return { ok: false, error: json.error || 'failed', message: json.message };
            return json;
        } catch (e) {
            return { ok: false, error: 'network' };
        }
    }

    // ---- the auto-attached slice -----------------------------------------
    function deviceKind() {
        const w = window.innerWidth || 0;
        const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
        if (touch && w < 640) return 'جوّال';
        if (touch) return 'لوحي';
        return 'حاسوب';
    }
    // Deliberately coarse. A precise browser fingerprint is neither needed to
    // reproduce a bug nor something to collect from someone reporting one.
    function browserKind() {
        const ua = navigator.userAgent || '';
        if (/Edg\//.test(ua)) return 'Edge';
        if (/OPR\//.test(ua)) return 'Opera';
        if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
        if (/Firefox\//.test(ua)) return 'Firefox';
        if (/Safari\//.test(ua)) return 'Safari';
        return 'أخرى';
    }
    // Modal id → game_type. Three of them differ, so the mapping is written
    // out rather than derived: `bee-modal` is `spelling_bee`, and the two
    // underscored types lose their underscore in the DOM id.
    const MODAL_GAME = { bee: 'spelling_bee', missingword: 'missing_word', storyorder: 'story_order' };
    function currentGame() {
        // The modal that is open right now is the thing being reported on,
        // and it is the one piece of context the player would most often get
        // wrong if asked. `.modal-backdrop.active` is the same selector the
        // scroll lock uses (see sync()) — one definition of «open».
        const el = document.querySelector('.modal-backdrop.active[id$="-modal"]');
        const id = el && el.id ? el.id.replace(/-modal$/, '') : '';
        if (!id) return null;
        const g = MODAL_GAME[id] || id;
        return (window.__sura.meta && window.__sura.meta.titleOf(g) !== g) ? g : null;
    }
    // THE NUMBER THE PLAYER SAW, not the array index. `levels.level()` is
    // 0-based and every HUD prints `lv + 1` («المستوى ٧» is index 6) — so a
    // report filed on المستوى ١ was arriving as «مستوى ٠», and the one place
    // that number exists to serve is a human reading the report and going to
    // look at that level. Everything downstream of here (the attached-context
    // line, the server-built `doing`, the bot, the dashboard, the rating row)
    // reads this one function, so the conversion belongs here and nowhere
    // else. Analytics is unaffected: `track()` keeps its own 0-based level.
    function levelOfGame(g) {
        try {
            const lv = g && window.__sura.levels && window.__sura.levels.level(g);
            return Number.isInteger(lv) ? lv + 1 : null;
        } catch (e) { return null; }
    }
    function slice() {
        const g = currentGame();
        return {
            game_type: g,
            level_number: g ? levelOfGame(g) : null,
            context: {
                device: deviceKind(),
                browser: browserKind(),
                ua: (navigator.userAgent || '').slice(0, 180),
                viewport: `${window.innerWidth}×${window.innerHeight}`,
                url: location.href.slice(0, 180),
                lang: navigator.language || '',
                theme: document.documentElement.getAttribute('data-theme') || 'dark',
                build: (document.querySelector('script[src*="app.js"]') || {}).src || ''
            }
        };
    }
    function ids() {
        let device = null, session = null;
        try { device = localStorage.getItem('sura.device_id'); } catch (e) { /* private mode */ }
        try { session = sessionStorage.getItem('sura.session_id'); } catch (e) { /* private mode */ }
        return { device_id: device, session_id: session };
    }

    // ---- voice to text ----------------------------------------------------
    // Free, on-device where the platform provides it, and zero tokens. Never a
    // requirement: `hidden` stays on the button when the API is absent.
    // المايك **لا يُطفئ نفسه** (طلب المالك، ١٢ أغسطس ٢٠٢٦: «يطفى كن نفسه،
    // نبي نطفيه حنا إذا خلّصنا كلام»). وهذا ليس إعدادًا واحدًا:
    //   • `continuous = true` يمنع الإنهاء بعد أوّل جملة…
    //   • …لكنّ Chrome ينهي الجلسة عند صمتٍ طويل مهما كانت القيمة، فـ`onend`
    //     يعيد التشغيل ما دام `wantRec` قائمًا. الطفء الوحيد هو ضغطتُك.
    //   • النصّ يتراكم في `recFinal` لا في قيمة الحقل، وإلا محا كل تشغيلٍ
    //     جديد ما قبله (كانت `base` تُقرأ مرّةً واحدة عند البدء فقط).
    //   • رفضُ الإذن أو غيابُ الميكروفون يوقف فورًا ويقول السبب — إعادةُ
    //     المحاولة عليه حلقةٌ لا تنتهي.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const MIC_IDLE = 'اكتب بصوتك';
    const MIC_LIVE = 'إيقاف الإملاء';
    const MIC_MAX_SPINS = 240;               // ≈ ساعة من إعادة التشغيل الصامتة
    let rec = null, recBtn = null, recTarget = null;
    let recBase = '', recFinal = '', wantRec = false;
    let recT0 = 0, recTick = null, recSpins = 0;

    const arDigits = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
    const clock = ms => {
        const s = Math.max(0, Math.floor(ms / 1000));
        return arDigits(Math.floor(s / 60)) + ':' + arDigits(String(s % 60).padStart(2, '0'));
    };
    function micText(btn, t) {
        const el = btn && btn.querySelector('.fb-mic-text');
        if (el) el.textContent = t;
    }
    function micHint(target, text) {
        const el = target && target.parentElement
            && target.parentElement.querySelector('.fb-mic-hint');
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
    }
    function micSay(btn, text, cls) {
        const f = btn && btn.closest('.fb-form');
        say(f && f.querySelector('.fb-status'), text, cls);
    }
    function tickLabel() {
        if (!recBtn) return;
        micText(recBtn, MIC_LIVE + ' · ' + clock(Date.now() - recT0));
    }
    function write(v) {
        if (!recTarget) return;
        recTarget.value = v.slice(0, recTarget.maxLength > 0 ? recTarget.maxLength : 600);
        updateMeter();
    }
    function stopRec() {
        wantRec = false;
        if (recTick) { clearInterval(recTick); recTick = null; }
        if (rec) {
            rec.onend = null;                // وإلّا أعاد `spin` تشغيله بعد الطفء
            try { rec.stop(); } catch (e) { /* already stopped */ }
        }
        if (recBtn) {
            recBtn.classList.remove('rec');
            recBtn.setAttribute('aria-pressed', 'false');
            micText(recBtn, MIC_IDLE);
        }
        micHint(recTarget, '');
        rec = null; recBtn = null; recTarget = null;
    }
    function spin() {
        try { rec = new SR(); } catch (e) { stopRec(); return; }
        rec.lang = 'ar-SA';
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = ev => {
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const r = ev.results[i];
                if (r.isFinal) recFinal += r[0].transcript + ' ';
                else interim += r[0].transcript;
            }
            write(recBase + recFinal + interim);
        };
        rec.onerror = ev => {
            const err = (ev && ev.error) || '';
            if (err === 'not-allowed' || err === 'service-not-allowed') {
                micSay(recBtn, 'المتصفّح منع الميكروفون. اسمح به من قفل العنوان ثم أعد المحاولة.', 'err');
                stopRec();
            } else if (err === 'audio-capture') {
                micSay(recBtn, 'لم نجد ميكروفونًا متّصلًا.', 'err');
                stopRec();
            }
            // «no-speech» و«network» عابران: `onend` يعيد التشغيل بنفسه.
        };
        rec.onend = () => {
            if (!wantRec) return;
            if (++recSpins > MIC_MAX_SPINS) { stopRec(); return; }
            try { rec.start(); }
            catch (e) { setTimeout(() => { if (wantRec) spin(); }, 300); }
        };
        try { rec.start(); } catch (e) { stopRec(); }
    }
    function startRec(btn, target) {
        stopRec();
        recBtn = btn; recTarget = target; wantRec = true; recSpins = 0;
        // النصّ المكتوب قبل الإملاء يبقى: من كتب نصف جملةٍ ثم مدّ يده للمايك
        // لم يطلب منّا حذفها.
        recBase = target.value ? target.value.trim() + ' ' : '';
        recFinal = '';
        recT0 = Date.now();
        btn.classList.add('rec');
        btn.setAttribute('aria-pressed', 'true');
        tickLabel();
        recTick = setInterval(tickLabel, 1000);
        micHint(target, 'المايك مفتوح — تكلّم على راحتك، ولن يتوقّف حتى تضغط «إيقاف الإملاء».');
        spin();
    }
    if (SR) {
        document.querySelectorAll('.fb-mic').forEach(btn => {
            btn.hidden = false;
            micText(btn, MIC_IDLE);
            btn.addEventListener('click', () => {
                const target = $(btn.dataset.mic);
                if (!target) return;
                if (btn.classList.contains('rec')) stopRec();
                else startRec(btn, target);
            });
        });
        // مغادرة الصفحة تُطفئ المايك. تركُه مفتوحًا على تبويبٍ منسيّ أسوأ من
        // إغلاقه مبكّرًا — وهو الاستثناء الوحيد لقاعدة «لا يُطفأ إلا بيدك».
        addEventListener('pagehide', stopRec);
    }

    // ---- image: downscaled here, so the network never carries a 6MB photo --
    const MAX_EDGE = 1200;
    const TARGET_BYTES = 150 * 1024;
    let imageData = null;

    // ---- الترميز خارج الخيط الرئيس ----------------------------------------
    //
    // الترميزةُ الأولى هي الحجبُ كلّه: `toBlob` ترجع إلى ترميزٍ **متزامن**
    // تحت ضغط المعالج، فتجمّد الواجهة ~٧٦٠ms على Pixel 5 مخنوق ٦× (قيس
    // ثلاث مرّاتٍ متتالية: ٨٦٥/٧٦٤/٧٥٧). ولا يزيلها تقليلُ عدد الترميزات —
    // أُزيل ٦٠٪ منها فلم يتحرّك الحجبُ إطلاقًا (٩٢٥ ← ٩٢٦ms)، لأنّ ما
    // أُزيل لم يكن حاجبًا أصلًا.
    //
    // فالمخرجُ الوحيد نقلُ الترميز إلى خيطٍ آخر: `createImageBitmap` +
    // `OffscreenCanvas.convertToBlob` داخل Worker. وحجبُ خيطِ العامل مجّانيّ
    // — لا واجهةَ فيه — فتسقط الحاجةُ إلى «التنفّس» بين الترميزات هناك.
    //
    // العاملُ يُبنى من `blob:` لا من ملفٍّ مستقلّ: طلبُ شبكةٍ أقلّ، ولا بندَ
    // جديدٌ في قائمة `scripts/build/dist.js`. و`worker-src 'self' blob:` قائمةٌ في
    // السياسة المولَّدة لهذا الغرض.
    //
    // وكلُّ فشلٍ — لا Worker، ولا OffscreenCanvas، أو صيغةٌ لا يفكّها
    // `createImageBitmap` — يسقط إلى المسار القديم كما هو. الطريقُ الجديد
    // إضافةٌ لا استبدال.
    const WORKER_SRC = `
self.onmessage = async function (e) {
var d = e.data;
try {
    var bmp = await createImageBitmap(d.file);
    var scale = Math.min(1, d.maxEdge / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * scale));
    var h = Math.max(1, Math.round(bmp.height * scale));
    var c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    var enc = function (q) { return c.convertToBlob({ type: 'image/jpeg', quality: q }); };
    var q = d.qHigh, blob = await enc(q), n;
    for (n = 1; n < d.maxEncodes && blob.size > d.target; n++) {
        var next = n === d.maxEncodes - 1
            ? d.qFloor
            : Math.min(d.qHigh, Math.max(d.qFloor,
                q + Math.log(d.target * 0.9 / blob.size) / d.k));
        if (next >= q) break;
        q = next;
        blob = await enc(q);
    }
    self.postMessage({ id: d.id, blob: blob });
} catch (err) {
    self.postMessage({ id: d.id, error: String((err && err.message) || err) });
}
};`;

    const workerUsable = () =>
        typeof Worker === 'function' &&
        typeof OffscreenCanvas === 'function' &&
        typeof createImageBitmap === 'function' &&
        typeof OffscreenCanvas.prototype.convertToBlob === 'function';

    let encSeq = 0;

    /** يرمّز في عاملٍ ويعيد Blob. يرفض إن تعذّر — والرفضُ يعني السقوطَ للمسار القديم. */
    function encodeOffThread(file) {
        return new Promise((resolve, reject) => {
            if (!workerUsable()) { reject(new Error('no worker')); return; }
            let url, w;
            try {
                url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
                w = new Worker(url);
            } catch (e) {
                if (url) URL.revokeObjectURL(url);
                reject(e);
                return;
            }
            const id = ++encSeq;
            // العاملُ يُنهى في كلّ الأحوال: صورةٌ واحدةٌ في البلاغ، فإبقاؤه
            // حيًّا بعدها ذاكرةٌ محجوزةٌ بلا عمل.
            const done = fn => v => { try { w.terminate(); } finally { URL.revokeObjectURL(url); } fn(v); };
            const ok = done(resolve), bad = done(reject);
            w.onmessage = e => {
                if (!e.data || e.data.id !== id) return;
                e.data.error ? bad(new Error(e.data.error)) : ok(e.data.blob);
            };
            w.onerror = () => bad(new Error('worker failed'));
            w.postMessage({
                id, file, maxEdge: MAX_EDGE, target: TARGET_BYTES,
                qHigh: 0.82, qFloor: 0.34, maxEncodes: 3, k: 2.74,
            });
        });
    }

    const blobToDataURL = blob => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error('bad image'));
        fr.readAsDataURL(blob);
    });

    async function downscale(file) {
        try {
            return await blobToDataURL(await encodeOffThread(file));
        } catch (e) {
            // لا تُبلَّغ الشاشةُ بشيء: السقوطُ إلى المسار القديم ينتج الصورةَ
            // نفسها، وكلّ ما يخسره المستخدم هو أنّ الواجهة ستتجمّد لحظةً.
            return await downscaleOnMainThread(file);
        }
    }

    function downscaleOnMainThread(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const c = document.createElement('canvas');
                c.width = w; c.height = h;
                c.getContext('2d').drawImage(img, 0, 0, w, h);
                // Step the quality down rather than guessing once: a screenshot
                // of a puzzle board and a photo of a phone screen compress
                // nothing alike, and one fixed quality is wrong for one of them.
                //
                // تصحيحُ ما كان مكتوبًا هنا: كان التعليق يقول إنّ `toBlob`
                // «ترمّز خارج الخيط الرئيس». **هذا غير صحيح، وقيس أنّه غير
                // صحيح.** ‏Chrome يجدول الترميز مهمّةَ خمول، فإذا لم يجد خمولًا
                // قبل مهلته رجع إلى ترميزٍ **متزامن** على الخيط الرئيس. القياس
                // على Pixel 5 مخنوق ٦×، عبر النموذج الحقيقيّ، ثلاث مرّاتٍ
                // متتالية: تجمّدٌ متّصل ٨٦٥ ثمّ ٧٦٤ ثمّ ٧٥٧ms. ولأنّه يتكرّر في
                // كلّ مرّة فليس إحماءً يُدفَع مرّةً — جُرّبت الفرضيّة وسقطت.
                // وجُرّب `willReadFrequently` فلم يغيّر شيئًا (‏٨٠٨ مقابل ٨٢١ms)،
                // وجُرّبت فرضيّةُ «حافّةٍ عند حجم اللوحة» فسقطت: الكلفة تتبع
                // **أوّل** ترميزٍ يجري لا عددَ البكسلات.
                //
                // وهذا المسارُ لم يعد الطريقَ الأوّل: الترميزُ صار في عامل
                // (‏`encodeOffThread` أعلاه)، وما هنا شبكةُ أمانٍ لمتصفّحٍ
                // بلا OffscreenCanvas أو لصورةٍ يعجز عنها `createImageBitmap`.
                // ولذلك يبقى تقليلُ الترميزات والتنفّسُ بينها على حالهما:
                // حين يُسلَك هذا الطريق، يُسلَك على الخيط الرئيس فعلًا.
                //
                // كانت السُّلَّمُ الثابتة (‏−٠٫١٢ في كلّ دورة) تُرمّز حتى **خمس**
                // مرّات: ٠٫٨٢ ثمّ ٠٫٧٠ ثمّ ٠٫٥٨ ثمّ ٠٫٤٦ ثمّ ٠٫٣٤. وهي تتجاهل ما
                // تعلّمته من الترميزة الأولى. وحجمُ JPEG يتبع الجودة تبعًا
                // أُسّيًّا في هذا المدى — قيس على الحالة الحدّيّة: ٥١٥ك عند ٠٫٨٢
                // و٣٤٠ك عند ٠٫٧٠ و٢٥٢ك عند ٠٫٥٨ و١٩٥ك عند ٠٫٤٦ و١٣٩ك عند ٠٫٣٤،
                // أي نحو ٠٫٧٢ من الحجم لكلّ ٠٫١٢ من الجودة. فمن حجمٍ واحدٍ
                // مقيسٍ تُحسب الجودةُ المطلوبة مباشرةً بدل تحسّسها خطوةً خطوة.
                const Q_HIGH = 0.82, Q_FLOOR = 0.34, MAX_ENCODES = 3;
                const K = 2.74;   // ميل ln(الحجم) بالنسبة للجودة، مقيسًا أعلاه
                const clampQ = q => Math.min(Q_HIGH, Math.max(Q_FLOOR, q));
                const encode = q => new Promise(res => {
                    if (!c.toBlob) { res(null); return; }
                    c.toBlob(b => res(b), 'image/jpeg', q);
                });
                // تنفّسٌ بين الترميزات: الترميزة تحجب الخيط، فبدون هذا تتلاصق
                // الحُجُب فتصير كتلةً واحدةً لا ترسم فيها الصفحة إطارًا ولا
                // تستقبل لمسة. إطارٌ ثمّ مهمّةٌ فارغة يضمنان رسمةً بينهما.
                const breathe = () => new Promise(res =>
                    requestAnimationFrame(() => setTimeout(res, 0)));
                (async () => {
                    let q = Q_HIGH, blob = await encode(q);
                    // متصفّحٌ بلا `toBlob` (قديمٌ جدًّا) يعود إلى الطريق الأوّل.
                    if (!blob) {
                        let out = c.toDataURL('image/jpeg', q);
                        while (out.length * 0.75 > TARGET_BYTES && q > 0.4) {
                            q -= 0.12;
                            out = c.toDataURL('image/jpeg', q);
                        }
                        return out;
                    }
                    // الحالة الشائعة تنتهي هنا بترميزةٍ واحدة، كما كانت.
                    for (let n = 1; n < MAX_ENCODES && blob.size > TARGET_BYTES; n++) {
                        // يُقصد ٩٠٪ من السقف لا السقفَ نفسه، فلا تُهدَر ترميزةٌ
                        // ثالثة على تجاوزٍ بالكاد. وآخرُ محاولةٍ تنزل إلى القاع
                        // مباشرةً: لا فائدة من تقديرٍ ثالثٍ لا ترميزةَ بعده.
                        const next = n === MAX_ENCODES - 1
                            ? Q_FLOOR
                            : clampQ(q + Math.log(TARGET_BYTES * 0.9 / blob.size) / K);
                        if (next >= q) break;      // لا تقدير يُحسّن ⇒ لا ترميزة
                        q = next;
                        await breathe();
                        const nb = await encode(q);
                        if (!nb) break;            // نحتفظ بآخر نتيجةٍ صالحة
                        blob = nb;
                    }
                    return await blobToDataURL(blob);
                })().then(out => { out ? resolve(out) : reject(new Error('bad image')); }, reject);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
            img.src = url;
        });
    }

    const fileInput = $('fb-image');
    const thumb = $('fb-thumb');
    const thumbImg = $('fb-thumb-img');
    // الضغطُ يأخذ وقتًا حقيقيًّا على الجوّال — قيس ~١٫٧ ثانية لأسوأ صورة على
    // Pixel 5 مخنوق ٦×. وكان يمرّ بلا أثرٍ في الشاشة: لا شيء بين اختيار الصورة
    // وظهور المصغّرة، فيظنّ المرسِل أنّ الاختيار لم يُقبل. وأسوأ من ذلك أنّ
    // «إرسال» كانت تمرّ في أثنائه فتُرسل البلاغ بلا صورةٍ **بصمت**
    // (`image: imageData || undefined` و`imageData` لم تُملأ بعد) — أي يخسر
    // المُبلِّغ الشيءَ الذي تكبّد رفعه ولا يُخبَر.
    let compressing = false;
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const f = fileInput.files && fileInput.files[0];
            if (!f) return;
            if (!/^image\//.test(f.type)) { say(status, 'الملف ليس صورة.', 'err'); fileInput.value = ''; return; }
            compressing = true;
            say(status, 'جارٍ تجهيز الصورة…');
            try {
                imageData = await downscale(f);
                if (thumbImg) thumbImg.src = imageData;
                if (thumb) thumb.hidden = false;
                // الرسالة تُمحى عند النجاح: المصغّرة نفسها هي الإشعار.
                if (status && status.textContent === 'جارٍ تجهيز الصورة…') say(status, '');
            } catch (e) {
                imageData = null;
                say(status, 'تعذّرت قراءة الصورة.', 'err');
            } finally {
                compressing = false;
            }
            fileInput.value = '';
        });
    }
    const thumbX = $('fb-thumb-x');
    if (thumbX) thumbX.addEventListener('click', () => {
        imageData = null;
        if (thumb) thumb.hidden = true;
        if (thumbImg) thumbImg.removeAttribute('src');
    });

    // ---- the report form ---------------------------------------------------
    // ONE QUESTION, NOT THREE. The guided form asked «what were you doing /
    // what did you expect / what happened» and enforced 40 characters — and
    // the owner's verdict on it was that the ceremony outweighs the value. A
    // report is worth more written badly than not written at all, and the
    // three-part answer is still reachable: whoever wants to give it just
    // writes it in the one box. What the form used to demand in prose it now
    // collects silently instead — game, level, device, browser, url — which
    // was always the half a reporter gets wrong anyway.
    const happened = $('fb-happened');
    const sliceEl = $('fb-slice'), status = $('fb-status');
    const submit = $('fb-submit');

    function say(el, text, cls) {
        if (!el) return;
        el.textContent = text;
        el.className = 'fb-status' + (cls ? ' ' + cls : '');
    }

    // Kept under its old name because dictation calls it after every result:
    // all it does now is refresh the «what we attach» line, which changes as
    // the player opens and closes games behind the section.
    // ---- مؤشّر وضوح البلاغ ------------------------------------------------
    // تشجيعٌ لا بوّابة: لا يمنع الإرسال عند أي طول، والحدّ الأدنى (٤٠ حرفًا)
    // بقي محذوفًا كما قرّر المالك. الفائدة أن أكثر البلاغات فشلًا ليست
    // القصيرةَ عمدًا بل التي توقّف كاتبها عند «ما يشتغل» ظنًّا أنها تكفي —
    // وشريطٌ يتقدّم أمامه يجعله يكمل الجملة، بلا لومٍ ولا رفض.
    const strengthEl = $('fb-strength'), strengthWord = $('fb-strength-word');
    const STRENGTH = [
        [0, 0.00, 'اكتب ما حدث بكلماتك'],
        [1, 0.18, 'بداية طيّبة — وماذا حدث بعدها؟'],
        [30, 0.52, 'واضح. أضِف ما كنتَ تتوقّعه إن أمكن'],
        [80, 0.80, 'بلاغ جيّد — نستطيع تتبّعه'],
        [160, 1.00, 'بلاغ ممتاز، شكرًا لدقّتك'],
    ];
    function updateStrength() {
        if (!strengthEl || !happened) return;
        const n = happened.value.trim().length;
        let row = STRENGTH[0];
        for (const r of STRENGTH) if (n >= r[0]) row = r;
        strengthEl.style.setProperty('--v', row[1]);
        strengthEl.classList.toggle('full', row[1] >= 1);
        if (strengthWord) strengthWord.textContent = row[2];
    }

    function updateMeter() {
        updateStrength();
        if (!sliceEl) return;
        const s = slice();
        const g = s.game_type ? window.__sura.meta.titleOf(s.game_type) : null;
        // «—», never «٠» (docs/architecture/identity.md §empty state).
        sliceEl.textContent = g
            ? `يُرفق تلقائيًّا: ${g}${s.level_number != null ? ` · مستوى ${arNum(s.level_number)}` : ''} · ${s.context.device}`
            : `يُرفق تلقائيًّا: ${s.context.device} · ${s.context.browser}`;
    }
    if (happened) happened.addEventListener('input', updateMeter);
    updateMeter();

    const demoBtn = $('fb-demo');
    if (demoBtn) demoBtn.addEventListener('click', () => {
        if (window.__sura.demo) window.__sura.demo.open('report');
    });

    // Opening the form is tracked separately from sending one. Without the
    // pair, «few reports» is unreadable — it could mean few bugs, or a form
    // nobody can finish.
    let openedTracked = false;
    if (happened) {
        happened.addEventListener('focus', () => {
            if (openedTracked) return;
            openedTracked = true;
            if (window.__sura.track) window.__sura.track('report_opened', slice());
        }, { once: true });
    }

    if (form) form.addEventListener('submit', async e => {
        e.preventDefault();
        stopRec();
        // The only refusal left is an empty box — and even that is relaxed
        // when a screenshot is attached, because «هذي المشكلة» over a photo of
        // a broken board is a complete report and rejecting it would be
        // pedantry. The server keeps the same two floors.
        const text = happened.value.trim();
        // الصورة ما زالت تُضغط ⇒ لا يُرسَل البلاغ بدونها بصمت.
        if (compressing) {
            say(status, 'الصورة ما زالت تُجهَّز — لحظة واحدة.');
            return;
        }
        if (text.length < (imageData ? 3 : 8)) {
            say(status, 'اكتب المشكلة في سطرٍ واحد على الأقل.', 'err');
            happened.focus();
            return;
        }
        submit.disabled = true;
        say(status, 'جارٍ الإرسال…');
        const s = slice();
        const res = await post({
            kind: 'report',
            happened: text,
            image: imageData || undefined,
            ...ids(), ...s
        });
        submit.disabled = false;
        if (res && res.ok) {
            say(status, 'وصلنا بلاغك — شكرًا لك. سنقرأه.', 'ok');
            weaveIn([status], { dur: 0.5 });     // الشكر يُنسج، كسائر نصّ الموقع
            form.reset();
            imageData = null;
            if (thumb) thumb.hidden = true;
            updateMeter();
            if (window.__sura.track) window.__sura.track('report_sent', s);
        } else {
            say(status, (res && res.message) || 'تعذّر الإرسال الآن. حاول بعد قليل.', 'err');
        }
    });

    // ---- suggestions -------------------------------------------------------
    // WHAT THIS REPLACED, AND WHY. This card used to be a difficulty rating:
    // pick a game, pick one of three verdicts, optionally add stars and a
    // note. The owner's objection was that it asks about one narrow axis of
    // one game, when the thing a player actually arrives wanting to say is
    // «you should add X». So the card became an open suggestion box whose
    // subject defaults to «بشكل عام» — an idea about the whole site is the
    // common case, and a game is the exception, which is the opposite of the
    // way the rating form was shaped.
    //
    // DIFFICULTY IS NOT LOST. It survives where it was always better asked:
    // the one-tap question after a win, below — in context, one second, no
    // form. `game_ratings` keeps filling from there.
    const ideaGame = $('idea-game');
    const ideaText = $('idea-text');
    const ideaStatus = $('idea-status');
    const ideaSubmit = $('idea-submit');

    if (ideaGame && window.__sura.meta) {
        // The empty value is first and selected: «بشكل عام» is the default
        // answer, not a fallback buried under six games.
        ideaGame.innerHTML = '<option value="">بشكل عام</option>'
            + window.__sura.meta.LIVE_GAMES
                .map(g => `<option value="${esc(g)}">${esc(window.__sura.meta.titleOf(g))}</option>`).join('');
    }

    // THE STAR RIDES WITH THE IDEA (owner: «خل الاقتراح مع التقييم»). Optional
    // on purpose and stated as such: a suggestion with no star is a complete
    // suggestion, and a required star would rebuild exactly the ceremony the
    // owner cut out of the report form two rounds ago.
    //
    // Five buttons in one delegated listener rather than five listeners, and
    // `aria-checked` carries the state so the radiogroup is true for a screen
    // reader instead of only looking true. There is no hidden input: the value
    // lives in one closure variable that the submit handler reads.
    const ideaStars = $('idea-stars');
    const ideaStarsNote = $('idea-stars-note');
    const STAR_WORDS = ['', 'سيّئ', 'مقبول', 'جيّد', 'ممتاز', 'رائع'];
    let ideaStarValue = 0;

    function paintStars(n) {
        if (!ideaStars) return;
        ideaStars.querySelectorAll('.fb-star').forEach(b => {
            const on = Number(b.dataset.star) <= n;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', String(Number(b.dataset.star) === n));
        });
        // «—» is never printed for an empty rating: an absent star is an absent
        // line, per docs/architecture/identity.md. The note simply stays empty.
        if (ideaStarsNote) ideaStarsNote.textContent = n ? STAR_WORDS[n] : '';
    }

    if (ideaStars) {
        ideaStars.addEventListener('click', ev => {
            const b = ev.target.closest('.fb-star');
            if (!b) return;
            const n = Number(b.dataset.star);
            // Tapping the current star clears it. Without this the control is a
            // one-way door: a mis-tap can never be taken back, and the player
            // is left having said something they did not mean.
            ideaStarValue = (n === ideaStarValue) ? 0 : n;
            paintStars(ideaStarValue);
        });
    }

    if (ideaForm) ideaForm.addEventListener('submit', async e => {
        e.preventDefault();
        stopRec();
        const text = ideaText.value.trim();
        if (text.length < 8) {
            say(ideaStatus, 'اكتب فكرتك في سطرٍ واحد على الأقل.', 'err');
            ideaText.focus();
            return;
        }
        ideaSubmit.disabled = true;
        say(ideaStatus, 'جارٍ الإرسال…');
        const game = ideaGame ? ideaGame.value : '';
        const s = slice();
        const res = await post({
            kind: 'idea',
            happened: text,
            // Zero means «did not answer», and the server treats anything
            // outside 1–5 as absent — so an unrated idea sends nothing.
            stars: ideaStarValue || null,
            // The chosen subject wins over whatever modal happens to be open:
            // this is a deliberate answer to a question, not inferred context.
            game_type: game || null,
            level_number: game ? levelOfGame(game) : null,
            context: s.context,
            ...ids()
        });
        ideaSubmit.disabled = false;
        if (res && res.ok) {
            say(ideaStatus, 'وصلتنا فكرتك — شكرًا لك.', 'ok');
            weaveIn([ideaStatus], { dur: 0.5 });
            // Read before the reset below zeroes it, or analytics records a
            // null star for every rated suggestion ever sent.
            const sentStars = ideaStarValue || null;
            ideaForm.reset();
            // `form.reset()` cannot reach the stars: they are buttons, not a
            // form control, so their state is cleared by hand or the next
            // suggestion silently inherits this one's rating.
            ideaStarValue = 0;
            paintStars(0);
            if (window.__sura.track) {
                window.__sura.track('report_sent', {
                    game: game || null,
                    metadata: { kind: 'idea', stars: sentStars },
                });
            }
        } else {
            say(ideaStatus, (res && res.message) || 'تعذّر الإرسال الآن.', 'err');
        }
    });

    // ---- the one-tap question after a win ----------------------------------
    // Asked in context, where the player still remembers how the level felt —
    // which is the only moment the answer is worth anything. Once per game,
    // ever, and never before the second win: a first-timer has no basis for a
    // verdict and asking anyway trains people to dismiss the prompt.
    function ratedKey(g) { return `rated.${g}`; }
    function rated(g) {
        const m = window.__sura.meta;
        return !m || !!m.read(ratedKey(g), 0);
    }
    function markRated(g) {
        const m = window.__sura.meta;
        if (m && g) m.write(ratedKey(g), 1);
    }

    let sheet = null;
    function askRating(game) {
        if (!game || rated(game) || !window.__sura.meta) return;
        markRated(game);   // asked once, whether or not they answer
        if (sheet) sheet.remove();
        sheet = document.createElement('div');
        // Its own element, not `toast()`: the toast queue auto-dismisses and
        // drops duplicates, and this one has to sit still long enough to be
        // tapped.
        sheet.className = 'rate-sheet';
        sheet.innerHTML =
            '<div class="rate-inline">'
            + `<span class="rate-q">كيف وجدتَ «${esc(window.__sura.meta.titleOf(game))}»؟</span>`
            + '<div class="fb-verdicts">'
            + '<button type="button" class="fb-verdict" data-verdict="too_hard">صعبة جدًا</button>'
            + '<button type="button" class="fb-verdict" data-verdict="just_right">مضبوطة</button>'
            + '<button type="button" class="fb-verdict" data-verdict="too_easy">سهلة</button>'
            + '</div></div>';
        document.body.appendChild(sheet);
        const close = () => { if (sheet) { sheet.remove(); sheet = null; } };
        sheet.addEventListener('click', async ev => {
            const b = ev.target.closest('.fb-verdict');
            if (!b) return;
            const v = b.dataset.verdict;
            close();
            if (window.__sura.meta.toast) window.__sura.meta.toast('<span class="t-ico">🙏</span> شكرًا — رأيك يضبط الصعوبة.');
            const r = await post({ kind: 'rating', game_type: game, verdict: v, level_number: levelOfGame(game), ...ids() });
            if (r && r.ok && window.__sura.track) {
                window.__sura.track('rating_given', { game, metadata: { verdict: v, source: 'post_win' } });
            }
        });
        setTimeout(close, 12000);
    }

    window.__sura.feedback = { askRating, rated, open: () => window.__sura.demo && window.__sura.demo.open('report') };
}
