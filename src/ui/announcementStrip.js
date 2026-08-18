// ============================================================
// شريطُ إعلان المالك — الإعدادُ الوحيدُ الذي يغيّر ما يراه الزائر
// ============================================================
// جدولُ `site_settings` صفٌّ واحد، يكتبه المالكُ من اللوحة أو من البوت
// ‏(`/announce`) بلا نشرٍ جديد. غرضُه الحالاتُ التي لا يحتملها انتظارُ نشر:
// «صيانةٌ الليلة» أو «الصدارة متوقّفة مؤقّتًا».
//
// **ما ليس هو، مكتوبًا لئلّا يُبنى عليه لاحقًا:** ليس مفتاحَ إطفاء. أيُّ
// إعدادٍ يُفترض أن يمنع شيئًا — إغلاقُ التسجيل، تعطيلُ لعبة — يجب أن
// يُفرَض في الخادم؛ ومفتاحٌ يقرأه المتصفّحُ من صفٍّ علنيٍّ يُلتَفّ عليه
// بسطرٍ في الطرفيّة. فلم يُبنَ شيءٌ من ذلك، والمبنيُّ إعلانٌ لا حارس.
//
// ثمنُه طلبٌ واحد **في الجلسة كلّها**، مؤجَّلٌ إلى ما بعد الرسم الأوّل
// ‏(`load` ثمّ مهلةٌ قصيرة) فلا يزاحم LCP ولا يظهر في شلّال البداية. وسقوطُ
// الواجهة الخلفيّة لا يُرى أصلًا: لا شريطَ ولا خطأ ولا تأخير.
import { sb } from '../core/supabaseClient.js';

export function initAnnouncementStrip() {
    const KEY = '__sura_note';
    const DISMISSED = '__sura_note_seen';

    function show(note, kind) {
        if (!note) return;
        // الرفضُ يُحفَظ بنصّ الإعلان لا بعَلَمٍ عامّ: إعلانٌ جديدٌ يظهر
        // لمن أغلق القديم، والقديمُ لا يعود.
        try { if (localStorage.getItem(DISMISSED) === note) return; } catch (e) { }
        const bar = document.createElement('div');
        bar.className = 'sura-note' + (kind === 'warn' ? ' warn' : '');
        bar.setAttribute('role', 'status');
        const txt = document.createElement('span');
        txt.textContent = note;              // نصٌّ لا HTML — الصفُّ يكتبه المالك، ويبقى نصًّا
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'sura-note-x';
        x.setAttribute('aria-label', 'إغلاق الإعلان');
        x.textContent = '×';
        x.addEventListener('click', () => {
            try { localStorage.setItem(DISMISSED, note); } catch (e) { }
            bar.remove();
        });
        bar.append(txt, x);
        document.body.appendChild(bar);
        requestAnimationFrame(() => bar.classList.add('in'));
    }

    let cached = null;
    try { cached = sessionStorage.getItem(KEY); } catch (e) { }
    if (cached !== null) {
        const p = cached ? JSON.parse(cached) : null;
        if (p) show(p.t, p.k);
        return;
    }

    const fetchNote = async () => {
        try {
            const { data, error } = await sb
                .from('site_settings').select('announcement, announcement_kind').limit(1).maybeSingle();
            if (error) throw error;
            const t = (data && data.announcement || '').trim();
            const k = data && data.announcement_kind || 'info';
            try { sessionStorage.setItem(KEY, t ? JSON.stringify({ t, k }) : ''); } catch (e) { }
            show(t, k);
        } catch (e) {
            // صمتٌ مقصود: تعذُّرُ قراءة إعلانٍ ليس عطبًا يراه اللاعب.
            window.__sura.reportError('announce', e);
        }
    };
    if (document.readyState === 'complete') setTimeout(fetchNote, 1200);
    else window.addEventListener('load', () => setTimeout(fetchNote, 1200), { once: true });
}
