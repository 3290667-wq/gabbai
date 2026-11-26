// «גבאי» — זיהוי דפוס התשלום של כל הורה, וניסוח שמותאם לו (וואטסאפ, מייל ושיחת טלפון).
// עמיחי 26.11.2026: «הורה שלא שילם כמה פעמים יסווג כהורה דחיין וכדו׳ — שהניסוח של המייל והטלפון ישתנה בהתאמה לכל סוג הורה».
// הסיווג מחושב מחדש בכל פעולה מתוך ההיסטוריה של המשפחה (pays, debt, contacts, plans, dispute) — לא תווית ידנית.
// אפשר לעקוף אותו ידנית מחדר הגבייה (f.override). הסוג לא מוצג להורה עצמו — רק למזכירות.
'use strict';

const ils = (n) => `₪${Math.round(+n || 0).toLocaleString('he-IL')}`;
const TECH = /פג תוקף|בוטל|הרשאה|תקרה|חסום|מוגבל|פרטי/;
const NOCOVER = /כיסוי/;

// סדר העדיפות = סדר הבדיקה ב-classify
const PERSONAS = {
  dispute: {
    label: 'חולק על החיוב', ico: 'shield', tone: 'bad',
    who: 'ההורה טוען שכבר שילם, או שהחיוב לא נכון.',
    rule: 'ההורה אמר «כבר שילמתי» או ערער על הסכום',
    approach: 'עוצרים את התזכורות האוטומטיות. מזכירה בודקת ומחזירה תשובה עם פירוט.',
    channel: 'שיחה ממזכירה', cadence: 'בלי תזכורות עד שהבירור נגמר',
    phone: 'ההורה הזה טוען שהחיוב לא נכון או שכבר שילם. אל תבקש תשלום ואל תשלח קישור. הקשב, אמור שאתה מבין, שהמזכירות תבדוק ותחזור אליו עם פירוט מלא, והעבר למזכירה ([נציג|בירור חיוב]).',
  },
  hardship: {
    label: 'מתקשה כלכלית', ico: 'heart', tone: 'info',
    who: 'הוראת הקבע חוזרת שוב ושוב בגלל חוסר כיסוי, או שכבר ביקש פריסה.',
    rule: 'שתי החזרות או יותר בגלל «אין כיסוי», או הסדר תשלומים קודם',
    approach: 'בעדינות ובצנעה. מציעים פריסה כבר בהודעה הראשונה, ומזכירים שאפשר לפנות לוועדת ההנחות. בלי לחץ ובלי להזכיר את קרן הפינוקים.',
    channel: 'וואטסאפ אישי, ואחר כך שיחה', cadence: 'תזכורת אחת לחודש, לא יותר',
    phone: 'ההורה הזה מתקשה כלכלית. דבר ברכות ובצנעה, אל תלחץ ואל תזכיר את קרן הפינוקים או «מה חסר». פתח בכך שאתה רוצה לעזור. הצע מיד פריסה לשלושה או ארבעה תשלומים, ואמור שאם גם זה קשה — אפשר לבקש שיחה עם ועדת ההנחות של המוסד, בדיסקרטיות מלאה ([נציג|ועדת הנחות]).',
  },
  silent: {
    label: 'לא מגיב', ico: 'phone', tone: 'warn',
    who: 'קיבל כמה פניות ולא ענה לאף אחת.',
    rule: 'שלוש פניות או יותר בלי תשובה',
    approach: 'מחליפים ערוץ: שיחת טלפון במקום עוד הודעה. ההודעה קצרה מאוד, בשם מנהל המוסד, ומבקשת רק סימן חיים.',
    channel: 'טלפון, ואחריו וואטסאפ קצר', cadence: 'ניסיון אחד ביום, בשעה אחרת בכל פעם',
    phone: 'ההורה הזה לא ענה לכמה פניות. אל תפתח בסכום. אמור שרצית רק לוודא שהכול בסדר אצלם ושההודעות הגיעו, ושאל איך נוח לו לסגור את זה — קישור, פריסה או שיחה עם המזכירה. אם הוא ממהר — שאל רק מתי נוח לחזור אליו.',
  },
  procrastinator: {
    label: 'דחיין', ico: 'calendar', tone: 'warn',
    who: 'משלם בסוף, אבל רק אחרי כמה תזכורות ובאיחור.',
    rule: 'שני תשלומים או יותר באיחור, או שתי החזרות שהוסדרו רק אחרי תזכורות',
    approach: 'חם אבל ברור: סכום, תאריך יעד מדויק, ובקשה לסגור עכשיו בקישור. מציעים לעבור לחיוב קבוע באשראי, כדי שלא יצטרך לזכור.',
    channel: 'וואטסאפ, ומייל עם תאריך יעד', cadence: 'תזכורת, ואחריה מעקב אחרי 48 שעות',
    phone: 'ההורה הזה נוטה לדחות — הוא משלם, אבל רק אחרי כמה תזכורות. היה חם אבל ממוקד: אמור את הסכום ואת תאריך היעד, והצע לשלוח קישור עכשיו כדי לסגור את זה בדקה במהלך השיחה. אם הוא אומר «אחר כך» — בקש ממנו יום ושעה מדויקים ותאשר אותם. בסוף הצע בעדינות לעבור לחיוב קבוע באשראי כדי שלא יצטרך לזכור.',
  },
  technical: {
    label: 'תקלה טכנית', ico: 'card', tone: 'info',
    who: 'משלם בזמן, והפעם החיוב נכשל מסיבה טכנית (כרטיס שפג, הרשאה שבוטלה).',
    rule: 'החזרה אחת, מסיבה טכנית, אצל הורה שמשלם בדרך כלל',
    approach: 'קצר ומעשי: מסבירים מה קרה ושולחים קישור לעדכון אמצעי התשלום. אין צורך בתזכורות נוספות.',
    channel: 'וואטסאפ עם קישור לעדכון', cadence: 'תזכורת אחת, ואחריה מעקב אחרי שבוע',
    phone: 'אצל ההורה הזה החיוב נכשל מסיבה טכנית, לא בגלל שאינו משלם. היה קליל ומעשי: הסבר מה קרה במשפט אחד (למשל שהכרטיס פג תוקף), והצע קישור לעדכון הכרטיס ולתשלום החודש. אל תציע פריסה אלא אם הוא מבקש.',
  },
  newbie: {
    label: 'הורה חדש', ico: 'wave', tone: 'info',
    who: 'נרשם השנה, ועוד לא מכיר את הסדרי התשלום.',
    rule: 'פחות משלושה חודשי היסטוריה במוסד',
    approach: 'מקבלים בברכה ומסבירים את הסדר: מתי יורד החיוב, איך משלמים, ואיפה רואים הכול באזור ההורים.',
    channel: 'וואטסאפ ומייל', cadence: 'תזכורת אחת עם הסבר',
    phone: 'זה הורה חדש במוסד. קבל אותו בברכה, ושאל אם הכול טוב עם הילדים בהתחלה. הסבר בפשטות איך עובד התשלום של שכר הלימוד, ושאפשר לראות הכול באזור ההורים. רק אז הצע להסדיר את החודש בקישור.',
  },
  reliable: {
    label: 'משלם למופת', ico: 'trophy', tone: 'ok',
    who: 'תמיד משלם בזמן, בלי תזכורות.',
    rule: 'אין איחורים ואין החזרות בהיסטוריה',
    approach: 'מודים לו. אם קרתה תקלה — מתנצלים על הטרחה ומניחים שזו טעות טכנית. בלי לחץ ובלי תזכורות חוזרות.',
    channel: 'וואטסאפ', cadence: 'לכל היותר תזכורת אחת',
    phone: 'ההורה הזה משלם תמיד בזמן. פתח בתודה על השותפות, אמור שבטח מדובר בתקלה טכנית, והצע קישור כדי לחסוך לו טרחה. אל תלחץ בשום צורה.',
  },
};

// ---------- signals from history
function signals(f) {
  const pays = f.pays || [];
  const monthly = pays.filter((p) => p.m && !/רישום/.test(p.m));
  const late = monthly.filter((p) => (+p.late || 0) >= 5).length;
  const returned = monthly.filter((p) => p.st === 'fix').length + (f.debt ? 1 : 0);
  const reasons = [...(f.returns || []), ...(f.debt?.reason ? [f.debt.reason] : [])];
  const noCover = reasons.filter((r) => NOCOVER.test(r)).length;
  const tech = reasons.filter((r) => TECH.test(r)).length;
  const rems = monthly.reduce((s, p) => s + (+p.rem || 0), 0);
  const avgRem = monthly.length ? rems / monthly.length : 0;
  return {
    months: monthly.length + (f.debt ? 1 : 0), late, returned, noCover, tech, avgRem: Math.round(avgRem * 10) / 10,
    unanswered: +f.contacts || 0, plans: +f.plans || 0, dispute: !!f.dispute, debt: f.debt?.amount || 0,
  };
}

function classify(f) {
  const s = signals(f);
  const why = [];
  let key;
  if (s.dispute) { key = 'dispute'; why.push('ההורה ערער על החיוב'); }
  else if (s.noCover >= 2 || s.plans >= 1) {
    key = 'hardship';
    if (s.noCover >= 2) why.push(`${s.noCover} החזרות בגלל חוסר כיסוי`);
    if (s.plans) why.push(s.plans === 1 ? 'כבר ביקש פריסה בעבר' : `${s.plans} הסדרי פריסה בעבר`);
  } else if (s.unanswered >= 3) { key = 'silent'; why.push(`${s.unanswered} פניות בלי תשובה`); }
  else if (s.late >= 2 || (s.returned >= 2 && s.avgRem >= 1)) {
    key = 'procrastinator';
    if (s.late) why.push(`${s.late} תשלומים באיחור`);
    if (s.returned >= 2) why.push(`${s.returned} החזרות של הוראת הקבע`);
    if (s.avgRem >= 1) why.push(`בממוצע ${s.avgRem} תזכורות עד שמשלם`);
  } else if (s.months < 3 && !s.tech) { key = 'newbie'; why.push(`${s.months} חודשים במוסד`); }
  else if (s.tech >= 1 && s.returned <= 1) { key = 'technical'; why.push(f.debt?.reason ? `החיוב נכשל: ${f.debt.reason}` : 'תקלה טכנית בחיוב'); if (!s.late) why.push('בדרך כלל משלם בזמן'); }
  else if (!s.late && s.returned === 0) { key = 'reliable'; why.push(`${s.months} חודשים, כולם בזמן`); }
  else if (s.returned >= 2 || s.late) { key = 'procrastinator'; why.push(`${s.returned} החזרות`); }
  else { key = 'technical'; why.push('החזרה אחת בלבד'); }
  const auto = key;
  if (f.override && PERSONAS[f.override]) { key = f.override; why.unshift('נקבע ידנית בחדר הגבייה'); }
  const p = PERSONAS[key];
  return { key, auto, manual: key !== auto, label: p.label, ico: p.ico, tone: p.tone, why, signals: s };
}

// ---------- wording
// ctx: {inst, url, amount, fund:{goal,got,title,sharePct}, kind:'remind'|'plan'|'receipt', plan:{n,each}, due}
function dueDate(days) {
  let d = new Date(Date.now() + days * 864e5);
  const wd = (x) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Jerusalem' }).format(x);
  while (wd(d) === 'Sat' || wd(d) === 'Fri') d = new Date(d.getTime() + 864e5); // לא יעד בשישי־שבת
  return new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' }).format(d);
}
function compose(f, key, c) {
  const inst = c.inst; const first = (f.parent || '').split(' ')[0];
  const month = f.debt?.month || 'החודש';
  const forM = f.debt?.month ? `לחודש ${f.debt.month}` : 'של החודש'; // «שכר הלימוד לחודש כסלו» / «של החודש»
  const ofM = f.debt?.month ? `של חודש ${f.debt.month}` : 'של החודש';
  const amount = ils(c.amount);
  const missing = c.fund ? ils(c.fund.goal - c.fund.got) : '';
  const fundLine = c.fund ? `כל תשלום בזמן מוסיף ${c.fund.sharePct}% לקרן הפינוקים של הילדים — חסרים עוד ${missing} ל${c.fund.title}.` : '';
  const kids = (f.kids || []).map((k) => k.n);
  const kidsTxt = kids.length > 1 ? `${kids.slice(0, -1).join(', ')} ו${kids[kids.length - 1]}` : kids[0] || 'הילדים';
  const L = c.url;
  if (c.kind === 'plan') {
    const pl = c.plan || {};
    const head = key === 'hardship' ? `כפי שדיברנו, ובשמחה — רשמנו פריסה של ${pl.n} תשלומים של ${ils(pl.each)}. אם בהמשך יהיה קושי, פשוט כתבו לנו.` :
      key === 'procrastinator' ? `כפי שסיכמנו בטלפון — ${pl.n} תשלומים של ${ils(pl.each)}. הראשון היום, בקישור הזה, והבאים יירדו אוטומטית.` :
        `כפי שסיכמנו בטלפון — הסדר של ${pl.n} תשלומים של ${ils(pl.each)}. זה הקישור לתשלום הראשון.`;
    return { subject: `הסדר תשלומים — ${inst.replace(/[«»]/g, '')}`, button: `לתשלום הראשון|${L}`,
      text: `${inst}\n\nשלום ${f.parent},\n${head}\n${L}\n\nתודה ששותפים בחינוך הילדים 🙏` };
  }
  const T = {
    reliable: {
      subject: `תקלה קטנה בחיוב — ${inst.replace(/[«»]/g, '')}`,
      text: `${inst}\n\nשלום ${f.parent},\nקודם כול תודה — אתם מהמשפחות שתמיד משלמות בזמן, וזה עוזר לנו מאוד.\nהחיוב ${ofM} לא עבר, כנראה בגלל תקלה טכנית (${f.debt?.reason || 'בבנק'}). סליחה על הטרחה.\nכדי לחסוך לכם התעסקות, אפשר להסדיר ${amount} כאן בדקה:\n${L}\n\nתודה ששותפים בחינוך של ${kidsTxt} 🙏`,
      button: `להסדרה בדקה|${L}`,
    },
    technical: {
      subject: `צריך לעדכן את אמצעי התשלום — ${inst.replace(/[«»]/g, '')}`,
      text: `${inst}\n\nשלום ${f.parent},\nהחיוב של שכר הלימוד ${forM} לא עבר: ${f.debt?.reason || 'תקלה באמצעי התשלום'}.\nזה קורה, ומסדרים את זה בדקה: בקישור הזה מעדכנים את הכרטיס ומשלמים ${amount}. החיובים הבאים יירדו מהכרטיס החדש.\n${L}\n\nתודה רבה 🙏`,
      button: `לעדכון הכרטיס ולתשלום|${L}`,
    },
    procrastinator: {
      subject: `שכר לימוד${f.debt?.month ? ' ' + f.debt.month : ''} — להסדרה עד ${dueDate(3)}`,
      text: `${inst}\n\nשלום ${f.parent},\nשכר הלימוד ${forM} (${amount}) עדיין פתוח.\nנבקש להסדיר עד ${dueDate(3)}. זה לוקח דקה, בקישור:\n${L}\n\nכדי שלא תצטרכו לזכור כל חודש — אפשר לעבור לחיוב קבוע באשראי. השיבו «קבוע» ונסדר.\n${fundLine}\nתודה 🙏`,
      button: `לתשלום עכשיו|${L}`,
    },
    hardship: {
      subject: `שכר הלימוד — אפשר לפרוס בנוחות`,
      text: `${inst}\n\nשלום ${f.parent},\nראינו שהחיוב ${forM} לא עבר. אנחנו יודעים שיש תקופות לא פשוטות, ורוצים שיהיה לכם נוח.\nאפשר לפרוס את ${amount} לשניים, שלושה או ארבעה תשלומים — פשוט השיבו כמה, ונסדר. מי שמעדיף לשלם עכשיו יכול כאן:\n${L}\n\nואם גם זה קשה כרגע — אפשר לבקש שיחה דיסקרטית עם ועדת ההנחות של המוסד.\nבברכה ובהערכה 🙏`,
      button: `לתשלום או לפריסה|${L}`,
    },
    silent: {
      subject: `רק לוודא שהכול בסדר — ${inst.replace(/[«»]/g, '')}`,
      text: `${inst}\n\n${first} שלום,\nכתבנו כמה פעמים ולא שמענו מכם — רק רצינו לוודא שהכול בסדר אצלכם.\nשכר הלימוד ${forM} (${amount}) עדיין פתוח. מספיקה תשובה של מילה אחת: «קישור», «פריסה» או «תתקשרו».\n${L}\n\nבברכה, הנהלת המוסד`,
      button: `לסגור עכשיו|${L}`,
    },
    newbie: {
      subject: `ברוכים הבאים — כך משלמים את שכר הלימוד`,
      text: `${inst}\n\nשלום ${f.parent}, וברוכים הבאים לתלמוד התורה!\nכמה מילים על הסדר: שכר הלימוד יורד בהוראת קבע ב-10 לכל חודש, ואת כל התשלומים רואים באזור ההורים.\nהחיוב ${forM} לא עבר (${f.debt?.reason || 'תקלה בהוראת הקבע'}), ואפשר להסדיר ${amount} כאן:\n${L}\n\n${fundLine}\nשאלה? פשוט השיבו להודעה 🙏`,
      button: `לתשלום|${L}`,
    },
    dispute: {
      subject: `בירור החיוב — ${inst.replace(/[«»]/g, '')}`,
      text: `${inst}\n\nשלום ${f.parent},\nקיבלנו את הפנייה שלכם לגבי החיוב ${ofM}. המזכירות בודקת, ותחזור אליכם עם פירוט מלא.\nעד שהבירור יסתיים לא נשלח תזכורות.\n\nתודה על הסבלנות 🙏`,
      button: null,
    },
  };
  return T[key] || T.reliable;
}

module.exports = { PERSONAS, classify, signals, compose, ils };
