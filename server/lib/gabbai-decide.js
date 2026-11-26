// «גבאי» — שכבת ההחלטה שיושבת לפני Claude (עמיחי 26.11.2026: «כדאי להכניס מודל החלטה כדי שזה יעבוד יותר מדויק ויותר מהר?» → «כן»).
// 1. decide(f)   — מנוע «הצעד הבא» לכל משפחה: איזו הצעה, כמה תשלומים מותר, באיזה ערוץ ומתי, וסיכוי משוער לתשלום. הכול מהנתונים, בקוד.
// 2. fast(f, …)  — מסנן מהיר: הודעה קצרה עם כוונה אחת ברורה מקבלת תשובה מתבנית, בלי Claude. הסכומים ישר מהכרטיס.
// 3. directive() — ההחלטה כהנחיה מחייבת ל-Claude, כשהוא כן נדרש (הודעה מורכבת). Claude רק מנסח.
// אין כאן שום שירות חיצוני — חוקים בלבד. למידה מהתוצאות תתווסף כשיצטברו פניות אמיתיות (הרישום כבר נעשה ב-99_gabbai_wa.js).
'use strict';
const GP = require('./gabbai-persona');

const ils = GP.ils;
const TZ = 'Asia/Jerusalem';

// ---------- זמן שליחה: לא בשבת, לא בערב שבת אחרי 13:00, רק 09:00–21:30
function ilParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { wd: p.weekday, h: +p.hour, m: +p.minute };
}
function sendWindow(now = new Date(), evening = false) {
  const { wd, h, m } = ilParts(now); const t = h + m / 60;
  if (wd === 'Sat') return { now: false, text: 'במוצאי שבת, אחרי צאת השבת' };
  if (wd === 'Fri' && t >= 13) return { now: false, text: 'במוצאי שבת, אחרי צאת השבת' };
  if (evening) {
    if (t >= 19.5 && t < 21.5) return { now: true, text: 'עכשיו — שעת ערב, כשההורים בבית' };
    if (t < 19.5 && wd !== 'Fri') return { now: false, text: 'היום ב-20:00, כשההורים בבית' };
    return { now: false, text: wd === 'Fri' ? 'במוצאי שבת' : 'מחר ב-20:00' };
  }
  if (t < 9) return { now: false, text: 'היום ב-09:00' };
  if (t >= 21.5) return { now: false, text: wd === 'Fri' ? 'במוצאי שבת' : 'מחר ב-09:00' };
  return { now: true, text: 'עכשיו' };
}

// ---------- מנוע «הצעד הבא»
const BASE_P = { reliable: 0.9, technical: 0.82, newbie: 0.7, procrastinator: 0.55, hardship: 0.4, silent: 0.25, dispute: 0.1 };

function decide(f, S, now = new Date()) {
  const pr = GP.classify(f); const s = pr.signals; const key = pr.key;
  const debt = f.debt?.amount || 0; const monthly = +f.monthly || 0;
  const why = [...pr.why];
  const d = { persona: key, personaLabel: pr.label, debt, action: 'none', label: '', offer: '', maxPlan: 0, suggestPlan: 0, fund: false, channel: '', when: '', prob: null, why, avoid: [] };

  if (key === 'dispute') {
    Object.assign(d, { action: 'human', label: 'בירור במזכירות — בלי בקשת תשלום', offer: 'לא מבקשים כסף ולא שולחים קישור. מעבירים למזכירה שתבדוק ותחזור עם פירוט.', channel: 'שיחה ממזכירה', when: 'היום' });
    d.avoid.push('לא לבקש תשלום', 'לא לשלוח קישור', 'לא להציע פריסה');
  } else if (!debt) {
    Object.assign(d, { action: 'none', label: 'אין מה לגבות — רק תודה', offer: 'החשבון מסודר. מודים, ולא מזכירים כסף.', channel: 'וואטסאפ', when: '—' });
    d.prob = null; why.push('אין תשלום פתוח');
  } else {
    const big = monthly && debt > 2 * monthly; // חוב של יותר מחודשיים
    if (big) why.push(`החוב (${ils(debt)}) גדול מחודשיים של שכר לימוד`);
    if (f.plan && (f.plan.paid || 0) < f.plan.n) why.push(`כבר יש הסדר פעיל: ${f.plan.paid || 0} מתוך ${f.plan.n} שולמו`);
    const P = {
      hardship: () => ({ action: 'plan', label: big ? 'פריסה ל-4 תשלומים + ועדת הנחות' : 'פריסה ל-3 תשלומים', suggestPlan: big ? 4 : 3, maxPlan: 4,
        offer: `להציע מיד פריסה ל-${big ? 4 : 3} תשלומים של ${ils(Math.ceil(debt / (big ? 4 : 3)))}, ולהזכיר בעדינות שאפשר לפנות לוועדת ההנחות בדיסקרטיות.`, channel: 'וואטסאפ אישי, ואחר כך שיחה', avoid: ['לא להזכיר את קרן הפינוקים', 'לא ללחוץ'] }),
      silent: () => ({ action: 'call', label: 'החלפת ערוץ: שיחת טלפון', suggestPlan: 0, maxPlan: 3, evening: true,
        offer: 'לא לפתוח בסכום. לבקש רק סימן חיים ולתת בחירה של מילה אחת: «קישור», «פריסה» או «תתקשרו».', channel: 'טלפון, ואחריו וואטסאפ קצר', avoid: ['לא לשלוח עוד הודעה ארוכה'] }),
      procrastinator: () => ({ action: 'link', label: 'קישור עם תאריך יעד + מעבר לחיוב קבוע', suggestPlan: 0, maxPlan: big ? 3 : 2, fund: true,
        offer: `לבקש לסגור עכשיו ${ils(debt)} בקישור, עם תאריך יעד מדויק; להציע לעבור לחיוב קבוע באשראי. פריסה רק אם יבקש — עד ${big ? 3 : 2} תשלומים.`, channel: 'וואטסאפ, ומייל עם תאריך יעד' }),
      technical: () => ({ action: 'update_card', label: 'קישור לעדכון הכרטיס', suggestPlan: 0, maxPlan: 2, fund: true,
        offer: `להסביר במשפט אחד מה קרה (${f.debt.reason}) ולשלוח קישור לעדכון אמצעי התשלום ולתשלום ${ils(debt)}. לא להציע פריסה אלא אם יבקש.`, channel: 'וואטסאפ עם קישור' }),
      newbie: () => ({ action: 'link', label: 'הסבר על הסדר התשלום + קישור', suggestPlan: 0, maxPlan: 3, fund: true,
        offer: `לקבל בברכה, להסביר שהחיוב יורד ב-10 לחודש ושהכול באזור ההורים, ואז קישור ל-${ils(debt)}.`, channel: 'וואטסאפ ומייל' }),
      reliable: () => ({ action: 'link', label: 'התנצלות על התקלה + קישור', suggestPlan: 0, maxPlan: 2, fund: true,
        offer: `להודות על השותפות, להניח שזו תקלה טכנית, ולשלוח קישור ל-${ils(debt)}. בלי שום לחץ.`, channel: 'וואטסאפ' }),
    }[key]();
    d.avoid.push(...(P.avoid || []));
    delete P.avoid;
    const ev = P.evening; delete P.evening;
    Object.assign(d, P);
    d.when = sendWindow(now, ev).text;
    // סיכוי משוער לתשלום תוך 48 שעות — חוקים בלבד, לא מודל נלמד
    let p = BASE_P[key] ?? 0.5;
    if (big) p -= 0.1;
    if (s.unanswered > 3) p -= 0.05 * (s.unanswered - 3);
    if (s.late >= 3) p -= 0.05;
    if (f.plan && (f.plan.paid || 0) > 0) p += 0.08;
    d.prob = Math.round(Math.max(0.05, Math.min(0.95, p)) * 100);
  }
  if (!d.when) d.when = sendWindow(now).text;
  return d;
}

// ---------- ההחלטה כהנחיה ל-Claude
function directive(d) {
  const plan = d.maxPlan ? `פריסה מותרת עד ${d.maxPlan} תשלומים בלבד${d.suggestPlan ? ` (להציע ${d.suggestPlan})` : ' — רק אם ההורה מבקש'}.` : 'אסור להציע פריסה.';
  return `החלטת המערכת להורה הזה (מחייבת — אל תסטה ממנה ואל תמציא הצעה אחרת): ${d.label}. ${d.offer} ${plan}`
    + `${d.fund ? '' : ' אל תזכיר את קרן הפינוקים אלא אם ההורה שואל עליה.'}${d.avoid.length ? ` להימנע: ${d.avoid.join('; ')}.` : ''}`;
}

// ---------- מסנן מהיר: כוונה אחת ברורה בהודעה קצרה → תשובה מתבנית
const INTENTS = [
  ['thanks', /^(תודה( רבה)?|תודה רבה רבה|יישר כח|ישר כח|ישר כוח|יישר כוח|תודה ענקית|אחלה|מעולה|👍|🙏|❤️)[\s!.🙏👍]*$/],
  ['hello', /^(שלום|שלום לך|היי|הי|בוקר טוב|ערב טוב|צהריים טובים|שבוע טוב|גבאי)[\s!.,]*$/],
  ['paid', /(כבר שילמתי|שילמתי כבר|^שילמתי|שולם כבר|העברתי (כבר )?(את )?(ה)?כסף|כבר העברתי)/],
  ['human', /(מזכיר|לדבר עם (מישהו|אדם|בן אדם|נציג|מישהי)|נציג|בן אדם אמיתי|תתקשרו|שיתקשרו|שמישהו יתקשר)/],
  ['plan', /(פריסה|לפרוס|בתשלומים|כמה תשלומים|לחלק לתשלומים)/],
  ['link', /(קישור|לינק|רוצה לשלם|איך (אני )?משלמ|איך לשלם|לשלם עכשיו|שלח(ו)? לי (את )?ה?תשלום)/],
  ['when', /(מתי (יורד|ה?חיוב|יורד ה?חיוב|החיוב הבא)|החיוב הבא)/],
  ['fund', /(קרן ה?פינוקים|ה?פינוק הבא|כמה חסר ל?פינוק|כמה חסר לקרן)/],
  ['balance', /(כמה (אני )?(חייב|נשאר|צריך לשלם|פתוח)|מה המצב( שלי)?|מצב ה?חשבון|יתרה|יש לי חוב|מה פתוח|אני חייב משהו)/],
];
function detect(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 70 || /\n/.test(t)) return null;              // הודעה ארוכה או מורכבת → Claude
  if (/[?？].*[?？]/.test(t)) return null;                          // שתי שאלות
  if (/(למה|מדוע|אבל|בעיה|קשה|כועס|לא הוגן|לא מבין|הילד|הבן|הבת|לומד|מלמד|רב |גננת)/.test(t)) return null; // רגש, תלונה או ילדים → Claude
  const hits = INTENTS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (hits.length !== 1) return hits.length === 2 && hits.includes('link') && hits.includes('balance') ? { intent: 'link', n: null } : null;
  const n = hits[0] === 'plan' ? (+(t.match(/([2-9])/) || [])[1] || ({ שני: 2, שתי: 2, שלוש: 3, ארבע: 4, חמש: 5, שש: 6 }[(t.match(/(שני|שתי|שלוש|ארבע|חמש|שש)/) || [])[1]] || null)) : null;
  return { intent: hits[0], n };
}

// מחזיר { intent, text } — הטקסט עם תגים ([קישור] / [פריסה N] / [מזכירה]) שהשרת מחליף — או null כשצריך את Claude
function fast(f, text, d, G) {
  const m = detect(text); if (!m) return null;
  const first = `ר׳ ${(f.parent || '').split(' ')[0]}`;
  const S = G.S; const debt = f.debt?.amount || 0; const v = G.view(f);
  const missing = Math.max(0, S.fund.goal - S.fund.got);
  const planNote = f.plan && (f.plan.paid || 0) < f.plan.n ? ` לפי ההסדר: ${f.plan.n} תשלומים של ${ils(f.plan.each)}, שולמו ${f.plan.paid || 0}.` : '';
  const R = (t) => ({ intent: m.intent, text: t });
  switch (m.intent) {
    case 'thanks': return R(`בשמחה, ${first}! 🙏 תמיד כאן אם צריך משהו.`);
    case 'hello': return R(debt && d.action !== 'human'
      ? `שלום ${first}! 😊 במה אפשר לעזור? אפשר לשאול על הילדים, על מצב התשלומים או לבקש קישור לתשלום.`
      : `שלום ${first}! 😊 במה אפשר לעזור? אפשר לשאול על הילדים בלימודים, על החיוב הבא או על קרן הפינוקים.`);
    case 'when': return R(`${first}, החיוב הבא של שכר הלימוד (${ils(f.monthly)}) יורד ב-${v.nextCharge}.${planNote}${debt ? ` חוץ מזה יש תשלום פתוח של ${ils(debt)}${f.debt.month ? ` עבור ${f.debt.month}` : ''}.` : ''}`);
    case 'fund': return R(`${first}, ${S.fund.sharePct}% מכל תשלום בזמן נכנסים לקרן הפינוקים של הילדים. הפינוק הבא: ${S.fund.title}. נאספו ${ils(S.fund.got)} מתוך ${ils(S.fund.goal)} — חסרים עוד ${ils(missing)}. החלק שלכם עד היום: ${ils(v.mine)} 🎁`);
    case 'balance':
      if (!debt) return R(`${first}, הכול מסודר — אין תשלום פתוח ✔️ החיוב הבא יורד ב-${v.nextCharge}. תודה על השותפות! 🙏`);
      if (d.action === 'human') return R(`${first}, יש בבירור אצל המזכירות חיוב של ${ils(debt)}${f.debt.month ? ` עבור ${f.debt.month}` : ''}. עד שהבירור יסתיים לא נבקש תשלום — המזכירה תחזור אליך עם פירוט.`);
      return R(`${first}, יש תשלום פתוח של ${ils(debt)}${f.debt.month ? ` עבור ${f.debt.month}` : ''}.${planNote}\n${d.action === 'plan' ? `אפשר בשמחה לפרוס ל-${d.suggestPlan} תשלומים של ${ils(Math.ceil(debt / d.suggestPlan))} — לכתוב «פריסה» ונסדר. ` : ''}מי שמעדיף לסגור עכשיו, זה הקישור:\n[קישור]`);
    case 'link':
      if (!debt) return R(`${first}, אין כרגע שום תשלום פתוח — הכול מסודר ✔️ החיוב הבא יורד ב-${v.nextCharge}.`);
      if (d.action === 'human') return R(`${first}, החיוב הזה בבירור אצל המזכירות, ולכן לא שולחים כרגע קישור. הן יחזרו אליך עם פירוט.\n[מזכירה]`);
      return R(`בשמחה, ${first}. ${d.action === 'update_card' ? 'בקישור מעדכנים את הכרטיס ומשלמים — לוקח דקה:' : 'זה הקישור, לוקח דקה:'}\n[קישור]`);
    case 'plan': {
      if (!debt) return R(`${first}, אין כרגע תשלום פתוח, אז אין צורך בפריסה ✔️`);
      if (!d.maxPlan) return R(`${first}, את הנושא הזה תסדר איתך המזכירה באופן אישי.\n[מזכירה]`);
      if (f.plan && (f.plan.paid || 0) < f.plan.n) return R(`${first}, כבר יש הסדר פעיל: ${f.plan.n} תשלומים של ${ils(f.plan.each)}, שולמו ${f.plan.paid || 0}. לשינוי ההסדר — אעביר למזכירה.\n[מזכירה]`);
      const want = m.n || d.suggestPlan || Math.min(3, d.maxPlan);
      if (want > d.maxPlan) return R(`${first}, אפשר לפרוס עד ${d.maxPlan} תשלומים של ${ils(Math.ceil(debt / d.maxPlan))}. לסדר כך? לכתוב «פריסה ${d.maxPlan}». ליותר מזה — אעביר למזכירה.`);
      return R(`בשמחה, ${first} 🙏\n[פריסה ${Math.max(2, want)}]`);
    }
    case 'paid':
      if (!debt) return R(`${first}, ראיתי — התשלום התקבל והכול מסודר ✔️ תודה רבה!`);
      return R(`${first}, תודה שעדכנת. אצלנו עוד מופיע ${ils(debt)} פתוח, כנראה שהתשלום עוד לא נקלט. אני מעביר למזכירות לבדיקה, ועד אז לא נשלח תזכורות.\n[מזכירה]`);
    case 'human': return R(`בוודאי, ${first}.\n[מזכירה]`);
    default: return null;
  }
}

module.exports = { decide, directive, fast, detect, sendWindow };
