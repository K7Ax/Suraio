// --- Sura Leaderboard: two boards behind one card ---------------------
// «عام» (default) → the unified server-authoritative XP/rank board across all
// games (get-leaderboard?board=global). «يومي» → the per-game daily board.
// لا صفوف زينة: لوحة الصدارة إمّا صفوفٌ حقيقيّة من الخادم، وإمّا سطرٌ يقول
// إنها فارغة أو متعذّرة. الأسماء المخترعة حُذفت من index.html بأمر المالك —
// لوحةٌ تعرض بطولةً لم تُلعَب تكذب على الزائر في أوّل ما يراه.
//
// ‏تُسجّل `window.__sura.__lbSearch` الذي يستدعيه مربّعُ البحث أسفلَها، فنداؤها
// يسبق تركيبَ ذلك المربّع — وهو ما يفعله موضعُها في `main.js`.
// ---------------------------------------------------------------------
import { sb } from '../core/supabaseClient.js';
import { arNum, escapeHtmlShared } from '../core/util.js';

export function initLeaderboard() {
    if (!sb) return;
    const tbody = document.getElementById('leaderboard-rows');
    const modesEl = document.getElementById('leaderboard-modes');
    if (!tbody || !modesEl) return;
    const th3 = document.getElementById('lb-th-3');
    const th4 = document.getElementById('lb-th-4');
    const gameSel = document.getElementById('lb-game-select');
    const esc = escapeHtmlShared;
    const fmtTime = s => s ? `${arNum(Math.floor(s / 60))}:${arNum(String(s % 60).padStart(2, '0'))}` : '—';
    // رتبة اللاعب اسمًا لا ميدالية. الأيقونات كانت 🎖️🥉🥈🥇👑 — وهي
    // ميدالياتٌ تُقرأ **مركزًا** لا رتبة، فظهر بجانب صاحب المركز الأوّل
    // 🥈 لأن رتبته المهنيّة «مُتقِن». عمودُ المركز يقول المركز أصلًا
    // (ذهبي/فضّي/برونزي)، فرمزان لمعنيَين مختلفَين بشكلٍ واحد = التباس.
    // الأسماء من `TIERS` في progression.mjs — مصدرٌ واحد لا نسخة.
    const TIER_NAME = ['مُشارِك', 'مُجتهد', 'مُتقِن', 'بارع', 'أسطورة'];
    // خمسة أوائل فقط — بأمر المالك. اللوحة تُقرأ لمحةً لا تُدرَس.
    const TOP_N = 5;

    function rowHtml(cells, rank) {
        const top = rank <= 3;
        const medal = ['gold', 'silver', 'bronze'][rank - 1];
        const txt = ['gold-txt', 'silver-txt', 'bronze-txt'][rank - 1];
        const badge = top ? `<span class="rank-badge ${medal}">${arNum(rank)}</span>` : arNum(rank);
        return `<tr class="${top ? `top-rank rank-${rank}-row` : 'normal-rank'}">
            <td class="rank-col">${badge}</td>
            <td class="name-col ${top ? 'bold-name' : ''}">${cells.raw ? cells.name : esc(cells.name)}</td>
            <td class="time-col">${cells.c3}</td>
            <td class="score-col ${top ? txt : ''}">${cells.c4}</td>
        </tr>`;
    }

    // نجلب أعمق ممّا نعرض عمدًا. اللوحة تعرض الخمسة الأوائل، لكن السؤال
    // الذي يطرحه كل لاعبٍ هو «وأنا أين؟» — ولا يمكن الإجابة عنه من خمسة
    // صفوف. فيُجلب العمق مرّةً واحدة مع نفس النداء، ويُستعمل عند البحث
    // وحده. صفر نداءات إضافيّة، والصفّ يحمل **مركزه الحقيقي** لا ترتيبه
    // داخل نتيجة البحث.
    const DEPTH = 100;
    let deepRows = [];

    function globalRow(r, i) {
        return rowHtml({
            name: `${esc(r.display_name || 'لاعب')}<span class="tier-chip">${TIER_NAME[Math.max(0, Math.min(4, r.rank_tier | 0))]}</span>`,
            raw: true,
            c3: arNum(r.games_cleared || 0),
            c4: arNum(r.total_xp || 0)
        }, Number(r.rank) || (i + 1));
    }

    const emptyRow = msg =>
        `<tr class="normal-rank"><td colspan="4" class="lb-empty">${esc(msg)}</td></tr>`;

    async function loadGlobal() {
        const rows = await window.__sura.games.fetchGlobalLeaderboard(DEPTH);
        if (!rows.length) {
            deepRows = [];
            th3.textContent = 'الألعاب'; th4.textContent = 'الخبرة';
            tbody.innerHTML = emptyRow('لا فرسان بعد — كن أوّلهم.');
            return false;
        }
        deepRows = rows;
        th3.textContent = 'الألعاب'; th4.textContent = 'الخبرة';
        tbody.innerHTML = rows.slice(0, TOP_N).map(globalRow).join('');
        return true;
    }

    // يستدعيها مربّع البحث. يُرجع `true` متى تولّى العرض بنفسه، فيمتنع
    // المرشِّح العامّ عن إخفاء الصفوف التي رسمناها للتوّ.
    window.__sura.__lbSearch = (q) => {
        if (currentMode !== 'global' || !deepRows.length) return false;
        const query = String(q || '').trim().toLowerCase();
        if (!query) { tbody.innerHTML = deepRows.slice(0, TOP_N).map(globalRow).join(''); return true; }
        const hits = deepRows.filter(r => String(r.display_name || '').toLowerCase().includes(query));
        tbody.innerHTML = hits.length
            ? hits.slice(0, 12).map(globalRow).join('')
            : emptyRow(`لا أحد بهذا الاسم بين أفضل ${arNum(DEPTH)} لاعب`);
        return true;
    };

    async function loadDaily(game) {
        try {
            const rows = await window.__sura.games.__lbRows(`game=${encodeURIComponent(game)}&limit=${TOP_N}`);
            th3.textContent = 'زمن الحل'; th4.textContent = 'النقاط';
            if (!rows || !rows.length) {
                tbody.innerHTML = emptyRow('لم يُسجَّل أحدٌ في هذه اللعبة اليوم.');
                return false;
            }
            tbody.innerHTML = rows.map((r, i) => rowHtml({
                name: r.display_name || 'لاعب',
                c3: fmtTime(r.time_seconds),
                c4: arNum(r.score || 0)
            }, i + 1)).join('');
            return true;
        } catch (e) {
            tbody.innerHTML = emptyRow('تعذّر جلب اللوحة الآن.');
            return false;
        }
    }

    let currentMode = 'global';
    function setMode(mode) {
        currentMode = mode;
        modesEl.querySelectorAll('.lb-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        gameSel.hidden = (mode !== 'daily');
        if (mode === 'global') loadGlobal();
        else loadDaily(gameSel.value || 'wordle');
    }

    modesEl.querySelectorAll('.lb-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
    gameSel.addEventListener('change', () => loadDaily(gameSel.value));

    // Live refresh: called after a level is credited so the board updates
    // without a page reload (it otherwise hydrates only once at load).
    window.__sura.refreshLeaderboard = () => setMode(currentMode);

    // Default to the global board (with graceful fallback to the placeholders).
    loadGlobal();
}
