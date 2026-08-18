// ============================================================
// Daily adrenaline strip on the games grid — combo progress, the
// countdown to the next puzzle, and the player's level. Refreshes on
// every win via window.__sura.refreshDailyStrip (called from meta.onWin).
//
// ‏تقرأ `window.__sura.meta` **وقتَ التركيب** وتخرج صامتةً إن لم يوجد، ثمّ
// تُسجّل `refreshDailyStrip` و`dailyGoal` اللذين يناديهما `meta.onWin` —
// فموضعُ ندائها بعد `meta` وقبل أوّل فوز، وهو حيث كانت.
// ============================================================
import { arNum, suraDailySeed } from '../core/util.js';

export function initDailyStrip() {
    const meta = window.__sura.meta;
    if (!meta) return;
    const cd = document.getElementById('grid-countdown');
    if (cd) meta.countdown.mount(cd);
    // Daily-return hook: clearing ANY level today completes the day's goal
    // (small XP bonus + keeps the streak warm). Self-paced campaign still
    // gives a concrete reason to come back each day.
    const dgKey = () => `dailygoal.${suraDailySeed()}`;
    window.__sura.dailyGoal = {
        done() { return !!meta.read(dgKey(), false); },
        mark() {
            if (meta.read(dgKey(), false)) return;
            meta.write(dgKey(), true);
            meta.xp.add(15);
            meta.toast('<span class="t-ico">🎯</span> هدف اليوم مكتمل! +15 خبرة');
            refresh();
        }
    };
    function refresh() {
        const combo = document.querySelector('#grid-combo b');
        const total = document.getElementById('grid-combo-total');
        const lvl = document.querySelector('#grid-level b');
        if (combo) combo.textContent = arNum(meta.combo.count());
        if (total) total.textContent = arNum(meta.combo.total);
        if (lvl) lvl.textContent = arNum(meta.xp.info().level);
        const dg = document.getElementById('grid-daily-goal');
        if (dg) {
            const done = window.__sura.dailyGoal.done();
            dg.classList.toggle('done', done);
            dg.innerHTML = done ? '<span class="dg-check">✓</span> هدف اليوم مكتمل' : 'هدف اليوم: أكمل مستوى';
        }
    }
    window.__sura.refreshDailyStrip = refresh;
    refresh();
}
