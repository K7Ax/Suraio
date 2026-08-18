// نوافذ «القشرة» — دخول · حسابي · الإعدادات.
//
// العطل الذي أنتج هذا الملف: الترويسة (z-index 200) تعلو خلفيات النوافذ
// (150)، فأزرارها تبقى قابلة للنقر ونافذةٌ مفتوحة. وبما أن الخلفيات كلها
// على الطبقة نفسها، فالتي تفوز بصريًّا هي الأخيرة في DOM لا الأخيرة فتحًا:
// «الإعدادات» تسبق «حسابي» في الملف، فالنقر على الترس وحسابي مفتوحة كان
// يفتحها *خلفها* — يراها الزائر «صفحةً لا تطلع».
//
// القانون: النوافذ الحاملة [data-modal-solo] أقران لا يتراكمون، ينفّذه
// مُراقِبٌ واحد في src/main.js. وهذه الاختبارات تحرس طرفيه: السمة في
// الترميز، والمُراقِب في الحزمة المبنيّة.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// كل نافذةٍ تُفتح من الترويسة — وهي وحدها ما يمكن استدعاؤه فوق نافذةٍ أخرى.
const SOLO = ["auth-modal", "account-modal", "settings-modal"];

test("نوافذ القشرة الثلاث تحمل سمة عدم التراكم", () => {
    for (const id of SOLO) {
        const tag = HTML.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`));
        assert.ok(tag, `لا وجود لـ#${id} في index.html`);
        assert.match(tag[0], /data-modal-solo/,
            `#${id} تُفتح من الترويسة فوق غيرها، وبلا السمة ستُدفن خلفها`);
    }
});

test("النوافذ المتراكبة قصدًا لا تحمل السمة", () => {
    // ⓘ تُفتح من داخل نافذة اللعبة لتعلوها — تراكبٌ مقصود يعبّر عنه
    // z-index:260 في style.css. لو حملت السمة لأغلقت اللعبة تحتها.
    const tag = HTML.match(/<div[^>]*id="rules-modal"[^>]*>/);
    assert.ok(tag, "لا وجود لـ#rules-modal");
    assert.doesNotMatch(tag[0], /data-modal-solo/,
        "#rules-modal تراكبٌ مقصود فوق اللعبة، لا قرينٌ يزيحها");
});

test("كل نافذةٍ من القشرة تملك زرّ إغلاقها", () => {
    // الإزاحة تمرّ بزرّ الإغلاق نفسه كي يجري تنظيف النافذة (مسح الرسائل…)
    // كما لو أغلقها الزائر بيده. فبلا الزرّ يسقط القانون إلى نزع الصنف.
    for (const id of SOLO) {
        const i = HTML.indexOf(`id="${id}"`);
        const seg = HTML.slice(i, i + 400);
        assert.match(seg, /class="modal-close"/,
            `#${id} بلا .modal-close — ستُزاح بلا تنظيف`);
    }
});

test("الحزمة المبنيّة تحمل القانون فعلًا", () => {
    // app.js أثرُ بناءٍ لا يُحرَّر يدويًّا؛ فتعديل src/main.js دون
    // `npm run build` يترك الموقع بالعطل نفسه بلا أي رسالة خطأ.
    const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
    assert.ok(app.includes("[data-modal-solo].active"),
        "القانون غائب عن app.js — أُعيد البناء بعد تعديل main.js؟");
});
