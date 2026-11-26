// «גבאי» — הדגמה חיה (26.11.2026, האקתון): כניסת הורים לכרטיס הילד, קישור תשלום, שיחה יוצאת מהקו של המוסד
// (phonechat2 במצב gabbai), ותזכורת/קבלה בוואטסאפ ובמייל.
// המצב נשמר בקובץ JSON אחד (DATA_DIR/gabbai-live.json) — זה דמו, לא ספר החשבונות.
// בטיחות: מחייגים ושולחים רק למספרים שברשימת הדמו (DEMO_PHONES). וואטסאפ יוצא דרך הגשר, שמאפשר רק את המספר של עמיחי.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const GP = require('../lib/gabbai-persona'); // סוגי הורים + ניסוח מותאם (26.11)

const HOME = process.env.HOME || '/home/user';
const INST = 'תלמוד תורה «אור התורה»';
// מספרים שמותר לחייג אליהם בדמו: עמיחי + חברי הצוות בהאקתון
const DEMO_PHONES = {
  '0500000001': 'עמיחי',
  '0500000004': 'חייא',
  '0500000002': 'יוסי',
  '0500000003': 'יוסף',
};
const WA_OK = new Set(['0500000001']); // הגשר שולח וואטסאפ רק לעמיחי
const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('972')) d = '0' + d.slice(3); return d; };
const shekel = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`;

// מקור הנתונים: charges / receipts / so_returns / arrangements ב-data/demo.db (26.11.2026).
// מיפוי חודשים אחיד לכל המערכת: חיוב 10.09 = תשרי, 10.10 = חשוון, 10.11 = כסלו, 10.12 = טבת. דמי רישום: ₪300.
function seed() {
  return {
    v: 2,
    waReal: false, // וואטסאפ אמיתי כבוי כברירת מחדל — רק הטלפון המדומה. הפעלה ידנית מהטלפון המדומה בלבד.
    fund: { goal: 3000, got: 2200, donations: true, title: 'מסיבת חנוכה עם סופגניות לכל הכיתות', sharePct: 6 },
    families: [
      {
        id: 'levi', family: 'לוי', parent: 'יעקב לוי', phone: '0500000001', email: '', code: '1234', monthly: 1450,
        kids: [
          { n: 'מנחם', c: 'כיתה ג׳', teacher: 'הרב שלמה גרוס', icon: 'book-blue', att: 97, learn: 'חומש ויקרא — פרשת צו', star: 'זכה ב«מתמיד השבוע» פעמיים החודש' },
          { n: 'שמואל', c: 'כיתה ה׳', teacher: 'הרב משה פרלשטיין', icon: 'book-green', att: 94, learn: 'חומש ויקרא עם רש״י', star: 'השתתף במבחן החודשי וקיבל «מצוין»' },
          { n: 'יוסף', c: 'גן', teacher: 'הגננת מרים', icon: 'teddy', att: 99, learn: 'אותיות ונקודות — אות ק׳', star: 'למד לברך «שהכל» בקול לפני כל ממתק בגן' },
        ],
        pays: [
          { d: '24.09.2026', m: 'תשרי', s: 1450, k: 'transfer', st: 'fix', note: 'הוראת הקבע חזרה (אין כיסוי) — שולם בהעברה אחרי 2 תזכורות', late: 14, rem: 2 },
          { d: '11.10.2026', m: 'חשוון', s: 1450, k: 'debit', st: 'ok' },
          { d: '20.10.2026', m: 'דמי רישום', s: 300, k: 'transfer', st: 'ok', note: 'שולם באיחור', late: 40 },
        ],
        returns: ['אין כיסוי בחשבון'],
        debt: { amount: 1450, month: 'כסלו', reason: 'ההרשאה בוטלה', date: '25.11.2026' },
      },
      {
        id: 'cohen', family: 'כהן', parent: 'אברהם כהן', phone: '0500000002', email: '', code: '2222', monthly: 980,
        kids: [
          { n: 'אהרן', c: 'כיתה ב׳', teacher: 'הרב יחיאל שטרן', icon: 'book-blue', att: 92, learn: 'פרשת השבוע', star: 'קורא יפה בתפילה' },
          { n: 'דוד', c: 'כיתה ז׳', teacher: 'הרב אליעזר בלוי', icon: 'book-green', att: 95, learn: 'גמרא — בבא מציעא', star: 'סיים את פרק אלו מציאות' },
        ],
        pays: [
          { d: '10.09.2026', m: 'דמי רישום', s: 300, k: 'debit', st: 'ok' },
          { d: '10.09.2026', m: 'תשרי', s: 980, k: 'debit', st: 'ok' },
          { d: '11.10.2026', m: 'חשוון', s: 980, k: 'debit', st: 'ok' },
          { d: '10.11.2026', m: 'כסלו', s: 980, k: 'debit', st: 'ok' },
        ],
        debt: null,
      },
      {
        id: 'friedman', family: 'פרידמן', parent: 'חיים פרידמן', phone: '0500000003', email: '', code: '3333', monthly: 650,
        kids: [{ n: 'ישראל', c: 'כיתה א׳', teacher: 'הרב נחום קליין', icon: 'book-blue', att: 90, learn: 'קריאה בסידור', star: 'קיבל סידור ראשון במסיבת הסידור' }],
        pays: [
          { d: '10.09.2026', m: 'תשרי', s: 650, k: 'debit', st: 'ok' },
          { d: '05.10.2026', m: 'דמי רישום', s: 300, k: 'check', st: 'ok', note: 'חוב קטן שהוסדר — שולם בצ׳ק במזכירות', late: 25, rem: 1 },
          { d: '11.10.2026', m: 'חשוון', s: 650, k: 'debit', st: 'ok' },
          { d: '10.11.2026', m: 'כסלו', s: 650, k: 'debit', st: 'ok' },
        ],
        debt: null,
      },
      {
        id: 'weiss', family: 'וייס', parent: 'מרדכי וייס', phone: '0500000004', email: '', code: '4444', monthly: 1200,
        kids: [
          { n: 'נחמן', c: 'כיתה ד׳', teacher: 'הרב שלמה גרוס', icon: 'book-green', att: 96, learn: 'משניות — מסכת שבת', star: 'חזר בעל פה על פרק שלם' },
          { n: 'אליהו', c: 'כיתה א׳', teacher: 'הרב נחום קליין', icon: 'book-blue', att: 93, learn: 'קריאה בסידור', star: 'עוזר לחברים בכיתה' },
        ],
        pays: [
          { d: '10.09.2026', m: 'דמי רישום', s: 300, k: 'debit', st: 'ok' },
          { d: '10.09.2026', m: 'תשרי', s: 1200, k: 'debit', st: 'ok', note: 'שכר לימוד ₪1,100 + הסעות ₪100' },
          { d: '11.10.2026', m: 'חשוון', s: 1200, k: 'debit', st: 'ok', note: 'שכר לימוד ₪1,100 + הסעות ₪100' },
        ],
        plans: 1, // ביקש ב-25.11 לחייב שוב ב-1.12 ולפרוס לשלושה תשלומים (ממתין לאישור הגזבר)
        debt: { amount: 1200, month: 'כסלו', reason: 'אין כיסוי בחשבון', date: '13.11.2026' },
      },
      {
        id: 'shapira', family: 'שפירא', parent: 'שלמה שפירא', phone: '0500000105', email: '', code: '5555', monthly: 1900,
        kids: [
          { n: 'נפתלי', c: 'כיתה ח׳', teacher: 'הרב יהושע ברנר', icon: 'books', att: 95, learn: 'גמרא — מסכת קידושין', star: 'נבחר לחזן בתפילת שחרית של הכיתה' },
          { n: 'אברהם', c: 'כיתה ו׳', teacher: 'הרב אהרן ליבוביץ', icon: 'book-green', att: 93, learn: 'משניות — מסכת ברכות', star: 'סיים את סדר המשניות של החודש' },
          { n: 'יצחק', c: 'כיתה ג׳', teacher: 'הרב שלמה גרוס', icon: 'book-blue', att: 96, learn: 'חומש ויקרא — פרשת צו', star: 'קיבל תעודת הצטיינות בכתיבה' },
          { n: 'בנימין', c: 'גן', teacher: 'הגננת מרים', icon: 'teddy', att: 91, learn: 'אותיות ונקודות — אות ל׳', star: 'שר יפה בסיום מסיבת הגן' },
        ],
        pays: [
          { d: '10.11.2026', m: 'כסלו', s: 1900, k: 'debit', st: 'ok' },
          { d: '15.11.2026', m: 'הסדר תשלומים — תשלום 1 מתוך 4', s: 1025, k: 'transfer', st: 'fix', note: 'על החוב של תשרי וחשוון ודמי הרישום', rem: 1 },
        ],
        returns: ['אין כיסוי בחשבון', 'אין כיסוי בחשבון'], // תשרי (15.09) וחשוון (14.10)
        plans: 1,
        plan: { n: 4, each: 1025, from: '15.11.2026', paid: 1, at: '2026-10-28T10:10:00.000Z' },
        debt: { amount: 3075, month: 'תשרי וחשוון', reason: 'אין כיסוי בחשבון — בהסדר תשלומים', date: '14.10.2026' },
      },
      {
        id: 'goldberg', family: 'גולדברג', parent: 'יהודה גולדברג', phone: '0520000106', email: '', code: '6666', monthly: 1100,
        kids: [
          { n: 'משה', c: 'כיתה ה׳', teacher: 'הרב משה פרלשטיין', icon: 'book-green', att: 88, learn: 'חומש ויקרא עם רש״י', star: 'שאל שאלה יפה בשיעור והרב סיפר עליה לכיתה' },
          { n: 'אריה', c: 'כיתה ב׳', teacher: 'הרב יחיאל שטרן', icon: 'lion', att: 90, learn: 'פרשת השבוע', star: 'עוזר לסדר את הסידורים אחרי התפילה' },
        ],
        pays: [],
        contacts: 4,
        debt: { amount: 3600, month: 'תשרי, חשוון וכסלו (כולל דמי רישום)', reason: 'לא התקבל תשלום מתחילת השנה', date: '10.11.2026' },
      },
      {
        id: 'rosenthal', family: 'רוזנטל', parent: 'אליעזר רוזנטל', phone: '0540000107', email: '', code: '7777', monthly: 650,
        kids: [
          { n: 'צבי', c: 'כיתה ח׳', teacher: 'הרב יהושע ברנר', icon: 'books', att: 97, learn: 'גמרא — מסכת קידושין', star: 'חזר בעל פה על דף שלם בגמרא' },
        ],
        pays: [
          { d: '10.09.2026', m: 'תשרי', s: 650, k: 'debit', st: 'ok' },
          { d: '20.09.2026', m: 'דמי רישום', s: 300, k: 'transfer', st: 'ok', late: 10 },
          { d: '11.10.2026', m: 'חשוון', s: 650, k: 'debit', st: 'ok' },
          { d: '10.11.2026', m: 'כסלו', s: 650, k: 'debit', st: 'ok' },
        ],
        dispute: true,
        debt: { amount: 300, month: 'תשרי, חשוון וכסלו — הסעות (3 × ₪100)', reason: 'ההורה טוען שהבן לא נוסע בהסעה — בבירור', date: '10.11.2026' },
      },
      {
        id: 'berger', family: 'ברגר', parent: 'נתן ברגר', phone: '0530000108', email: '', code: '8888', monthly: 1450,
        kids: [
          { n: 'יעקב', c: 'כיתה ד׳', teacher: 'הרב שלמה גרוס', icon: 'book-green', att: 98, learn: 'משניות — מסכת שבת', star: 'זכה בחידון פרשת השבוע' },
          { n: 'מאיר', c: 'כיתה א׳', teacher: 'הרב נחום קליין', icon: 'book-blue', att: 94, learn: 'קריאה בסידור', star: 'קרא לבד את ברכות השחר' },
          { n: 'שמעון', c: 'גן', teacher: 'הגננת מרים', icon: 'teddy', att: 96, learn: 'אותיות ונקודות — אות ק׳', star: 'צייר ציור יפה לפרשת השבוע' },
        ],
        pays: [
          { d: '10.09.2026', m: 'דמי רישום', s: 300, k: 'card', st: 'ok' },
          { d: '10.09.2026', m: 'תשרי', s: 1450, k: 'card', st: 'ok' },
          { d: '11.10.2026', m: 'חשוון', s: 1450, k: 'card', st: 'ok' },
        ],
        debt: { amount: 1450, month: 'כסלו', reason: 'כרטיס האשראי פג תוקף', date: '10.11.2026' },
      },
      {
        id: 'klein', family: 'קליין', parent: 'דניאל קליין', phone: '0580000109', email: '', code: '9999', monthly: 1100, joined: '2026-08-25T08:00:00.000Z',
        override: 'newbie', // הצטרפו באלול (25.8) — המזכירות סימנה «הורה חדש» לשנה הראשונה
        kids: [
          { n: 'חיים', c: 'כיתה ו׳', teacher: 'הרב אהרן ליבוביץ', icon: 'book-green', att: 95, learn: 'משניות — מסכת ברכות', star: 'השתלב יפה בכיתה כבר בשבוע הראשון' },
          { n: 'זאב', c: 'כיתה ג׳', teacher: 'הרב שלמה גרוס', icon: 'book-blue', att: 93, learn: 'חומש ויקרא — פרשת צו', star: 'מצא חברים חדשים ומשחק איתם בהפסקה' },
        ],
        pays: [
          { d: '25.08.2026', m: 'דמי רישום', s: 300, k: 'card', st: 'ok', note: 'ביום ההרשמה' },
          { d: '08.09.2026', m: 'תשרי', s: 1100, k: 'transfer', st: 'ok', note: 'בהעברה — הוראת הקבע עוד לא הוקמה' },
          { d: '11.10.2026', m: 'חשוון', s: 1100, k: 'debit', st: 'ok' },
          { d: '10.11.2026', m: 'כסלו', s: 1100, k: 'debit', st: 'ok' },
        ],
        debt: null,
      },
      {
        id: 'adler', family: 'אדלר', parent: 'ברוך אדלר', phone: '0500000110', email: '', code: '0000', monthly: 1450,
        kids: [
          { n: 'אלחנן', c: 'כיתה ז׳', teacher: 'הרב אליעזר בלוי', icon: 'books', att: 99, learn: 'גמרא — בבא מציעא', star: 'סיים את פרק אלו מציאות' },
          { n: 'שלום', c: 'כיתה ה׳', teacher: 'הרב משה פרלשטיין', icon: 'book-green', att: 97, learn: 'חומש ויקרא עם רש״י', star: 'קיבל «מצוין» במבחן החודשי' },
          { n: 'ישעיהו', c: 'כיתה ב׳', teacher: 'הרב יחיאל שטרן', icon: 'book-blue', att: 95, learn: 'פרשת השבוע', star: 'קורא בקול נעים בתפילה' },
        ],
        pays: [
          { d: '10.09.2026', m: 'דמי רישום', s: 300, k: 'debit', st: 'ok' },
          { d: '10.09.2026', m: 'תשרי', s: 1450, k: 'debit', st: 'ok' },
          { d: '11.10.2026', m: 'חשוון', s: 1450, k: 'debit', st: 'ok' },
          { d: '10.11.2026', m: 'כסלו', s: 1450, k: 'debit', st: 'ok' },
        ],
        debt: null,
      },
    ],
    links: {},   // token → {fam, amount, n, of, created, paid_at}
    events: [],  // {id, at, fam, kind, text, who}
    seq: 0,
  };
}

module.exports = (ctx) => {
  const { r, C, DATA_DIR } = ctx;
  const FILE = path.join(DATA_DIR, 'gabbai-live.json');
  const BOT_KEY = (() => { try { return fs.readFileSync(path.join(HOME, '.secrets', 'gabbai-bot.key'), 'utf8').trim(); } catch { return ''; } })();
  const PUB = (process.env.PUBLIC_BASE_URL || 'https://mazkira.de/gabbai-bb513363').replace(/\/$/, '');
  const BP = process.env.BASE_PATH || '/';
  const SECRET = crypto.createHash('sha256').update('gbp:' + (BOT_KEY || 'x') + ':' + (process.env.MZE_MASTER_KEY || '')).digest();

  let S;
  try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { S = seed(); }
  if ((S.v || 1) < 2) {
    const base = seed();
    for (const b of base.families) {
      const f = S.families.find((x) => x.id === b.id);
      if (!f) { S.families.push(b); continue; }
      f.pays = b.pays.concat(f.pays.filter((p) => /«גבאי»/.test(p.note || ''))); f.returns = b.returns; f.plans = b.plans;
      if (f.debt && b.debt) f.debt = { ...b.debt, amount: Math.min(f.debt.amount, b.debt.amount) };
    }
    S.v = 2;
  }
  const persona = (f) => GP.classify(f);
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(S, null, 1)); fs.renameSync(FILE + '.tmp', FILE); }, 150); };
  const fam = (id) => S.families.find((f) => f.id === id);
  const ALT_PHONES = { '0500000099': '0500000001' }; // הקו העסקי של עמיחי → משפחת לוי (שיחת הדגמה)
  const famByPhone = (p) => { const n = normPhone(p); return S.families.find((f) => f.phone === n) || S.families.find((f) => f.phone === ALT_PHONES[n]); };
  const ev = (f, kind, text, who) => {
    const e = { id: ++S.seq, at: C.nowISO(), fam: f?.id || null, family: f?.family || null, kind, text: String(text).slice(0, 600), who: who || null };
    S.events.push(e); if (S.events.length > 400) S.events.splice(0, S.events.length - 400); save(); return e;
  };

  // ---------- parent session (HMAC token in its own cookie, demo-grade)
  const sign = (id) => { const exp = Date.now() + 12 * 3600e3; const p = `${id}.${exp}`; return `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
  const parentOf = (req) => {
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)gbp=([^;]+)/); if (!m) return null;
    const [id, exp, sig] = decodeURIComponent(m[1]).split('.');
    if (!id || !sig || +exp < Date.now()) return null;
    const ok = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('base64url');
    if (ok.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(ok), Buffer.from(sig))) return null;
    return fam(id) || null;
  };
  const cookie = (tok, age) => `gbp=${tok ? encodeURIComponent(tok) : ''}; Path=${BP}; HttpOnly; SameSite=Lax${process.env.COOKIE_INSECURE ? '' : '; Secure'}; Max-Age=${age}`;

  const openLink = (f) => Object.entries(S.links).find(([, l]) => l.fam === f.id && !l.paid_at);
  const view = (f, ensureLink) => {
    const paid = f.pays.filter((p) => p.st !== 'wait').reduce((s, p) => s + p.s, 0);
    const onTime = f.pays.filter((p) => p.st === 'ok' && !(+p.late > 0)).reduce((s, p) => s + p.s, 0); // הקרן מקבלת רק מתשלום בזמן
    // הורה עם חוב פתוח שנכנס לאזור ההורים — מקבל קישור תשלום (חוץ מבירור חיוב פתוח)
    if (ensureLink && f.debt && !f.dispute && !openLink(f)) {
      if (f.plan && f.plan.paid < f.plan.n) newLink(f, Math.min(f.plan.each, f.debt.amount), { n: f.plan.paid + 1, of: f.plan.n }); else newLink(f, f.debt.amount);
    }
    const link = openLink(f);
    return {
      inst: INST, family: f.family, parent: f.parent, monthly: f.monthly, kids: f.kids, pays: f.pays,
      debt: f.debt, plan: f.plan || null, paid, mine: Math.round(onTime * S.fund.sharePct / 100), fund: S.fund,
      pay_url: link ? `${PUB}/pay/?t=${link[0]}` : null, nextCharge: '10.12.2026',
    };
  };
  const loginTries = new Map();
  r.post('/api/public/parent/login', ({ body, req }) => {
    const ip = req.ip || '-'; const t = (loginTries.get(ip) || []).filter((x) => Date.now() - x < 15 * 60e3);
    if (t.length >= 10) throw new C.HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.');
    const f = famByPhone(body.phone);
    if (!f || String(body.code || '').trim() !== f.code) { loginTries.set(ip, [...t, Date.now()]); throw new C.HttpError(401, 'הטלפון או קוד ההורה לא נכונים'); }
    ev(f, 'login', `הורי משפחת ${f.family} נכנסו לאזור ההורים`);
    return { $cookie: cookie(sign(f.id), 12 * 3600), ok: true, data: view(f, true) };
  }, { public: true });
  r.post('/api/public/parent/logout', () => ({ $cookie: cookie('', 0), ok: true }), { public: true });
  r.get('/api/public/parent/me', ({ req }) => {
    const f = parentOf(req);
    if (!f) return { user: null, demo: S.families.filter((x) => x.via !== 'join').map((x) => ({ family: x.family, phone: x.phone.replace(/^(\d{3})/, '$1-'), code: x.code })) };
    return { user: f.id, data: view(f, true) };
  }, { public: true });

  // ---------- payment link
  const newLink = (f, amount, extra = {}) => {
    for (const [k, l] of Object.entries(S.links)) if (l.fam === f.id && !l.paid_at) delete S.links[k];
    const tok = crypto.randomBytes(9).toString('base64url');
    S.links[tok] = { fam: f.id, amount: Math.round(amount), created: C.nowISO(), ...extra }; save();
    return { tok, url: `${PUB}/pay/?t=${tok}` };
  };
  r.get('/api/public/gabbai/pay/:tok', ({ params }) => {
    const l = S.links[params.tok]; if (!l) throw C.notFound('הקישור לא נמצא או שפג תוקפו');
    const f = fam(l.fam);
    return { inst: INST, family: f.family, parent: f.parent, kids: f.kids.map((k) => `${k.n} (${k.c})`), amount: l.amount, n: l.n || null, of: l.of || null,
      month: f.debt?.month || null, paid_at: l.paid_at || null, fund: S.fund, share: Math.round(l.amount * S.fund.sharePct / 100) };
  }, { public: true });
  r.post('/api/public/gabbai/pay/:tok', async ({ params, body }) => {
    const l = S.links[params.tok]; if (!l) throw C.notFound('הקישור לא נמצא או שפג תוקפו');
    const f = fam(l.fam);
    if (l.paid_at) return { ok: true, already: true };
    const digits = String(body.card || '').replace(/\D/g, '');
    if (digits.length < 8) throw C.bad('מספר הכרטיס קצר מדי (בהדגמה אפשר כל מספר)');
    l.paid_at = C.nowISO();
    const d = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(new Date());
    f.pays.push({ d, m: f.debt ? `${f.debt.month}${l.n ? ` — תשלום ${l.n} מתוך ${l.of}` : ''}` : 'תשלום', s: l.amount, k: 'link', st: 'fix', note: 'שולם בקישור מ«גבאי»', rem: +f.contacts || 0 });
    if (f.debt?.reason && !(f.returns || []).includes(f.debt.reason)) f.returns = [...(f.returns || []), f.debt.reason];
    f.contacts = 0;
    if (f.debt) { f.debt.amount = Math.max(0, f.debt.amount - l.amount); if (!f.debt.amount) f.debt = null; }
    if (f.plan && l.n) f.plan.paid = (f.plan.paid || 0) + 1;
    if (!f.debt) f.plan = null; // החוב נסגר (גם בקישור מלא בזמן שיש הסדר) — לא להשאיר הסדר ישן שהבוט ימשיך להציע
    const share = Math.round(l.amount * S.fund.sharePct / 100);
    S.fund.got = Math.min(S.fund.goal, S.fund.got + share);
    save();
    ev(f, 'paid', `שולם ${shekel(l.amount)} בקישור — משפחת ${f.family}. ${shekel(share)} נכנסו לקרן הפינוקים (${S.fund.title})`);
    const msg = `${INST}\n\nשלום ${f.parent}, תודה רבה! 🙏\nהתקבל תשלום של ${shekel(l.amount)} עבור שכר הלימוד.\n${f.debt ? `נותר להסדיר: ${shekel(f.debt.amount)}.` : 'החשבון שלכם מסודר.'}\n\n${persona(f).key === 'hardship' ? `בזכותכם נכנסו ${shekel(share)} לקרן הפינוקים של הילדים.` : `בזכותכם נכנסו ${shekel(share)} לקרן הפינוקים של הילדים — חסרים עוד ${shekel(S.fund.goal - S.fund.got)} ל${S.fund.title}.`}\n\nהאזור של ההורים: ${PUB}/parent/`;
    send(f, 'both', msg, 'קבלה — תשלום שכר לימוד', 'האזור של ההורים|' + `${PUB}/parent/`).catch(() => {});
    return { ok: true, fund: S.fund, share };
  }, { public: true });

  // ---------- outgoing messages
  // סימולטור וואטסאפ (26.11, עמיחי: «שהצוות יוכל להריץ דמו ולעשות QA בלי חיבור אמיתי לווצאפ»):
  // כל הודעת וואטסאפ שהמערכת שולחת נכנסת גם לטלפון המדומה בחדר הגבייה. משפחה שאין לה וואטסאפ אמיתי בדמו,
  // או כשהשליחה האמיתית כבויה (S.waReal=false) — ההודעה נמסרת רק לסימולטור, ונחשבת «נשלחה».
  const simPush = (f, chat, from, text) => {
    S.sim = S.sim || []; S.simSeq = (S.simSeq || 0) + 1;
    S.sim.push({ id: S.simSeq, at: C.nowISO(), fam: f.id, chat: chat === 'group' ? 'group' : 'dm', from: from === 'parent' ? 'parent' : 'bot', text: String(text).slice(0, 4000) });
    if (S.sim.length > 800) S.sim.splice(0, S.sim.length - 800);
    save(); return S.simSeq;
  };
  const wa = async (f, text) => {
    simPush(f, 'dm', 'bot', text);
    if (S.waReal === false) return { ok: true, sim: true };
    if (!WA_OK.has(f.phone)) return { ok: true, sim: true };
    try {
      const res = await fetch('http://127.0.0.1:3002/send-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: `972${f.phone.slice(1)}@c.us`, text, force: true }), signal: AbortSignal.timeout(15000) });
      return res.ok ? { ok: true } : { ok: false, why: `הגשר החזיר ${res.status}` };
    } catch (e) { return { ok: false, why: String(e.message || e) }; }
  };
  const mail = (f, subject, text, button) => new Promise((resolve) => {
    if (!f.email) return resolve({ ok: false, why: 'אין כתובת מייל למשפחה' });
    const args = ['--to', f.email, '--subject', subject, '--from-name', `גבאי · ${INST.replace(/[«»]/g, '')}`, '--title', subject];
    if (button) args.push('--button', button);
    const p = execFile(path.join(HOME, 'bin', 'send-mail'), args, { timeout: 60000, env: { HOME, PATH: process.env.PATH, LANG: 'C.UTF-8' } }, (err, out, errOut) => {
      resolve(err ? { ok: false, why: String(errOut || err.message).slice(0, 200) } : { ok: true });
    });
    p.stdin.end(text);
  });
  async function send(f, channel, text, subject, button) {
    const out = {};
    if (channel === 'whatsapp' || channel === 'both') {
      out.whatsapp = await wa(f, text);
      ev(f, out.whatsapp.ok ? 'wa' : 'warn', out.whatsapp.ok ? `וואטסאפ נשלח להורי משפחת ${f.family}${out.whatsapp.sim ? ' (לטלפון המדומה)' : ''}` : `וואטסאפ לא נשלח: ${out.whatsapp.why}`);
    }
    if (channel === 'email' || channel === 'both') {
      out.email = await mail(f, subject, text, button);
      ev(f, out.email.ok ? 'mail' : 'warn', out.email.ok ? `מייל נשלח ל-${f.email}` : `מייל לא נשלח: ${out.email.why}`);
    }
    return out;
  }
  // ניסוח לפי סוג ההורה (server/lib/gabbai-persona.js) — אותו סכום ואותו קישור, טון אחר
  const wording = (f, url, amount, extra = {}) => GP.compose(f, persona(f).key, { inst: INST, url, amount, fund: S.fund, kind: 'remind', ...extra });
  const sendWording = async (f, ch, url, amount, extra) => {
    const p = persona(f); const w = wording(f, url, amount, extra);
    ev(f, 'persona', `סוג ההורה: ${p.label} (${p.why.join(' · ')}) — נבחר נוסח «${GP.PERSONAS[p.key].label}»`);
    const out = await send(f, ch, w.text, w.subject, w.button);
    if (Object.values(out).some((x) => x.ok)) { f.contacts = (+f.contacts || 0) + 1; save(); }
    return out;
  };

  // ---------- phone bot (phonechat2 mode gabbai) — localhost + shared key
  const botAuth = (req, k) => {
    const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!BOT_KEY || k !== BOT_KEY || !(peer === '127.0.0.1' || peer === '::1') || req.headers['x-real-ip']) throw new C.HttpError(403, 'אסור');
  };
  r.get('/api/public/gabbai/bot/context', ({ req, query }) => {
    botAuth(req, query.k);
    const f = famByPhone(query.phone);
    if (!f) return { note: '(הערת מערכת: המספר לא מזוהה במערכת. אמור בנימוס שכנראה טעות במספר, התנצל והיפרד.)' };
    const kids = f.kids.map((k) => `${k.n} (${k.c})`).join(', ');
    const missing = S.fund.goal - S.fund.got;
    const state = f.debt
      ? `החוב הפתוח: ${f.debt.amount} שקלים — החיוב של ${f.debt.month} פתוח מאז ${f.debt.date}, סיבה: ${f.debt.reason}.`
      : 'אין חוב פתוח — החשבון מסודר. אם הוא שואל — הודה לו ואמור שהכול בסדר.';
    const plan = f.plan ? ` כבר סוכם הסדר: ${f.plan.n} תשלומים של ${f.plan.each} שקלים, מתאריך ${f.plan.from}.` : '';
    const link = openLink(f) ? ' כבר נשלח אליו קישור תשלום שעוד לא שולם.' : '';
    const pr = persona(f);
    ev(f, 'call', `שיחה עם הורי משפחת ${f.family} התחילה (${DEMO_PHONES[f.phone] || f.phone}) — סוג ההורה: ${pr.label}`);
    return { note: `\n(פרטי השיחה הזאת: אתה מדבר עם ${f.parent}, אבא במשפחת ${f.family}. הילדים במוסד: ${kids}. שכר הלימוד החודשי: ${f.monthly} שקלים. ${state}${plan}${link} `
      + `אמצעי קשר: וואטסאפ ${WA_OK.has(f.phone) ? 'זמין' : 'לא זמין בהדגמה'}, מייל ${f.email ? 'זמין' : 'לא קיים במערכת'}. `
      + `קרן הפינוקים: ${S.fund.sharePct} אחוז מכל תשלום בזמן נכנסים לקרן; הפינוק הבא — ${S.fund.title}; חסרים עוד ${missing} שקלים. `
      + `סוג ההורה לפי היסטוריית התשלומים: «${pr.label}» (${pr.why.join(', ')}). איך לדבר איתו בשיחה הזאת — זה גובר על הסגנון הכללי: ${GP.PERSONAS[pr.key].phone} `
      + `לעולם אל תגיד לו לאיזה סוג סיווגת אותו.)` };
  }, { public: true });
  r.post('/api/public/gabbai/bot/event', ({ req, body }) => {
    botAuth(req, body.k);
    const f = famByPhone(body.phone);
    ev(f, body.kind === 'end' ? 'call_end' : 'say', body.text, body.who === 'parent' ? 'parent' : body.who === 'bot' ? 'bot' : null);
    if (f && body.who === 'parent' && f.contacts) { f.contacts = 0; save(); }
    return { ok: true };
  }, { public: true });
  r.post('/api/public/gabbai/bot/action', async ({ req, body }) => {
    botAuth(req, body.k);
    const f = famByPhone(body.phone);
    if (!f) return { note: '(הערת מערכת: המספר לא מזוהה — שום פעולה לא בוצעה.)' };
    const ch = /שני|שתי|both/.test(body.channel || '') ? 'both' : /מייל|mail/.test(body.channel || '') ? 'email' : 'whatsapp';
    if (body.kind === 'human') {
      if (/שילם|שולם|ערעור|ערער|לא נכון|טעות|בירור/.test(body.reason || '')) { f.dispute = true; save(); }
      ev(f, 'human', `הועבר למזכירות: ${body.reason || 'ההורה ביקש לדבר עם אדם'} — משפחת ${f.family}`);
      return { note: '(הערת מערכת: נרשמה בקשה — המזכירה של המוסד תחזור אליו עוד היום. אמור לו את זה, הודה לו והיפרד.)' };
    }
    if (body.kind === 'plan') {
      const total = f.debt?.amount || f.monthly;
      const n = Math.max(2, Math.min(4, parseInt(body.n, 10) || 3));
      const each = Math.ceil(total / n);
      f.plan = { n, each, from: body.date || 'היום', paid: 0, at: C.nowISO() };
      const { url } = newLink(f, each, { n: 1, of: n });
      ev(f, 'plan', `סוכם הסדר עם משפחת ${f.family}: ${n} תשלומים של ${shekel(each)} — הראשון ${body.date || 'היום'}`);
      f.plans = (+f.plans || 0) + 1;
      const out = await sendWording(f, ch, url, each, { kind: 'plan', plan: { n, each } });
      return { note: `(הערת מערכת: ההסדר נרשם — ${n} תשלומים של ${each} שקלים. ${sentNote(out)})` };
    }
    // link
    const amount = Math.round(+body.amount || f.debt?.amount || f.monthly);
    const { url } = newLink(f, amount);
    ev(f, 'link', `נוצר קישור תשלום ${shekel(amount)} למשפחת ${f.family}`);
    const out = await sendWording(f, ch, url, amount);
    return { note: `(הערת מערכת: נוצר קישור תשלום על ${amount} שקלים. ${sentNote(out)})` };
  }, { public: true });
  const sentNote = (out) => {
    const parts = [];
    if (out.whatsapp) parts.push(out.whatsapp.ok ? 'הקישור נשלח עכשיו בוואטסאפ' : 'וואטסאפ לא נשלח');
    if (out.email) parts.push(out.email.ok ? 'הקישור נשלח עכשיו במייל' : 'המייל לא נשלח');
    const any = Object.values(out).some((x) => x.ok);
    return parts.join(', ') + '. ' + (any ? 'אמור לו שהקישור כבר אצלו, שהתשלום לוקח דקה, ושאל אם יש עוד משהו.' : 'אמור שהמזכירות תשלח לו את הקישור בהקדם.');
  };

  // ---------- shared with 99_gabbai_wa.js (קבוצת הוואטסאפ של המוסד)
  ctx.gabbai = { get S() { return S; }, INST, PUB, fam, famByPhone, normPhone, save, ev, view, persona, openLink, newLink, shekel, sign, cookie, GP, simPush, WA_OK };

  // ---------- admin (session)
  r.get('/api/gabbai/live', ({ query }) => {
    const since = +query.since || 0;
    return {
      families: S.families.map((f) => ({ id: f.id, family: f.family, parent: f.parent, phone: f.phone, who: DEMO_PHONES[f.phone] || null, email: f.email, code: f.code,
        debt: f.debt, plan: f.plan || null, link: openLink(f) ? `${PUB}/pay/?t=${openLink(f)[0]}` : null, kids: f.kids.length, persona: persona(f) })),
      phones: Object.entries(DEMO_PHONES).map(([p, n]) => ({ phone: p, name: n })),
      fund: S.fund, events: S.events.filter((e) => e.id > since).slice(-80), seq: S.seq,
    };
  });
  r.post('/api/gabbai/live/phone', ({ body }) => {
    const f = fam(body.id); if (!f) throw C.notFound();
    const p = normPhone(body.phone); if (!DEMO_PHONES[p]) throw C.bad('בהדגמה אפשר לבחור רק טלפון של חברי הצוות');
    f.phone = p; save(); return { ok: true };
  });
  const lastCall = new Map();
  r.post('/api/gabbai/live/call', async ({ body }) => {
    const f = fam(body.id); if (!f) throw C.notFound();
    if (!DEMO_PHONES[f.phone]) throw C.bad('המספר הזה לא ברשימת ההדגמה');
    if (Date.now() - (lastCall.get(f.phone) || 0) < 45e3) throw C.bad('כבר חייגנו למספר הזה לפני פחות מדקה — רגע');
    lastCall.set(f.phone, Date.now());
    ev(f, 'dial', `מחייג מהקו של ${INST} (03-0000000) להורי משפחת ${f.family} — ${DEMO_PHONES[f.phone]}`);
    const out = await new Promise((resolve) => execFile('bash', [path.join(HOME, 'phonechat2', 'call2.sh'), f.phone, 'gabbai'], { timeout: 30000, env: { HOME, PATH: process.env.PATH, LANG: 'C.UTF-8' } },
      (err, so, se) => resolve({ err, so: String(so || ''), se: String(se || '') })));
    const line = out.so.trim().split('\n').pop() || '';
    if (out.err || !/^CA[0-9a-f]{32} /.test(line)) { ev(f, 'warn', `החיוג נכשל: ${(line || out.se || String(out.err)).slice(0, 160)}`); throw C.bad('החיוג נכשל'); }
    return { ok: true, sid: line.split(' ')[0] };
  });
  r.post('/api/gabbai/live/remind', async ({ body }) => {
    const f = fam(body.id); if (!f) throw C.notFound();
    const amount = f.debt?.amount || f.monthly;
    const { url } = newLink(f, amount);
    ev(f, 'link', `נוצר קישור תשלום ${shekel(amount)} למשפחת ${f.family}`);
    const ch = body.channel === 'email' ? 'email' : body.channel === 'both' ? 'both' : 'whatsapp';
    const out = await sendWording(f, ch, url, amount);
    return { ok: true, out, url };
  });
  r.get('/api/gabbai/personas', ({ query }) => {
    const sample = '(קישור לתשלום)';
    const famOf = query.fam ? fam(query.fam) : null;
    const types = Object.entries(GP.PERSONAS).map(([key, p]) => ({ key, ...p,
      families: S.families.filter((f) => persona(f).key === key).map((f) => f.family) }));
    const previews = {};
    if (famOf) for (const key of Object.keys(GP.PERSONAS)) {
      const amount = famOf.debt?.amount || famOf.monthly;
      const w = GP.compose(famOf, key, { inst: INST, url: sample, amount, fund: S.fund, kind: 'remind' });
      previews[key] = { subject: w.subject, text: w.text, phone: GP.PERSONAS[key].phone };
    }
    return { types, families: S.families.map((f) => ({ id: f.id, family: f.family, persona: persona(f) })), previews };
  });
  r.post('/api/gabbai/live/persona', ({ body }) => {
    const f = fam(body.id); if (!f) throw C.notFound();
    if (body.key && !GP.PERSONAS[body.key]) throw C.bad('סוג הורה לא מוכר');
    const before = persona(f).label;
    f.override = body.key || null; if (body.key !== 'dispute') f.dispute = false; save();
    ev(f, 'persona', body.key ? `משפחת ${f.family} סווגה ידנית: «${GP.PERSONAS[body.key].label}» (היה: ${before})` : `משפחת ${f.family} חזרה לסיווג האוטומטי: «${persona(f).label}»`);
    return { ok: true, persona: persona(f) };
  });
  r.post('/api/gabbai/live/reset', () => { const keep = S.families.map((f) => [f.id, f.phone]); S = seed(); for (const [id, p] of keep) { const f = fam(id); if (f) f.phone = p; } save(); ev(null, 'reset', 'ההדגמה אופסה'); return { ok: true }; });
};
