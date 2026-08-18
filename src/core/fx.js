// core/fx — the game-feel layer. Before this file a win was a CSS boxShadow
// flash: a repo-wide grep for vibrate/confetti/AudioContext returned nothing.
//
// Three design decisions worth knowing:
//   1. Audio is SYNTHESIZED via AudioContext — no asset files, no bundle cost,
//      and pitch can follow game state (warmer's hot/cold, the combo ladder).
//   2. `prefers-reduced-motion` gates MOTION only (confetti, flips, travel).
//      Sound and haptics are separate accessibility axes with their own mute
//      toggle; silencing them because someone dislikes animation is wrong.
//   3. Haptics are never the sole feedback channel — iOS Safari has no
//      navigator.vibrate at all, so every cue also has a visual or audio form.

// Mute lives in the GLOBAL pref blob, not per-uid, so it survives logout.
const PREF_KEY = 'sura.pref';
function prefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function setPref(k, v) {
    const p = prefs(); p[k] = v;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { }
}

export function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}
export function muted() { return !!prefs().muted; }
export function setMuted(v) { setPref('muted', !!v); return !!v; }

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
let ctx = null;
// iOS refuses to start an AudioContext outside a user gesture, so create and
// resume it on the first pointerdown — once — and never on page load.
function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => { }); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    return ctx;
}
let armed = false;
function arm() {
    if (armed) return;
    armed = true;
    // `new AudioContext()` قيس بـ٧٨ms على حاسوبٍ بلا خنق (و≈٣١٠ms على جوّالٍ
    // متوسّط). كان يُبنى **داخل** أوّل `pointerdown`، فيدفع كلّ زائرٍ ثمنه في
    // أوّل لمسةٍ يلمسها — وهو يقع مباشرةً على INP، أسوأ مقاييس الموقع.
    //
    // التأجيل بـ`setTimeout(…, 0)` يُخرجه من مهمّة الحدث إلى المهمّة التالية،
    // فتُنهى اللمسة أوّلًا. ويبقى داخل نافذة إيماءة المستخدم التي تشترطها iOS
    // لتشغيل الصوت: النافذة تُقاس بالإيماءة لا بالمهمّة الدقيقة، و`resume()`
    // في `ensureCtx` يلتقط أيّ حالة تعليق. ولا صوت في اللمسة الأولى أصلًا —
    // `arm()` تهيئة، والنغمات تأتي بعدها بنداءٍ من اللعبة.
    const once = () => {
        window.removeEventListener('pointerdown', once);
        setTimeout(ensureCtx, 0);
    };
    window.addEventListener('pointerdown', once, { passive: true });
}

function tone(freq, dur, type, gain, delay) {
    const c = ensureCtx(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain == null ? 0.14 : gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
}

// `n` is a per-cue intensity: for 'combo' it's the streak length, for 'warm'
// it's a 0..1 closeness, so pitch rises as the player gets hotter.
export function sfx(name, n) {
    if (muted()) return;
    const k = Math.max(0, Number(n) || 0);
    switch (name) {
        case 'tick': tone(330, 0.06, 'square', 0.05); break;
        case 'correct': tone(660, 0.10, 'triangle', 0.12); tone(880, 0.12, 'triangle', 0.09, 0.07); break;
        case 'wrong': tone(180, 0.16, 'sawtooth', 0.09); tone(140, 0.18, 'sawtooth', 0.07, 0.08); break;
        case 'rank': [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.11, i * 0.09)); break;
        case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.13, i * 0.10)); break;
        case 'combo': tone(440 * Math.pow(1.06, Math.min(12, k)), 0.09, 'triangle', 0.10); break;
        // rising pitch with closeness — the single clearest signal in قرّبها
        case 'warm': tone(240 + 520 * Math.min(1, k), 0.11, 'sine', 0.10); break;
        default: break;
    }
}

export function haptic(pattern) {
    if (muted()) return false;
    try { return !!(navigator.vibrate && navigator.vibrate(pattern || 12)); } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Motion — one shared canvas, rAF, auto-teardown
// ---------------------------------------------------------------------------
let canvas = null, cctx = null, parts = [], raf = 0;
function ensureCanvas() {
    if (canvas) return canvas;
    canvas = document.createElement('canvas');
    canvas.id = 'sura-fx';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
    document.body.appendChild(canvas);
    cctx = canvas.getContext('2d');
    const size = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    size(); window.addEventListener('resize', size);
    return canvas;
}
function pump() {
    raf = 0;
    if (!parts.length) { if (canvas) { canvas.remove(); canvas = null; cctx = null; } return; }
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter(p => {
        p.vy += 0.28; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= 1;
        if (p.life <= 0 || p.y > canvas.height + 40) return false;
        cctx.save();
        cctx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
        cctx.translate(p.x, p.y); cctx.rotate(p.r);
        cctx.fillStyle = p.c;
        cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cctx.restore();
        return true;
    });
    raf = requestAnimationFrame(pump);
}
const COLORS = ['#c9a227', '#e8c766', '#3aa655', '#4a90d9', '#e07b39', '#f5f0e1'];

export function confetti(n) {
    if (reduced()) return;              // motion only — sound still plays
    ensureCanvas();
    const count = Math.max(10, Math.min(160, n || 90));
    for (let i = 0; i < count; i++) {
        parts.push({
            x: canvas.width * (0.2 + Math.random() * 0.6),
            y: canvas.height * 0.32 + Math.random() * 40,
            vx: (Math.random() - 0.5) * 9,
            vy: -6 - Math.random() * 9,
            r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
            w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
            c: COLORS[(Math.random() * COLORS.length) | 0],
            life: 60 + Math.random() * 45
        });
    }
    if (!raf) raf = requestAnimationFrame(pump);
}

// A number that floats up from an element — "+12" on a scoring word.
export function float(el, text, color) {
    if (reduced() || !el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top}px;transform:translate(-50%,0);`
        + `color:${color || '#e8c766'};font-weight:700;font-size:1.05rem;pointer-events:none;z-index:9999;`
        + 'text-shadow:0 1px 3px rgba(0,0,0,.6);transition:transform .9s cubic-bezier(.16,1,.3,1),opacity .9s ease-out';
    document.body.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'translate(-50%,-46px)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 1000);
}

export function flip(el, delay) {
    if (reduced() || !el) return;
    setTimeout(() => {
        el.style.transition = 'transform .28s ease';
        el.style.transform = 'rotateX(90deg)';
        setTimeout(() => { el.style.transform = 'rotateX(0deg)'; }, 150);
    }, delay || 0);
}

export function shake(el) {
    if (reduced() || !el) return;
    el.style.animation = 'none';
    void el.offsetWidth;                  // force reflow so it can replay
    el.style.animation = 'shake 0.4s ease';
}

arm();

export default { sfx, haptic, confetti, float, flip, shake, reduced, muted, setMuted };
