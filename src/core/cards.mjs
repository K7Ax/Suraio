// core/cards — GSAP على بطاقات الألعاب.
//
// WHAT THIS REPLACES, AND WHY IT IS NOT A REWRITE OF THE CARDS.
// The owner's instruction was explicit: leave the card artwork exactly as it is,
// add motion. So nothing here touches markup, colour, layout or the hand-built
// vector art inside each card. This module only ever writes `transform`.
//
// THE DIVISION OF LABOUR (keep it):
//   GSAP owns TRANSFORM — entrance, scroll reveal, tilt, press.
//   CSS  owns COLOUR — border, shadow, brackets, and every :hover that is not a
//        transform. Those must stay instant; routing them through JS would add
//        a frame of latency to the one interaction users feel most.
// GSAP writes an INLINE transform, which outranks the stylesheet, so the
// existing `.game-card:hover { transform: … }` is superseded automatically —
// but its `transition: transform` would smear every frame GSAP writes, so
// style.css drops that one transition under `html.gsap-cards`.
//
// WHY NOT PLAIN ScrollTrigger ON THE PAGE. Sura is not a scrolling document.
// Sections are shown ONE AT A TIME (style.css "Page-switch mode") — the games
// section is `display:none` until app.js marks it `.active`. A ScrollTrigger
// bound to the window therefore never fires, because the page never scrolls.
// So there are two mechanisms, and both are needed:
//   1. enter()  — replays the stagger when the route becomes visible;
//   2. ScrollTrigger bound to the section's OWN scroller, for the cards below
//      the fold of a tall grid.
//
// NO OPACITY. Not a style preference — `.scroll-section` descendants must never
// animate opacity (style.css:118-143): iOS Safari freezes the `from` frame when
// a fixed section returns from display:none, and an opacity-0 `from` frame means
// permanently invisible content. Transform and clip-path only. The CSS entrance
// this replaces DID animate opacity; that risk goes away with it.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reduced as reducedMotion, finePointer, budget } from './tier.mjs';

// التسجيل كان يجري عند تحميل الوحدة، و`registerPlugin` تستدعي `enable()` —
// فتُركّب مستمعات التمرير والقياس على المستند كلّه وتُجري تحديثةً أولى قبل
// أن يرى الزائر شيئًا. قيست ٢٣٠ms من زمن التحميل على حاسوبٍ بلا خنق، وكلّها
// تُدفَع مقدَّمًا في صفحةٍ لا تُمرَّر أصلًا: أوّل ScrollTrigger هنا لا يُنشَأ
// إلّا حين يُفتح قسم الألعاب. فلتستيقظ الإضافة عند أوّل استعمالٍ حقيقيّ.
let stReady = false;
export function ensureScrollTrigger() {
    if (stReady) return;
    stReady = true;
    gsap.registerPlugin(ScrollTrigger);
}
export function scrollTriggerAwake() { return stReady; }

// عدّادُ إبطالٍ مشترك للمستطيلات المخزَّنة. البطاقات تتحرّك مع الصفحة، فتمريرٌ
// أو تغييرُ مقاسٍ يُبطل ما خُزّن. مستمعان اثنان للوحدة كلّها بدل قراءةِ تخطيطٍ
// لكلّ بطاقةٍ لكلّ حركة مؤشّر.
let rectEpoch = 0;
if (typeof window !== 'undefined') {
    const bump = () => { rectEpoch++; };
    addEventListener('scroll', bump, { passive: true, capture: true });
    addEventListener('resize', bump, { passive: true });
}

// كانت هاتان قراءتَين محلّيتَين تكرّرتا حرفيًّا في ثلاثة ملفّات — انظر
// `src/core/tier.mjs`. ‏`TILT` جديدة: على أضعف الأجهزة يسقط الميل وحده،
// وهو أغلى ما في هذه الوحدة لأنّه يعمل مع كل حركةِ مؤشّر.
const REDUCED = () => reducedMotion();
const FINE = () => finePointer();
const TILT = () => budget().tilt;

// Only the cards that are actually on screen. Eight of the fourteen ship
// `display:none` (unreleased games); animating them costs frames for nothing and
// would leave an inline transform on an element that later becomes visible.
function liveCards(root) {
    return Array.from(root.querySelectorAll('.game-card'))
        .filter(c => c.offsetParent !== null);
}

export function createCards(opts) {
    const o = opts || {};
    const section = document.getElementById(o.sectionId || 'games');
    if (!section) return { enter() { }, destroy() { } };

    const root = document.documentElement;
    root.classList.add('gsap-cards');

    let triggers = [];
    let tilts = new WeakMap();
    let bound = false;

    // --- the entrance --------------------------------------------------------
    // A stagger, not fourteen separate delays. `from` is transform-only; the
    // slight rotateX is what makes the grid read as cards being dealt onto a
    // table rather than a list sliding up, and it is the whole difference
    // between "animated" and "art-directed".
    function reveal(cards, opts2) {
        const from = (opts2 && opts2.scrolled)
            ? { y: 34, rotationX: -6, scale: 0.97 }
            : { y: 46, rotationX: -10, scale: 0.94 };
        return gsap.fromTo(cards, from, {
            y: 0, rotationX: 0, scale: 1,
            duration: 0.75,
            ease: 'expo.out',
            stagger: { each: 0.055, from: 'start' },
            overwrite: 'auto',
            // NO clearProps. It was here, and it silently broke the tilt: it
            // discards the whole inline transform including the
            // `transformPerspective` set in enter(), and rotateX/rotateY in a
            // flat space render as nothing at all. The tween already ENDS at the
            // resting values, so there is nothing left to clear.
        });
    }

    // --- the tilt ------------------------------------------------------------
    // The one thing here CSS genuinely cannot do: the card leans toward the
    // pointer, tracking its position continuously rather than snapping to a
    // single :hover state. quickTo() is the cheap way — it reuses one tween per
    // property instead of allocating a new one per pointermove.
    //
    // Deliberately small (6 degrees). Anything more and the backdrop-filter on
    // the card starts to shear visibly at the edges.
    //
    // ONE OWNER PER PROPERTY. This is the rule that makes the four states
    // (hover / move / press / leave) compose instead of fight:
    //   rotateX, rotateY → quickTo, because they track the pointer CONTINUOUSLY.
    //   y, scale         → gsap.to, because they are DISCRETE states.
    // Mixing the two on one property is what broke this the first time: the
    // press used gsap.to on `scale` while hover used quickTo on `scale`, the
    // press tween overwrote quickTo's internal tween, and quickTo then wrote to
    // a dead tween — so leaving the card left it stuck at scale(0.985).
    function bindTilt(card) {
        if (tilts.has(card)) return;
        const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3' });
        const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3' });
        const lift = (y, scale, duration, ease) =>
            gsap.to(card, { y, scale, duration, ease, overwrite: 'auto' });

        // المستطيل يُقرأ عند الدخول لا عند كلّ حركة.
        //
        // كانت `move` تنادي `getBoundingClientRect()` في كلّ حدث pointermove —
        // تخطيطٌ قسريّ حتى ١٢٠ مرّةً في الثانية، على العنصر نفسه الذي يكتب فيه
        // GSAP `transform` في الإطار نفسه. وأسوأ من الكلفة: الرفعة (y و scale)
        // **تغيّر المستطيل المقروء**، فكان الميل يُحسَب على هندسةٍ تتحرّك تحته
        // ما دامت الرفعة تعمل. المستطيل عند الدخول هو الهندسة الصحيحة.
        //
        // ويُبطَل عند التمرير أو تغيير المقاس — انظر `rectEpoch` أسفل الوحدة.
        let r = null, rEpoch = -1;
        const move = e => {
            if (!r || rEpoch !== rectEpoch) { r = card.getBoundingClientRect(); rEpoch = rectEpoch; }
            if (!r.width || !r.height) return;
            const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 … 0.5
            const py = (e.clientY - r.top) / r.height - 0.5;
            rx(-py * 6);
            ry(px * 6);
        };
        const enter = () => { r = null; lift(-8, 1.02, 0.4, 'power3.out'); };
        const leave = () => { rx(0); ry(0); lift(0, 1, 0.5, 'power3.out'); };
        // Press: the card goes DOWN and slightly smaller — the direction a real
        // object moves when pushed. Releasing overshoots back to the hover lift,
        // which is what makes it read as a press rather than a shrink.
        const down = () => lift(-2, 0.985, 0.12, 'power2.out');
        const up = () => lift(-8, 1.02, 0.28, 'back.out(2)');

        card.addEventListener('pointerenter', enter);
        card.addEventListener('pointermove', move, { passive: true });
        card.addEventListener('pointerleave', leave);
        card.addEventListener('pointerdown', down);
        card.addEventListener('pointerup', up);
        tilts.set(card, { move, enter, leave, down, up });
    }

    function unbindTilt(card) {
        const h = tilts.get(card);
        if (!h) return;
        card.removeEventListener('pointerenter', h.enter);
        card.removeEventListener('pointermove', h.move);
        card.removeEventListener('pointerleave', h.leave);
        card.removeEventListener('pointerdown', h.down);
        card.removeEventListener('pointerup', h.up);
        tilts.delete(card);
    }

    // --- scroll reveal -------------------------------------------------------
    // Bound to the SECTION, which is the element that actually scrolls here.
    // `once: true` — a card that has arrived stays arrived; re-triggering on
    // every scroll back up is the tell of a template.
    function bindScroll(cards) {
        killTriggers();
        if (!cards.length) return;   // لا داعي لإيقاظ الإضافة إن لم يكن تحت الطيّة شيء
        ensureScrollTrigger();
        cards.forEach(card => {
            triggers.push(ScrollTrigger.create({
                trigger: card,
                scroller: section,
                start: 'top 92%',
                once: true,
                onEnter: () => reveal([card], { scrolled: true }),
            }));
        });
    }

    // ONE CARD, ONE OWNER. This split is not a refinement, it is a correctness
    // requirement: a card that gets BOTH the entrance stagger and a scroll
    // trigger is revealed twice, and the second `fromTo` re-pins it to its `from`
    // frame after the first tween already finished — so it visibly snaps back and
    // replays. It showed up at 1920x1080 as six cards still mid-transform almost
    // two seconds after the route opened.
    //
    // The fold is the VIEWPORT, not the section: the section is taller than the
    // screen and scrolls internally, so its own bottom edge is far below the fold
    // and comparing against it put on-screen cards in the scroll group.
    function splitByFold(cards) {
        const fold = window.innerHeight;
        const near = [], far = [];
        for (const c of cards) {
            (c.getBoundingClientRect().top < fold ? near : far).push(c);
        }
        return { near, far };
    }

    function killTriggers() {
        triggers.forEach(t => t.kill());
        triggers = [];
    }

    return {
        // Called by main.js on every route change. Replaying the stagger each
        // time the route is entered is deliberate: the section was display:none,
        // so this IS the card's first appearance from the visitor's point of view.
        enter(sectionId) {
            if (sectionId !== section.id) return;
            const cards = liveCards(section);
            if (!cards.length) return;

            // Reduced motion: no travel at all. The resting state in CSS is
            // already the final state, so doing nothing is the correct reveal.
            if (REDUCED()) { gsap.set(cards, { clearProps: 'transform' }); return; }

            // WITHOUT THIS THE TILT IS INVISIBLE. rotateX/rotateY are a no-op in
            // a flat coordinate space, and nothing in style.css establishes a
            // `perspective` on the grid. `transformPerspective` puts it in the
            // card's OWN transform instead of the parent's, which is what we
            // want here: a shared parent perspective makes cards at the edge of
            // a wide grid shear differently from cards in the middle.
            gsap.set(cards, { transformPerspective: 900, transformOrigin: '50% 50%' });

            // The cards on screen are dealt now; the ones below the fold wait for
            // the scroll that brings them up. No card is in both groups.
            const { near, far } = splitByFold(cards);
            if (near.length) reveal(near);
            bindScroll(far);

            // Tilt is a fine-pointer affordance. On touch there is no hover to
            // track, and binding pointermove on 6 cards would cost frames during
            // scrolling for an effect nobody can see.
            // ‏`TILT()` تُضيف الشرط الثاني: حاسوبٌ ضعيفٌ له فأرة يبقى له مؤشّرٌ
            // دقيق ولا تبقى له طاقةُ حسابٍ لكلّ حركةِ مؤشّر. الميل أوّلُ ما يسقط.
            if (FINE() && TILT()) cards.forEach(bindTilt);

            if (!bound) {
                bound = true;
                // The grid reflows at breakpoints; the triggers' start positions
                // are stale after that. Debounced, because resize fires in floods.
                let t = 0;
                addEventListener('resize', () => {
                    clearTimeout(t);
                    t = setTimeout(() => { if (stReady) ScrollTrigger.refresh(); }, 200);
                }, { passive: true });
            }
        },
        destroy() {
            killTriggers();
            liveCards(section).forEach(unbindTilt);
            root.classList.remove('gsap-cards');
        },
    };
}
