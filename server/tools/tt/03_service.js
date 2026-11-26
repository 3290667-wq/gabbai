// tt/03_service.js — «גבאי» demo: operational/service data for the ten families of תלמוד תורה «אור התורה».
// Owns: approvals, tasks, task_comments, requests, request_updates, request_categories, outbox(+delivery), campaigns(+recipients),
// message_templates, notices, contact_log, voice_calls, voice_broadcasts, ivr_nodes, household_events, documents, audit_log (pruned),
// automation_events, automation_runs (history only — current slots kept so the scheduler does not re-fire), recurring_jobs,
// work_orders/work_order_events/bookings (emptied: the dashboard reads them). Re-runnable, one transaction.
// Shared-ish tables (outbox, contact_log, household_events, audit_log, automation_events) use ids from 700001 so other agents' rows survive a re-run.
// After a re-run of this script, run 04_service_fix.js (QA fixes: kosher-phone families, month mapping, receipts/sobounce/voiceline history, office phone).
'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '../../../data/demo.db'));
db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');

const BASE = 700001;
const AUDIT_WATERMARK = 3117; // settlement-era audit rows (pre tuition conversion)
const NOW = new Date().toISOString();
const T = (d, hm = '10:00') => new Date(`${d}T${hm}:00+02:00`).toISOString();
const J = (v) => JSON.stringify(v);
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all();
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
function ins(table, row) {
  const r = { ...row };
  const names = new Set(cols(table).map((c) => c.name));
  if (names.has('created_at') && !r.created_at) r.created_at = NOW;
  if (names.has('updated_at') && !r.updated_at) r.updated_at = r.created_at || NOW;
  const k = Object.keys(r);
  const res = db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => (r[x] !== null && typeof r[x] === 'object' ? J(r[x]) : r[x] ?? null)));
  return Number(res.lastInsertRowid);
}
// staff (users.id by role) and their display names in this demo
const U = { admin: 1, chair: 2, treasurer: 3, secretary: 4, bookkeeper: 8 };
const N = { chair: 'הרב שמחה ויסברג, מנהל המוסד', treasurer: 'ר׳ אהרן קרויס, גזבר', secretary: 'רחל מנדלסון, מזכירות', bookkeeper: 'טובה ליברמן, הנהלת חשבונות' };
const SIGN = { chair: ['הרב שמחה ויסברג', 'מנהל המוסד'], secretary: ['גב׳ רחל מנדלסון', 'מזכירת המוסד'], bookkeeper: ['גב׳ טובה ליברמן', 'מנהלת החשבונות'], treasurer: ['ר׳ אהרן קרויס', 'גזבר המוסד'] };
const HH = Object.fromEntries(db.prepare('SELECT * FROM households WHERE id BETWEEN 1 AND 10').all().map((h) => [h.id, h]));
if (Object.keys(HH).length !== 10) throw new Error('expected the ten families (run 01_core.js first)');
const fam = (id) => `משפחת ${HH[id].family_name}`;

const report = { nulled: {}, deleted: {}, inserted: {} };
db.exec('BEGIN');
try {
  // ------------------------------------------------------------------ 1. wipe
  // references from tables owned by others → NULL (only nullable columns)
  const myParents = new Set(['approvals', 'tasks', 'requests', 'campaigns', 'message_templates', 'work_orders', 'outbox', 'request_categories']);
  for (const { name: t } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    for (const f of db.prepare(`PRAGMA foreign_key_list(${t})`).all()) {
      if (!myParents.has(f.table)) continue;
      const own = ['task_comments', 'requests', 'request_updates', 'campaigns', 'campaign_recipients', 'notices', 'work_order_events', 'outbox_delivery', 'work_order_photos'].includes(t);
      if (own) continue;
      const c = cols(t).find((x) => x.name === f.from);
      if (c && !c.notnull) { const n = db.prepare(`UPDATE ${t} SET ${f.from}=NULL WHERE ${f.from} IS NOT NULL`).run().changes; if (n) report.nulled[`${t}.${f.from}`] = n; }
    }
  }
  const del = (t, where = '') => { if (!has(t)) return; const n = db.prepare(`DELETE FROM ${t} ${where}`).run().changes; report.deleted[t] = (report.deleted[t] || 0) + n; };
  del('work_order_photos'); del('work_order_events'); del('work_orders'); del('bookings'); del('recurring_jobs');
  del('task_comments'); del('request_updates'); del('requests'); del('request_categories');
  del('notices'); del('campaign_recipients'); del('campaigns'); del('message_templates');
  del('voice_calls'); del('voice_broadcasts'); del('ivr_nodes');
  del('documents'); del('approvals'); del('tasks');
  del('outbox_delivery', `WHERE outbox_id >= ${BASE} OR outbox_id NOT IN (SELECT id FROM outbox)`);
  del('outbox', `WHERE id >= ${BASE} OR campaign_id IS NOT NULL`);
  del('contact_log', `WHERE id >= ${BASE} OR household_id NOT IN (SELECT id FROM households)`);
  del('household_events', `WHERE id >= ${BASE} OR household_id NOT IN (SELECT id FROM households)`);
  del('automation_events');
  // runs: keep the rows of the current slots (today / this month / everyMs) so the scheduler does not run them again today
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()); const ym = today.slice(0, 7);
  del('automation_runs', `WHERE id >= ${BASE} OR NOT (slot='${today}' OR slot='${ym}' OR (slot LIKE 'e%' AND started_at >= '${NOW.slice(0, 10)}'))`);
  del('audit_log', `WHERE (id <= ${AUDIT_WATERMARK} AND entity <> 'users') OR id >= ${BASE} OR (entity = 'users' AND action IN ('login', 'logout', 'login_failed'))`);

  // ------------------------------------------------------------------ 2. request categories
  const CATS = [
    ['שאלות על חיוב שכר לימוד', 'bookkeeper', 5, 'חיוב, חויבתי, סכום, יתרה, חוב, טעות בחיוב, הסעות, ארוחות, דמי רישום', 'שלום, פנייתך בנושא החיוב התקבלה (פנייה {number}). מנהלת החשבונות תבדוק ותחזור אליך עד {due}.'],
    ['הנחות ומלגות', 'chair', 14, 'הנחה, מלגה, קושי כלכלי, הנחת אחים, הפחתה', 'שלום, בקשת ההנחה התקבלה (פנייה {number}) ותובא להחלטת הנהלת המוסד. נעדכן עד {due}.'],
    ['הסדר תשלומים', 'bookkeeper', 7, 'הסדר, פריסה, תשלומים, דחייה, לפרוס', null],
    ['אמצעי תשלום והוראת קבע', 'bookkeeper', 3, 'הוראת קבע, אשראי, כרטיס, הרשאה, בנק, חזר, החזרה, פג תוקף', null],
    ['אישורים וקבלות', 'secretary', 3, 'אישור, קבלה, מס הכנסה, אישור תשלום, אישור לימודים', 'שלום, הבקשה לאישור התקבלה (פנייה {number}). האישור יישלח אליך עד {due}.'],
    ['הסעות', 'secretary', 5, 'הסעה, הסעות, נהג, אוטובוס, תחנה, איסוף', null],
    ['ארוחות', 'secretary', 5, 'ארוחה, ארוחות, אוכל, צהריים, כריך', null],
    ['רישום ושיבוץ לכיתות', 'secretary', 7, 'רישום, הרשמה, כיתה, גן, מלמד, שיבוץ, שנה הבאה', null],
    ['כללי', 'secretary', 7, 'שאלה, בקשה, הצעה, תודה, טיול', null],
  ];
  const CAT = {};
  CATS.forEach(([name, role, sla, kw, tpl], i) => { CAT[name] = ins('request_categories', { id: i + 1, name, default_role: role, sla_days: sla, is_fault: 0, keywords: kw, reply_template: tpl, sort: (i + 1) * 10, active: 1, created_at: T('2026-08-01') }); });

  // ------------------------------------------------------------------ 3. approvals
  const AP = {};
  const approval = (key, a) => {
    const dec = (a.decisions || []).map(([role, decision, note, at]) => ({ role, user_id: U[role], user_name: N[role].split(',')[0], decision, note: note || null, at }));
    AP[key] = ins('approvals', { kind: a.kind || 'other', title: a.title, summary: a.summary, section: a.section, entity: a.hid ? 'households' : (a.entity || null), entity_id: a.hid || a.entity_id || null,
      amount: a.amount ?? null, required_roles_json: J(a.roles), decisions_json: J(dec), status: a.status || 'pending', requested_by: a.by ? U[a.by] : null, source: a.source || null,
      payload_json: J(a.payload || {}), due_date: a.due || null, decided_at: a.status && a.status !== 'pending' ? dec[dec.length - 1]?.at : null, created_at: a.at, updated_at: dec.length ? dec[dec.length - 1].at : a.at });
  };
  approval('shapira_discount', { title: 'הנחה של 15% בשכר הלימוד למשפחת שפירא', summary: 'ארבעה תלמידים במוסד (נפתלי, אברהם, יצחק ובנימין). המשפחה מתקשה כלכלית ופועלת בהסדר פריסה. מבוקשת הנחה של 285 ₪ לחודש מטבת עד סוף השנה.', section: 'billing', hid: 5, amount: 285, roles: ['chair', 'treasurer'], by: 'secretary', at: T('2026-11-23', '11:20'), due: '2026-11-30' });
  approval('rosenthal_refund', { title: 'החזר כספי למשפחת רוזנטל: חיוב הסעות שגוי בחשוון', summary: 'צבי (כיתה ח׳) לא רשום להסעה, ובחשוון חויבו 180 ₪ דמי הסעה. נבדק מול רשימת הנוסעים: החיוב שגוי.', section: 'payments', hid: 7, amount: 180, roles: ['treasurer'], by: 'bookkeeper', at: T('2026-11-22', '09:40'), due: '2026-11-29' });
  approval('rosenthal_bus', { title: 'ביטול דמי ההסעה של צבי רוזנטל מכסלו', summary: 'הסרת דמי ההסעה (180 ₪ לחודש) מהחיוב החודשי של משפחת רוזנטל עד סוף השנה.', section: 'billing', hid: 7, amount: 180, roles: ['chair'], by: 'bookkeeper', at: T('2026-11-22', '09:45') });
  approval('goldberg_letter', { kind: 'letter', title: 'מכתב התראה רשמי למשפחת גולדברג', summary: 'שלושה חודשים פתוחים (אלול, תשרי, חשוון), 3,300 ₪. נשלחו 4 תזכורות בוואטסאפ ושתי שיחות טלפון בלי מענה. המכתב יישלח בדואר ובמייל בחתימת מנהל המוסד.', section: 'collection', hid: 6, amount: 3300, roles: ['chair'], by: 'secretary', at: T('2026-11-17', '12:05') });
  approval('weiss_plan', { kind: 'arrangement', title: 'פריסת חוב חשוון של משפחת וייס ל-3 תשלומים', summary: 'הוראת הקבע של חשוון חזרה «אין כיסוי». האב ביקש לפרוס את 1,200 ₪ לשלושה תשלומים בדצמבר, ינואר ופברואר, בנוסף לחיוב השוטף.', section: 'collection', hid: 4, amount: 1200, roles: ['treasurer'], by: 'bookkeeper', at: T('2026-11-25', '10:30') });
  approval('klein_reg', { title: 'זיכוי חלקי בדמי הרישום למשפחת קליין', summary: 'המשפחה הצטרפה באלול תשפ״ז עם שני תלמידים (חיים וזאב). מבוקש זיכוי של 250 ₪ מדמי הרישום, כמקובל למצטרפים חדשים.', section: 'billing', hid: 9, amount: 250, roles: ['treasurer'], by: 'secretary', at: T('2026-11-24', '13:15') });
  approval('levi_meals', { title: 'ביטול דמי הארוחות של יוסף לוי (גן)', summary: 'יוסף מקבל ארוחה מהבית לפי הוראת רופא. ביטול 120 ₪ לחודש מתשרי.', section: 'billing', hid: 1, amount: 120, roles: ['chair'], status: 'approved', by: 'secretary', at: T('2026-09-28', '10:00'), decisions: [['chair', 'approve', 'מאושר עם אישור הרופא', T('2026-09-29', '08:40')]] });
  approval('shapira_plan', { kind: 'arrangement', title: 'הסדר פריסה למשפחת שפירא: 4 תשלומים', summary: 'פריסת חוב של 3,800 ₪ לארבעה תשלומים חודשיים של 950 ₪, מ-10.11 עד 10.2, בנוסף לשכר הלימוד השוטף.', section: 'collection', hid: 5, amount: 3800, roles: ['treasurer'], status: 'approved', by: 'bookkeeper', at: T('2026-10-13', '11:00'), decisions: [['treasurer', 'approve', 'מאושר. לעקוב אחרי כל תשלום', T('2026-10-14', '09:15')]] });
  approval('cohen_refund', { title: 'החזר כספי למשפחת כהן: חיוב כפול בתשרי', summary: 'הוראת הקבע של תשרי נגבתה פעמיים (980 ₪). מחזירים בהעברה בנקאית.', section: 'payments', hid: 2, amount: 980, roles: ['treasurer'], status: 'approved', by: 'bookkeeper', at: T('2026-10-19', '12:30'), decisions: [['treasurer', 'approve', null, T('2026-10-20', '08:05')]] });
  approval('adler_discount', { title: 'הנחת אחים למשפחת אדלר', summary: 'בקשה להנחת אחים של 10% לשלושה תלמידים.', section: 'billing', hid: 10, amount: 145, roles: ['chair'], status: 'rejected', by: 'secretary', at: T('2026-09-08', '10:10'), decisions: [['chair', 'reject', 'לפי התקנון הנחת אחים ניתנת מהתלמיד הרביעי', T('2026-09-10', '13:00')]] });
  approval('kislev_reminder', { kind: 'message', title: 'דיוור להורים: חיוב שכר לימוד כסלו ב-10.11', summary: 'תזכורת לכל המשפחות שבעוד יומיים יחויב שכר הלימוד של כסלו, ובקשה לוודא כיסוי בחשבון.', section: 'messages', source: 'messages', roles: ['chair'], status: 'approved', by: 'secretary', at: T('2026-11-05', '10:00'), decisions: [['chair', 'approve', null, T('2026-11-05', '14:20')]] });
  approval('trip', { kind: 'expense', title: 'מקדמה לחברת האוטובוסים לטיול השנתי', summary: 'שריון 3 אוטובוסים לטיול השנתי בניסן. מקדמה של 2,400 ₪.', section: 'payments', amount: 2400, roles: ['chair', 'treasurer'], by: 'bookkeeper', at: T('2026-11-26', '09:10') });

  // ------------------------------------------------------------------ 4. tasks (+ comments)
  const TK = {};
  const task = (key, t) => { TK[key] = ins('tasks', { title: t.title, body: t.body || null, section: t.section, source: t.source || 'manual', entity: t.hid ? 'households' : (t.entity || null), entity_id: t.hid || t.entity_id || null,
    assignee_role: t.role, assignee_user_id: U[t.role], due_date: t.due, priority: t.pri || 'normal', status: t.status || 'open', done_at: t.done ? T(t.done, '12:00') : null, created_at: T(t.at || '2026-11-20', '09:00') }); };
  task('goldberg_call', { title: 'להתקשר למשפחת גולדברג: שלושה חודשים פתוחים', body: 'לא עונים לוואטסאפ. לנסות את האם (050-0000206) אחרי 16:00.', section: 'collection', hid: 6, role: 'secretary', due: '2026-11-24', pri: 'high', at: '2026-11-19' });
  task('berger_card', { title: 'לקבל מברגר פרטי כרטיס אשראי חדש', body: 'הכרטיס פג תוקף ב-11/26 והחיוב של כסלו נכשל.', section: 'payments', hid: 8, role: 'bookkeeper', due: '2026-11-26', pri: 'high', status: 'in_progress', at: '2026-11-24' });
  task('weiss_retry', { title: 'לחייב שוב את הוראת הקבע של וייס', body: 'לפי השיחה עם האב: לחייב מחדש ב-1.12, אחרי משכורת.', section: 'returned', hid: 4, role: 'bookkeeper', due: '2026-12-01', at: '2026-11-24' });
  task('rosenthal_bus', { title: 'לבדוק מול חברת ההסעות את רשימת הנוסעים (רוזנטל)', section: 'requests', entity: 'requests', role: 'secretary', due: '2026-11-27', status: 'in_progress', at: '2026-11-21' });
  task('levi_bank', { title: 'לברר עם משפחת לוי את ביטול ההרשאה בבנק', body: 'הוראת הקבע של כסלו חזרה ב-25.11 «ההרשאה בוטלה». צריך הרשאה חדשה או תשלום באשראי.', section: 'returned', hid: 1, role: 'secretary', due: '2026-11-26', pri: 'urgent', at: '2026-11-25' });
  task('shapira_2', { title: 'לעקוב אחרי תשלום 2 מתוך 4 בהסדר של שפירא', section: 'collection', hid: 5, role: 'bookkeeper', due: '2026-12-10', at: '2026-11-11' });
  task('chair_shapira', { title: 'להחליט על בקשת ההנחה של משפחת שפירא', section: 'approvals', hid: 5, role: 'chair', due: '2026-11-30', at: '2026-11-23' });
  task('bank_recon', { title: 'התאמת תקבולים מול דף הבנק: נובמבר', section: 'payments', role: 'bookkeeper', due: '2026-11-30', at: '2026-11-22' });
  task('monthly_report', { title: 'דוח גבייה חודשי לגזבר: חשוון', body: 'כמה נגבה, מה חזר, מי בהסדר, מי לא מגיב.', section: 'collection', role: 'treasurer', due: '2026-11-28', at: '2026-11-20' });
  task('tax_2026', { title: 'להפיק אישורי תשלום שנתיים למס הכנסה לשנת 2026', section: 'households', role: 'secretary', due: '2027-01-10', pri: 'low', at: '2026-11-15' });
  task('trip_collect', { title: 'לגבות את תשלום הטיול השנתי מכל המשפחות', section: 'billing', role: 'bookkeeper', due: '2027-03-01', pri: 'low', at: '2026-11-26' });
  task('goldberg_letter', { title: 'להכין מכתב התראה למשפחת גולדברג', section: 'collection', hid: 6, role: 'secretary', due: '2026-11-17', status: 'done', done: '2026-11-17', at: '2026-11-13' });
  task('shapira_sched', { title: 'לשלוח למשפחת שפירא את לוח התשלומים של ההסדר', section: 'collection', hid: 5, role: 'bookkeeper', due: '2026-10-15', status: 'done', done: '2026-10-15', at: '2026-10-14' });
  task('klein_join', { title: 'קליטת משפחת קליין: טופס הרשאה לחיוב וחתימה', section: 'households', hid: 9, role: 'secretary', due: '2026-09-02', status: 'done', done: '2026-09-02', at: '2026-08-25' });
  task('weiss_receipt', { title: 'לשלוח קבלה למשפחת וייס על התשלום במזומן', section: 'payments', hid: 4, role: 'secretary', due: '2026-11-03', status: 'done', done: '2026-11-03', at: '2026-11-02' });
  task('books', { title: 'לחייב דמי ספרים לכיתות א׳ עד ח׳', section: 'billing', role: 'bookkeeper', due: '2026-09-15', status: 'done', done: '2026-09-14', at: '2026-09-01' });
  const comment = (tk, role, body, at) => ins('task_comments', { task_id: TK[tk], kind: 'comment', body, user_id: U[role], user_name: N[role].split(',')[0], act_role: role, created_at: at });
  comment('goldberg_call', 'secretary', 'התקשרתי פעמיים לאב, אין מענה. השארתי הודעה.', T('2026-11-20', '16:30'));
  comment('goldberg_call', 'secretary', 'האם ענתה ואמרה שהאב יחזור אלינו. עד עכשיו לא חזר.', T('2026-11-23', '17:10'));
  comment('berger_card', 'bookkeeper', 'האב אמר שישלח את פרטי הכרטיס החדש עד סוף השבוע.', T('2026-11-25', '11:00'));
  comment('rosenthal_bus', 'secretary', 'חברת ההסעות אישרה שצבי לא ברשימה מאלול. מעבירה לגזבר לאישור ההחזר.', T('2026-11-22', '09:30'));
  db.prepare("UPDATE tasks SET entity_id=NULL, entity=NULL WHERE id=?").run(TK.rosenthal_bus);

  // ------------------------------------------------------------------ 5. requests (+ updates)
  const RQ = {}; let num = 1001;
  const upd = (rid, u) => ins('request_updates', { request_id: rid, kind: u.kind || 'note', direction: u.dir || null, body: u.body, visible_to_resident: u.visible ? 1 : 0, by_user_id: u.role ? U[u.role] : null,
    by_name: u.role ? N[u.role] : (u.name || 'המערכת'), at: u.at, files_json: '[]', status_from: u.from || null, status_to: u.to || null, created_at: u.at });
  const CH = { whatsapp: 'וואטסאפ', voice: 'קו קולי', phone: 'טלפון', walk_in: 'במשרד', email: 'מייל', portal: 'אתר ההורים' };
  const ST = { new: 'חדשה', in_progress: 'בטיפול', waiting: 'ממתינה', closed: 'נסגרה' };
  const request = (key, q) => {
    const cat = CATS.find((c) => c[0] === q.cat); const opened = q.at; const exp = new Date(Date.parse(opened) + cat[2] * 864e5).toISOString().slice(0, 10);
    const h = q.hid ? HH[q.hid] : null;
    const id = ins('requests', { number: num++, household_id: q.hid || null, contact_name: q.contact || (h ? `${h.head_name} ${h.family_name}` : null), contact_phone: q.phone || h?.phone || null, channel: q.ch, category_id: CAT[q.cat],
      title: q.title, body: q.body, assignee_role: q.role || cat[1], assignee_user_id: U[q.role || cat[1]], status: q.status, priority: q.pri || 'normal', opened_at: opened, expected_date: exp,
      first_response_at: new Date(Date.parse(opened) + 25 * 60e3).toISOString(), closed_at: q.closed || null, close_summary: q.summary || null, satisfaction: q.sat || null, source: q.ch === 'voice' ? 'voice' : 'manual', auto_classified: 1, created_at: opened, updated_at: q.closed || opened });
    RQ[key] = id;
    upd(id, { kind: 'status', to: 'new', body: `הפנייה נפתחה · ${CH[q.ch]} · ${q.cat} · צפי ${exp.split('-').reverse().join('.')}`, at: opened });
    upd(id, { kind: 'message', dir: 'out', visible: true, name: 'מענה אוטומטי', body: `שלום, פנייתך התקבלה ונרשמה כפנייה מספר ${num - 1} (${q.cat}). הטיפול צפוי עד ${exp.split('-').reverse().join('.')}.`, at: new Date(Date.parse(opened) + 25 * 60e3).toISOString() });
    for (const u of q.thread || []) upd(id, u);
    if (q.status !== 'new') upd(id, { kind: 'status', from: 'new', to: q.status === 'closed' ? 'in_progress' : q.status, body: `${ST.new} ← ${ST[q.status === 'closed' ? 'in_progress' : q.status]}`, role: q.role || cat[1], at: new Date(Date.parse(opened) + 3 * 3600e3).toISOString() });
    if (q.status === 'closed') upd(id, { kind: 'status', from: 'in_progress', to: 'closed', body: `${ST.in_progress} ← ${ST.closed} · ${q.summary}`, role: q.role || cat[1], at: q.closed });
  };
  request('levi_so', { hid: 1, ch: 'whatsapp', cat: 'אמצעי תשלום והוראת קבע', title: 'הוראת הקבע של כסלו חזרה', body: 'קיבלנו הודעה שהתשלום לא עבר. החלפנו בנק החודש, איך מעדכנים?', status: 'in_progress', pri: 'high', at: T('2026-11-25', '19:40'),
    thread: [{ kind: 'message', dir: 'in', visible: true, name: 'רחל לוי', body: 'החלפנו בנק החודש. אפשר לשלוח טופס הרשאה חדש?', at: T('2026-11-25', '20:05') }, { kind: 'note', role: 'secretary', body: 'זו החזרה שנייה השנה. לשלוח טופס הרשאה ולבקש תשלום כסלו באשראי בינתיים.', at: T('2026-11-26', '08:50') }] });
  request('rosenthal_bus', { hid: 7, ch: 'phone', cat: 'שאלות על חיוב שכר לימוד', title: 'בירור על חיוב ההסעות', body: 'האב טוען שחויבו 180 ₪ על הסעות בחשוון, וצבי הולך ברגל ולא נרשם להסעה.', status: 'waiting', at: T('2026-11-21', '10:15'),
    thread: [{ kind: 'note', role: 'secretary', body: 'חברת ההסעות אישרה שצבי לא ברשימה. הועבר לגזבר לאישור החזר.', at: T('2026-11-22', '09:30') }, { kind: 'message', dir: 'out', visible: true, role: 'bookkeeper', body: 'שלום ר׳ אליעזר, בדקנו וצדקת. ההחזר על 180 ₪ ממתין לאישור הגזבר, ונעדכן כשיבוצע.', at: T('2026-11-22', '10:00') }] });
  request('shapira_discount', { hid: 5, ch: 'walk_in', cat: 'הנחות ומלגות', title: 'בקשת הנחה בשכר הלימוד לארבעה תלמידים', body: 'האם הגיעה למזכירות עם מכתב מהרב של בית הכנסת ואישור הכנסות.', status: 'in_progress', at: T('2026-11-23', '10:40'), role: 'chair',
    thread: [{ kind: 'note', role: 'secretary', body: 'צורפו אישור הכנסות ומכתב רב. הועבר להחלטת מנהל המוסד והגזבר.', at: T('2026-11-23', '11:20') }] });
  request('berger_card', { hid: 8, ch: 'whatsapp', cat: 'אמצעי תשלום והוראת קבע', title: 'עדכון כרטיס אשראי שפג תוקפו', body: 'קיבלתי הודעה שהחיוב נכשל. הכרטיס הוחלף, אשלח את הפרטים.', status: 'new', at: T('2026-11-26', '08:20') });
  request('weiss_retry', { hid: 4, ch: 'voice', cat: 'אמצעי תשלום והוראת קבע', title: 'הוראת הקבע חזרה: בקשה לחייב שוב בתחילת החודש', body: 'הודעה קולית: «המשכורת נכנסת ב-1 לחודש, אפשר לחייב שוב אחרי זה?»', status: 'in_progress', at: T('2026-11-24', '18:05') });
  request('prospect', { ch: 'voice', cat: 'רישום ושיבוץ לכיתות', contact: 'ר׳ משה גרינפלד', phone: '052-0000311', title: 'רישום לגן לשנה הבאה', body: 'הודעה קולית: מבקש לדעת מתי נפתח הרישום לגן לשנת תשפ״ח ומה שכר הלימוד.', status: 'waiting', at: T('2026-11-22', '21:10') });
  request('shapira_plan', { hid: 5, ch: 'phone', cat: 'הסדר תשלומים', title: 'בקשה לפרוס את החוב לתשלומים', body: 'חוב של 3,800 ₪ מתשרי וחשוון. מבקשים לפרוס לארבעה חודשים.', status: 'closed', at: T('2026-10-12', '11:00'), closed: T('2026-10-14', '12:00'), summary: 'אושר הסדר ל-4 תשלומים של 950 ₪ מ-10.11.', sat: 5 });
  request('cohen_tax', { hid: 2, ch: 'email', cat: 'אישורים וקבלות', title: 'אישור תשלומים שנתי למס הכנסה 2025', body: 'נבקש אישור על שכר הלימוד ששולם ב-2025 לצורך החזר מס.', status: 'closed', at: T('2026-01-11', '09:00'), closed: T('2026-01-12', '10:30'), summary: 'האישור נשלח במייל.', sat: 5 });
  request('adler_tax', { hid: 10, ch: 'whatsapp', cat: 'אישורים וקבלות', title: 'אישור תשלום שכר לימוד למס הכנסה', body: 'צריך אישור לשנת 2025 לרואה החשבון.', status: 'closed', at: T('2026-01-19', '20:15'), closed: T('2026-01-20', '11:00'), summary: 'האישור נשלח בוואטסאפ.', sat: 5 });
  request('klein_join', { hid: 9, ch: 'walk_in', cat: 'רישום ושיבוץ לכיתות', title: 'רישום שני תלמידים והצטרפות להסעה', body: 'משפחה חדשה. חיים לכיתה ו׳ וזאב לכיתה ג׳.', status: 'closed', at: T('2026-08-25', '10:00'), closed: T('2026-08-27', '13:00'), summary: 'שובצו: חיים בכיתה ו׳ אצל הרב אהרן ליבוביץ, זאב בכיתה ג׳ אצל הרב שלמה גרוס.', sat: 5 });
  request('friedman_debt', { hid: 3, ch: 'phone', cat: 'שאלות על חיוב שכר לימוד', title: 'בירור על יתרה קטנה מתשרי', body: 'האם שאלה למה נשארה יתרה של 120 ₪.', status: 'closed', at: T('2026-10-20', '12:00'), closed: T('2026-10-22', '09:00'), summary: 'היתרה היא דמי הספרים של ישראל. שולמה באשראי.', sat: 4 });
  request('levi_meals', { hid: 1, ch: 'walk_in', cat: 'ארוחות', title: 'ביטול ארוחות צהריים ליוסף (גן)', body: 'יוסף מקבל אוכל מהבית לפי הוראת רופא.', status: 'closed', at: T('2026-09-27', '11:30'), closed: T('2026-09-29', '09:00'), summary: 'אושר ביטול דמי הארוחות מתשרי.', sat: 5 });
  request('weiss_receipt', { hid: 4, ch: 'phone', cat: 'אישורים וקבלות', title: 'קבלה על תשלום במזומן', body: 'שילמו 1,200 ₪ במזומן במזכירות ומבקשים קבלה.', status: 'closed', at: T('2026-11-02', '12:10'), closed: T('2026-11-03', '10:00'), summary: 'הקבלה נשלחה במייל.' });
  request('cohen_trip', { hid: 2, ch: 'whatsapp', cat: 'כללי', title: 'מתי הטיול השנתי וכמה עולה', body: 'שאלה על מועד הטיול השנתי ועל התשלום.', status: 'closed', at: T('2026-11-04', '21:00'), closed: T('2026-11-05', '09:30'), summary: 'הטיול בניסן, 150 ₪ לתלמיד. פרטים יישלחו לכל ההורים.' });
  db.prepare('UPDATE tasks SET entity=?, entity_id=? WHERE id=?').run('requests', RQ.rosenthal_bus, TK.rosenthal_bus);
  // the demo stays on these dates: open requests are not pushed to the «escalate» automation (its wording is not of this institution)
  db.prepare("UPDATE requests SET escalated_at=opened_at WHERE status IN ('new','in_progress','waiting')").run();

  // ------------------------------------------------------------------ 6. message templates, campaigns, outbox, contact log
  const TPL = {};
  [['tuition_reminder', 'תזכורת תשלום שכר לימוד', 'finance', 1, 'תזכורת: שכר לימוד', 'שלום {ראש_משפחה},\nלפי רישומי הנהלת החשבונות של תלמוד תורה «אור התורה», היתרה לתשלום היא {יתרה} (נכון ל-{תאריך}).\nאם כבר שילמתם, תודה רבה ואפשר להתעלם מההודעה.\nלתשלום או לתיאום: המזכירות, 03-5790000.'],
    ['so_returned', 'הוראת קבע חזרה', 'finance', 1, 'התשלום לא עבר', 'שלום {ראש_משפחה},\nהחיוב החודשי של שכר הלימוד לא עבר בבנק. נשמח שתסדירו את התשלום בימים הקרובים: באשראי בטלפון למזכירות, או בהרשאה חדשה לחיוב.\nתודה, הנהלת החשבונות.'],
    ['receipt', 'קבלה על תשלום', 'finance', 1, 'קבלה על תשלום שכר לימוד', 'שלום {ראש_משפחה},\nתודה על התשלום. הקבלה מצורפת.\nיתרה לתשלום: {יתרה}.\nתלמוד תורה «אור התורה»'],
    ['welcome', 'ברכת הצטרפות למשפחה חדשה', 'personal', 1, 'ברוכים הבאים', 'משפחת {משפחה} היקרה, ברוכים הבאים לתלמוד תורה «אור התורה»!\nמצורפים לוח הזמנים, פרטי ההסעות ולוח החיובים לשנת הלימודים.\nבכל שאלה: המזכירות, 03-5790000.'],
    ['before_charge', 'תזכורת לפני מועד החיוב', 'finance', 0, 'שכר הלימוד יחויב ב-10 לחודש', 'הורים יקרים,\nב-10 לחודש יחויב שכר הלימוד החודשי בהוראת הקבע. נא לוודא שיש כיסוי בחשבון.\nתודה על שיתוף הפעולה, הנהלת המוסד.'],
    ['card_expired', 'כרטיס אשראי פג תוקף', 'finance', 1, 'נדרש כרטיס אשראי חדש', 'שלום {ראש_משפחה},\nכרטיס האשראי שרשום אצלנו לתשלום שכר הלימוד פג תוקף, והחיוב האחרון לא עבר. נא לעדכן פרטי כרטיס במזכירות.'],
    ['plan_update', 'עדכון על הסדר תשלומים', 'finance', 1, 'הסדר התשלומים שלכם', 'שלום {ראש_משפחה},\nתזכורת: התשלום הבא בהסדר ייגבה ב-10 לחודש. יתרת ההסדר: {יתרה}.'],
    ['trip', 'טיול שנתי: הרשמה ותשלום', 'events', 0, 'הטיול השנתי', 'הורים יקרים,\nהטיול השנתי של התלמוד תורה יתקיים בניסן. דמי הטיול: 150 ₪ לתלמיד, ויתווספו לחיוב של אדר.\nהנהלת המוסד.'],
  ].forEach(([k, name, category, personal, subject, body], i) => { TPL[k] = ins('message_templates', { id: i + 1, name, category, subject, body, voice_body: null, personal, created_at: T('2026-08-01') }); });

  const outIds = []; let oid = BASE; let did = BASE;
  const outbox = (o) => { const id = ins('outbox', { id: oid++, channel: o.ch || 'whatsapp', to_addr: o.to, subject: o.subject || null, body: o.body, attachments_json: '[]', entity: o.hid ? 'households' : null, entity_id: o.hid || null,
      campaign_id: o.camp || null, status: 'sent', error: null, created_at: o.at, sent_at: new Date(Date.parse(o.at) + 40e3).toISOString(), created_by: o.by ? U[o.by] : null, category: 'resident', household_id: o.hid || null, automation: o.auto || null });
    ins('outbox_delivery', { outbox_id: id, integration: o.ch || 'whatsapp', attempts: 1, dry_run: 1, provider_ref: `demo-${id}`, external_status: o.read === false ? 'delivered' : 'read', external_at: new Date(Date.parse(o.at) + 600e3).toISOString(), created_at: o.at });
    outIds.push(id); return id; };
  let cid = BASE;
  const contact = (c) => ins('contact_log', { id: cid++, household_id: c.hid, at: c.at, channel: c.ch, direction: c.dir || 'out', by_user_id: c.role ? U[c.role] : null, by_name: c.role ? N[c.role] : 'המערכת', summary: c.summary,
    follow_up_date: c.fu || null, follow_up_done_at: c.fuDone || null, outbox_id: c.out || null, source: c.src || 'manual', created_at: c.at });
  const fill = (tpl, h, extra = {}) => tpl.replace('{ראש_משפחה}', `${h.head_name} ${h.family_name}`).replace('{משפחה}', h.family_name).replace('{יתרה}', extra.bal || '0 ₪').replace('{תאריך}', extra.date || '26.11.2026');
  const tplBody = (k) => db.prepare('SELECT body FROM message_templates WHERE id=?').get(TPL[k]).body;

  // campaigns to all ten families
  const campaign = (c) => {
    const id = ins('campaigns', { title: c.title, subject: c.subject, body: c.body, voice_body: null, template_id: c.tpl ? TPL[c.tpl] : null,
      audience_json: J({ mode: 'filter', statuses: ['resident'], streets: [], neighborhoods: [], tags: [], channels: [], kosher: 'any', households: [], exclude: [] }),
      channels_json: J({ allowed: ['whatsapp', 'email'], essential: false, print_notice: false, notice_until: null }), category: 'resident', status: c.status, approval_id: c.ap ? AP[c.ap] : null,
      approved_at: c.sent ? c.at : null, dispatched_at: c.sent || null, sent_at: c.sent ? new Date(Date.parse(c.sent) + 120e3).toISOString() : null, stats_json: '{}', created_by: U.secretary, created_by_name: N.secretary, created_at: c.at, updated_at: c.sent || c.at });
    if (c.sent) {
      for (const h of Object.values(HH)) {
        if (c.only && !c.only.includes(h.id)) continue;
        const o = outbox({ to: h.phone, subject: c.subject, body: c.body, camp: id, hid: h.id, at: c.sent, by: 'secretary', auto: 'announce', read: h.id !== 6 });
        ins('campaign_recipients', { campaign_id: id, household_id: h.id, channel: 'whatsapp', to_addr: h.phone, outbox_id: o, status: 'sent', created_at: c.sent });
      }
      const total = c.only ? c.only.length : 10;
      db.prepare('UPDATE campaigns SET stats_json=? WHERE id=?').run(J({ total, sent: total, queued: 0, failed: 0, skipped: 0, print: 0, by_channel: { whatsapp: { total, sent: total, queued: 0, failed: 0, skipped: 0, print: 0 } }, rate: 100 }), id);
    }
    return id;
  };
  campaign({ title: 'פתיחת שנת הלימודים תשפ״ז', subject: 'ברוכים הבאים לשנת תשפ״ז', body: 'הורים יקרים,\nשנת הלימודים תשפ״ז נפתחת ביום ראשון, ב׳ באלול. מצורף לוח החיובים: שכר הלימוד החודשי ייגבה ב-10 בכל חודש בהוראת קבע.\nבהצלחה לכל התלמידים! הנהלת המוסד.', status: 'sent', at: T('2026-08-12', '10:00'), sent: T('2026-08-12', '12:00') });
  campaign({ title: 'תזכורת לפני חיוב חשוון', subject: 'שכר הלימוד יחויב ב-10 לחודש', tpl: 'before_charge', body: tplBody('before_charge'), status: 'sent', at: T('2026-10-07', '09:00'), sent: T('2026-10-08', '10:00') });
  const kislev = campaign({ title: 'תזכורת לפני חיוב כסלו', subject: 'שכר הלימוד יחויב ב-10 לחודש', tpl: 'before_charge', ap: 'kislev_reminder', body: tplBody('before_charge'), status: 'sent', at: T('2026-11-05', '10:00'), sent: T('2026-11-08', '10:00') });
  db.prepare("UPDATE approvals SET entity='campaigns', entity_id=? WHERE id=?").run(kislev, AP.kislev_reminder);
  campaign({ title: 'הטיול השנתי: הרשמה ותשלום', subject: 'הטיול השנתי', tpl: 'trip', body: tplBody('trip'), status: 'draft', at: T('2026-11-26', '09:30') });
  campaign({ title: 'תזכורת לפני חיוב טבת', subject: 'שכר הלימוד יחויב ב-10 לחודש', tpl: 'before_charge', body: tplBody('before_charge'), status: 'draft', at: T('2026-11-26', '09:40') });
  ins('notices', { title: 'לוח החיובים לשנת תשפ״ז', body: 'שכר הלימוד נגבה ב-10 בכל חודש. דמי רישום, ספרים וטיול שנתי נוספים לחיוב לפי הלוח שנשלח להורים. לשאלות: המזכירות, א׳–ה׳ 8:30–13:30.', from_date: '2026-08-12', until_date: '2027-07-31', place: 'לוח המודעות בכניסה לתלמוד תורה', pinned: 1, created_at: T('2026-08-12') });
  ins('notices', { title: 'חופשת חנוכה', body: 'אין לימודים מכ״ה בכסלו עד ב׳ בטבת. ההסעות לא פועלות בימים אלה.', from_date: '2026-11-26', until_date: '2026-12-13', place: 'לוח המודעות בכניסה לתלמוד תורה', pinned: 0, created_at: T('2026-11-26') });

  // personal messages + contact log
  const pm = (hid, tpl, at, extra = {}) => { const h = HH[hid]; const body = fill(tplBody(tpl), h, extra); const sub = db.prepare('SELECT subject FROM message_templates WHERE id=?').get(TPL[tpl]).subject;
    const o = outbox({ to: extra.email ? h.email : h.phone, ch: extra.email ? 'email' : 'whatsapp', subject: sub, body, hid, at, by: extra.by || null, auto: extra.auto || null, read: hid !== 6 });
    contact({ hid, at, ch: extra.email ? 'email' : 'whatsapp', role: extra.by, summary: `${sub}${extra.note ? ` · ${extra.note}` : ''}`, out: o, src: extra.auto || 'message' }); return o; };
  // גולדברג: 4 תזכורות בלי מענה + שיחות
  pm(6, 'tuition_reminder', T('2026-10-15', '10:00'), { bal: '1,100 ₪', date: '15.10.2026', auto: 'dun', note: 'אלול פתוח' });
  pm(6, 'tuition_reminder', T('2026-10-29', '10:00'), { bal: '2,200 ₪', date: '29.10.2026', auto: 'dun', note: 'אלול ותשרי פתוחים' });
  pm(6, 'tuition_reminder', T('2026-11-12', '10:00'), { bal: '3,300 ₪', date: '12.11.2026', auto: 'dun', note: 'שלושה חודשים פתוחים' });
  pm(6, 'tuition_reminder', T('2026-11-19', '10:00'), { bal: '3,300 ₪', date: '19.11.2026', by: 'secretary', note: 'תזכורת רביעית, בלי מענה' });
  contact({ hid: 6, at: T('2026-11-20', '16:30'), ch: 'call', role: 'secretary', summary: 'שיחה לאב, אין מענה. הושארה הודעה בתא הקולי.', fu: '2026-11-23', fuDone: T('2026-11-23', '17:10') });
  contact({ hid: 6, at: T('2026-11-23', '17:10'), ch: 'call', role: 'secretary', summary: 'שיחה עם האם: אמרה שהאב יחזור אלינו השבוע. עד היום לא חזר.', fu: '2026-11-27' });
  // לוי: החזרה 25.11, החזרה קודמת באלול
  pm(1, 'so_returned', T('2026-09-12', '09:00'), { auto: 'tak_returned', note: 'הוראת קבע של אלול חזרה' });
  contact({ hid: 1, at: T('2026-09-14', '11:00'), ch: 'call', role: 'bookkeeper', summary: 'האב הסדיר את אלול באשראי בטלפון.' });
  pm(1, 'so_returned', T('2026-11-25', '15:10'), { auto: 'tak_returned', note: 'כסלו חזר «ההרשאה בוטלה»' });
  contact({ hid: 1, at: T('2026-11-25', '20:05'), ch: 'whatsapp', dir: 'in', summary: 'האם השיבה שהחליפו בנק ומבקשת טופס הרשאה חדש.' });
  contact({ hid: 1, at: T('2026-10-20', '12:00'), ch: 'call', role: 'secretary', summary: 'תזכורת טלפונית על איחור בתשלום תשרי. שולם למחרת.' });
  // וייס: אין כיסוי
  pm(4, 'so_returned', T('2026-11-13', '09:30'), { auto: 'tak_returned', note: 'חשוון חזר «אין כיסוי»' });
  contact({ hid: 4, at: T('2026-11-24', '18:05'), ch: 'voice', dir: 'in', summary: 'האב השאיר הודעה בקו: מבקש לחייב שוב אחרי ה-1 לחודש.' });
  contact({ hid: 4, at: T('2026-11-25', '10:15'), ch: 'call', role: 'bookkeeper', summary: 'סוכם לחייב שוב ב-1.12 ולפרוס את חשוון לשלושה תשלומים (ממתין לאישור הגזבר).', fu: '2026-12-01' });
  pm(4, 'receipt', T('2026-11-03', '10:00'), { email: true, by: 'secretary', note: 'קבלה על 1,200 ₪ במזומן' });
  // ברגר: כרטיס פג תוקף
  pm(8, 'card_expired', T('2026-11-10', '12:00'), { auto: 'tak_returned', note: 'חיוב כסלו נכשל' });
  contact({ hid: 8, at: T('2026-11-24', '12:30'), ch: 'call', role: 'bookkeeper', summary: 'האב אישר שהכרטיס הוחלף ויעביר פרטים חדשים.', fu: '2026-11-26' });
  // שפירא: הסדר
  contact({ hid: 5, at: T('2026-10-12', '11:00'), ch: 'call', dir: 'in', role: 'bookkeeper', summary: 'האם ביקשה לפרוס את החוב. הוסבר על הסדר תשלומים.' });
  pm(5, 'plan_update', T('2026-10-15', '09:00'), { bal: '3,800 ₪', by: 'bookkeeper', note: 'נשלח לוח התשלומים של ההסדר' });
  pm(5, 'plan_update', T('2026-11-08', '09:00'), { bal: '2,850 ₪', auto: 'dun', note: 'תזכורת לתשלום 1 מתוך 4' });
  contact({ hid: 5, at: T('2026-11-23', '10:40'), ch: 'meeting', role: 'secretary', summary: 'פגישה עם האם במזכירות: הוגשה בקשה להנחה עם אישור הכנסות.' });
  // רוזנטל
  contact({ hid: 7, at: T('2026-11-21', '10:15'), ch: 'call', dir: 'in', role: 'secretary', summary: 'האב טוען שחויב על הסעות בטעות. נפתחה פנייה.' });
  contact({ hid: 7, at: T('2026-11-22', '10:00'), ch: 'whatsapp', role: 'bookkeeper', summary: 'עודכן שהחיוב נמצא שגוי וההחזר ממתין לאישור הגזבר.' });
  // קליין
  pm(9, 'welcome', T('2026-08-25', '13:00'), { by: 'secretary' });
  contact({ hid: 9, at: T('2026-08-25', '10:00'), ch: 'meeting', role: 'secretary', summary: 'פגישת הרשמה: שני תלמידים, טופס הרשאה לחיוב נחתם.' });
  // receipts to those who pay on time
  for (const [hid, amt] of [[2, '980 ₪'], [10, '1,450 ₪'], [3, '650 ₪'], [9, '1,100 ₪']]) pm(hid, 'receipt', T('2026-11-10', '14:00'), { email: true, auto: 'receipt', note: `קבלה על ${amt} · כסלו` });
  contact({ hid: 2, at: T('2026-10-20', '09:00'), ch: 'call', role: 'bookkeeper', summary: 'עודכן על החזר החיוב הכפול בתשרי (980 ₪) בהעברה בנקאית.' });

  // ------------------------------------------------------------------ 7. phone line: IVR, calls, broadcasts
  const ivr = (key, parent, digit, kind, title, text, settings = {}, sort = 0) => ins('ivr_nodes', { key, parent_key: parent, digit, kind, title, text, settings_json: J(settings), sort, active: 1, created_at: T('2026-08-01') });
  ivr('root', null, null, 'menu', 'תפריט ראשי', 'שלום, הגעתם לקו הטלפוני של תלמוד תורה «אור התורה», בני ברק.', { closed_on_shabbat: true, greet_family: true });
  ivr('balance', 'root', '1', 'balance', 'מצב חשבון שכר לימוד', null, {}, 10);
  ivr('request', 'root', '2', 'request', 'פנייה למזכירות', 'פנייה למזכירות התלמוד תורה. בחרו את נושא הפנייה.', { record: true, max_seconds: 90, categories: [
    { digit: '1', name: 'שאלות על חיוב שכר לימוד' }, { digit: '2', name: 'אמצעי תשלום והוראת קבע' }, { digit: '3', name: 'אישורים וקבלות' }, { digit: '4', name: 'הסעות' },
    { digit: '5', name: 'ארוחות' }, { digit: '6', name: 'רישום ושיבוץ לכיתות' }, { digit: '9', name: 'כללי' }] }, 20);
  ivr('announcements', 'root', '3', 'announcements', 'הודעות התלמוד תורה', null, { count: 3 }, 30);
  ivr('info', 'root', '4', 'menu', 'מידע להורים', 'מידע להורים.', {}, 40);
  ivr('info-hours', 'info', '1', 'say', 'שעות המזכירות', 'המזכירות פתוחה בימים ראשון עד חמישי משמונה וחצי בבוקר עד אחת וחצי בצהריים, ובימים שני ורביעי גם מארבע עד שש אחר הצהריים.', {}, 10);
  ivr('info-pay', 'info', '2', 'say', 'מועד החיוב ואמצעי תשלום', 'שכר הלימוד נגבה בעשרה בכל חודש בהוראת קבע או בכרטיס אשראי. לעדכון אמצעי התשלום או להסדר תשלומים, בחרו בתפריט הראשי פנייה למזכירות, או התקשרו בשעות הפעילות.', {}, 20);
  ivr('info-schedule', 'info', '3', 'say', 'שעות הלימודים וההסעות', 'הלימודים מתחילים בשמונה בבוקר. ההסעות יוצאות מהתחנות בשבע וחצי. ביום שישי הלימודים מסתיימים בשתים עשרה.', {}, 30);
  ivr('office', 'root', '0', 'transfer', 'המזכירות', null, { folder: '/9', phone: '03-5790000', voicemail: true, voicemail_category: 'כללי', hours: [{ days: [0, 1, 2, 3, 4], from: '08:30', to: '13:30' }, { days: [1, 3], from: '16:00', to: '18:00' }] }, 90);
  let vc = 1;
  const call = (c) => { const st = c.at; const dur = c.dur; ins('voice_calls', { provider_call_id: `demo-${vc++}`, phone: c.phone || HH[c.hid].phone.replace(/-/g, ''), household_id: c.hid || null, started_at: st, ended_at: new Date(Date.parse(st) + dur * 1000).toISOString(), duration: dur,
    path: c.path, digits: c.digits, result: c.result, top_option: c.path.split('>')[1] || null, request_id: c.req ? RQ[c.req] : null, recording_ref: c.result === 'request' || c.result === 'voicemail' ? `rec-${vc}.wav` : null, state_json: '{}', sim: 0, created_at: st }); };
  call({ hid: 1, at: T('2026-11-25', '19:20'), dur: 74, path: 'root>balance', digits: '1', result: 'info' });
  call({ hid: 1, at: T('2026-11-26', '08:05'), dur: 41, path: 'root>office', digits: '0', result: 'transfer' });
  call({ hid: 4, at: T('2026-11-24', '18:05'), dur: 96, path: 'root>request', digits: '22', result: 'request', req: 'weiss_retry' });
  call({ phone: '0520000311', at: T('2026-11-22', '21:10'), dur: 88, path: 'root>request', digits: '26', result: 'request', req: 'prospect' });
  call({ hid: 5, at: T('2026-11-20', '20:30'), dur: 52, path: 'root>balance', digits: '1', result: 'info' });
  call({ hid: 5, at: T('2026-11-09', '19:45'), dur: 63, path: 'root>info>info-pay', digits: '42', result: 'info' });
  call({ hid: 7, at: T('2026-11-21', '09:58'), dur: 35, path: 'root>office', digits: '0', result: 'transfer' });
  call({ hid: 8, at: T('2026-11-24', '12:20'), dur: 47, path: 'root>balance', digits: '1', result: 'info' });
  call({ hid: 9, at: T('2026-09-03', '18:10'), dur: 58, path: 'root>info>info-schedule', digits: '43', result: 'info' });
  call({ hid: 2, at: T('2026-11-04', '20:40'), dur: 39, path: 'root>announcements', digits: '3', result: 'info' });
  call({ hid: 10, at: T('2026-11-11', '08:15'), dur: 22, path: 'root>balance', digits: '1', result: 'info' });
  call({ hid: 3, at: T('2026-10-20', '11:50'), dur: 18, path: 'root', digits: '', result: 'hangup' });
  call({ phone: '0548000412', at: T('2026-11-18', '22:30'), dur: 31, path: 'root>info>info-hours', digits: '41', result: 'unidentified' });
  call({ hid: 6, at: T('2026-11-25', '23:10'), dur: 15, path: 'root>balance', digits: '1', result: 'info' });
  call({ hid: 4, at: T('2026-11-13', '21:00'), dur: 66, path: 'root>office', digits: '0', result: 'voicemail' });
  call({ hid: 1, at: T('2026-10-19', '19:05'), dur: 44, path: 'root>balance', digits: '1', result: 'info' });
  ins('voice_broadcasts', { title: 'תזכורת לפני חיוב כסלו', text: 'הודעה מהנהלת תלמוד תורה אור התורה. בעשרה לחודש יחויב שכר הלימוד של כסלו בהוראת הקבע. נא לוודא שיש כיסוי בחשבון. תודה רבה.', audience_json: J({ kind: 'all', street_ids: [], household_ids: [] }), category: 'resident', status: 'sent', sent_at: T('2026-11-08', '17:00'), stats_json: J({ total: 10, queued: 0, sent: 10, failed: 0, skipped: 0, no_phone: 0 }), created_by: U.secretary, created_by_name: N.secretary, created_at: T('2026-11-08', '16:40') });
  ins('voice_broadcasts', { title: 'חופשת חנוכה', text: 'הודעה מהנהלת תלמוד תורה אור התורה. אין לימודים מכ״ה בכסלו עד ב׳ בטבת, וההסעות לא פועלות בימים אלה. חנוכה שמח.', audience_json: J({ kind: 'all', street_ids: [], household_ids: [] }), category: 'resident', status: 'draft', stats_json: '{}', created_by: U.secretary, created_by_name: N.secretary, created_at: T('2026-11-26', '09:50') });

  // ------------------------------------------------------------------ 8. family history, documents
  let eid = BASE;
  for (const h of Object.values(HH)) {
    const kids = db.prepare("SELECT first_name, notes FROM residents WHERE household_id=? AND role='child' ORDER BY id").all(h.id);
    const date = h.entry_date || '2020-09-01';
    ins('household_events', { id: eid++, household_id: h.id, kind: 'created', date, to_status: 'resident', reason: `הצטרפות לתלמוד תורה «אור התורה»`, data_json: J({ students: kids.map((k) => `${k.first_name} (${String(k.notes || '').split(' · ')[0]})`) }), created_by: U.secretary, created_at: T(date) });
  }
  ins('household_events', { id: eid++, household_id: 5, kind: 'status', date: '2026-10-14', from_status: 'resident', to_status: 'resident', reason: 'נפתח הסדר תשלומים ל-4 תשלומים', data_json: '{}', created_by: U.bookkeeper, created_at: T('2026-10-14', '12:00') });
  ins('household_events', { id: eid++, household_id: 8, kind: 'status', date: '2025-03-02', from_status: 'resident', to_status: 'resident', reason: 'מעבר מהוראת קבע לכרטיס אשראי', data_json: '{}', created_by: U.bookkeeper, created_at: T('2025-03-02', '11:00') });
  let dn = 1;
  const doc = (d) => { const [sn, st] = SIGN[d.role]; const yr = d.at.slice(0, 4);
    ins('documents', { number: `${yr}/${String(dn).padStart(4, '0')}`, template_key: 'letter', title: d.title, household_id: d.hid, resident_id: null, addressee: d.to || 'לכל המעוניין', purpose: d.purpose, data_json: J({ subject: d.title, free_text: d.body }), body_text: d.body,
      status: d.sent ? 'sent' : 'signed', requested_via: d.via || 'office', requested_at: d.at, signer_role: d.role, signed_by: U[d.role], signer_name: sn, signer_title: st, signed_at: d.at, verify_code: `OT${String(dn).padStart(2, '0')}K${d.hid}Q7`.slice(0, 8),
      fee: 0, sent_at: d.sent || null, sent_channel: d.sent ? (d.ch || 'email') : null, sent_to: d.sent ? (d.ch === 'whatsapp' ? HH[d.hid].phone : HH[d.hid].email) : null, created_by: U[d.role], created_at: d.at }); dn++; };
  doc({ hid: 2, role: 'bookkeeper', title: 'אישור תשלום שכר לימוד לשנת 2025', to: 'פקיד השומה', purpose: 'למס הכנסה', body: 'הננו לאשר כי משפחת כהן שילמה לתלמוד תורה «אור התורה» בשנת 2025 שכר לימוד בסך 11,760 ₪ עבור בניהם אהרן ודוד.', at: T('2026-01-12', '10:20'), sent: T('2026-01-12', '10:30'), via: 'email' });
  doc({ hid: 10, role: 'bookkeeper', title: 'אישור תשלום שכר לימוד לשנת 2025', to: 'פקיד השומה', purpose: 'למס הכנסה', body: 'הננו לאשר כי משפחת אדלר שילמה לתלמוד תורה «אור התורה» בשנת 2025 שכר לימוד בסך 17,400 ₪ עבור בניהם אלחנן, שלום וישעיהו.', at: T('2026-01-20', '10:50'), sent: T('2026-01-20', '11:00'), ch: 'whatsapp', via: 'whatsapp' });
  doc({ hid: 3, role: 'bookkeeper', title: 'אישור תשלום שכר לימוד לשנת 2025', to: 'פקיד השומה', purpose: 'למס הכנסה', body: 'הננו לאשר כי משפחת פרידמן שילמה לתלמוד תורה «אור התורה» בשנת 2025 שכר לימוד בסך 7,800 ₪ עבור בנם ישראל.', at: T('2026-02-03', '09:30'), sent: T('2026-02-03', '09:40') });
  doc({ hid: 4, role: 'secretary', title: 'קבלה על תשלום במזומן', purpose: 'קבלה', body: 'התקבל במזכירות תלמוד תורה «אור התורה» סך 1,200 ₪ במזומן ממשפחת וייס, על חשבון שכר הלימוד.', at: T('2026-11-03', '09:50'), sent: T('2026-11-03', '10:00'), via: 'phone' });
  doc({ hid: 5, role: 'bookkeeper', title: 'אישור הסדר תשלומים', purpose: 'למשפחה', body: 'הסדר תשלומים למשפחת שפירא: חוב של 3,800 ₪ ייפרע בארבעה תשלומים של 950 ₪ ב-10 לחודש, מנובמבר 2026 עד פברואר 2027, בנוסף לשכר הלימוד השוטף.', at: T('2026-10-15', '08:50'), sent: T('2026-10-15', '09:00') });
  doc({ hid: 9, role: 'secretary', title: 'אישור לימודים לשנת תשפ״ז', purpose: 'לביטוח לאומי', body: 'הננו לאשר כי התלמידים חיים קליין (כיתה ו׳) וזאב קליין (כיתה ג׳) לומדים בתלמוד תורה «אור התורה» בשנת הלימודים תשפ״ז.', at: T('2026-09-01', '11:00'), sent: T('2026-09-01', '11:10'), ch: 'whatsapp' });
  db.prepare("UPDATE documents SET requested_at=? WHERE household_id=2").run(T('2026-01-11', '09:00'));

  // ------------------------------------------------------------------ 9. automation history
  let aeid = BASE;
  const aev = (key, at, summary, extra = {}) => ins('automation_events', { id: aeid++, key, entity: extra.entity || (extra.hid ? 'households' : null), entity_id: extra.eid || extra.hid || null, household_id: extra.hid || null, ref: null, summary, status: extra.status || 'done', n: extra.n || 1,
    outbox_id: extra.out || null, approval_id: null, at, user_id: null, created_at: at });
  aev('announce', T('2026-08-12', '12:00'), 'דיוור «פתיחת שנת הלימודים» נשלח ל-10 משפחות', { status: 'sent', n: 10 });
  aev('announce', T('2026-10-08', '10:00'), 'דיוור «תזכורת לפני חיוב חשוון» נשלח ל-10 משפחות', { status: 'sent', n: 10 });
  aev('announce', T('2026-11-08', '10:00'), 'דיוור «תזכורת לפני חיוב כסלו» נשלח ל-10 משפחות', { status: 'sent', n: 10 });
  aev('receipt', T('2026-11-10', '14:00'), '4 קבלות נשלחו במייל על תשלומי כסלו', { status: 'sent', n: 4 });
  aev('dun', T('2026-10-15', '10:00'), 'משפחת גולדברג: תזכורת ראשונה על אלול', { hid: 6, status: 'sent' });
  aev('dun', T('2026-10-29', '10:00'), 'משפחת גולדברג: תזכורת שנייה, שני חודשים פתוחים', { hid: 6, status: 'sent' });
  aev('dun', T('2026-11-12', '10:00'), 'משפחת גולדברג: תזכורת שלישית, 3,300 ₪', { hid: 6, status: 'sent' });
  aev('dun', T('2026-11-08', '09:00'), 'משפחת שפירא: תזכורת לתשלום 1 בהסדר', { hid: 5, status: 'sent' });
  aev('tak_returned', T('2026-09-12', '09:00'), 'משפחת לוי: הוראת קבע של אלול חזרה, נשלחה הודעה', { hid: 1, status: 'sent' });
  aev('tak_returned', T('2026-11-13', '09:30'), 'משפחת וייס: הוראת קבע חזרה «אין כיסוי», נשלחה הודעה', { hid: 4, status: 'sent' });
  aev('tak_returned', T('2026-11-10', '12:00'), 'משפחת ברגר: חיוב האשראי נכשל (כרטיס פג תוקף), נשלחה הודעה', { hid: 8, status: 'sent' });
  aev('tak_returned', T('2026-11-25', '15:10'), 'משפחת לוי: הוראת קבע של כסלו חזרה «ההרשאה בוטלה», נשלחה הודעה', { hid: 1, status: 'sent' });
  aev('inbox', T('2026-11-26', '08:45'), 'פנייה 1004 קיבלה מענה ראשון', { entity: 'requests', eid: RQ.berger_card, status: 'done' });
  aev('voiceline', T('2026-11-24', '18:07'), 'הודעה קולית ממשפחת וייס נפתחה כפנייה', { hid: 4, status: 'done' });

  // run history of the tuition automations (slot NULL: never blocks the scheduler)
  let rid = BASE;
  for (const e of db.prepare(`SELECT * FROM automation_events WHERE id >= ${BASE} ORDER BY at`).all()) {
    const r = ins('automation_runs', { id: rid++, key: e.key, trigger: 'schedule', slot: null, started_at: e.at, finished_at: new Date(Date.parse(e.at) + 4000).toISOString(), status: 'ok', done: e.n, summary: e.summary, error: null, dry_run: 0, items_json: '[]', user_id: null, created_at: e.at });
    db.prepare('UPDATE automation_events SET run_id=? WHERE id=?').run(r, e.id);
  }

  // ------------------------------------------------------------------ 10. audit log (staff actions on these records)
  let aid = BASE;
  const audit = (role, at, entity, entity_id, action, after, before = null, reason = null) => ins('audit_log', { id: aid++, at, user_id: U[role], entity, entity_id, action, before_json: before ? J(before) : null, after_json: after ? J(after) : null, reason });
  for (const h of Object.values(HH)) audit('secretary', T(h.entry_date || '2020-09-01', '09:30'), 'households', h.id, 'create', { family_name: h.family_name, head_name: h.head_name, phone: h.phone });
  audit('bookkeeper', T('2025-03-02', '11:00'), 'households', 8, 'update', { family_name: 'ברגר', payment_method: 'credit' }, { family_name: 'ברגר', payment_method: 'standing_order' }, 'ביקשו לעבור לאשראי');
  audit('secretary', T('2026-11-25', '20:30'), 'households', 1, 'update', { family_name: 'לוי', phone2: HH[1].phone2 }, { family_name: 'לוי', phone2: null }, 'עדכון טלפון של האם');
  const apr = db.prepare('SELECT * FROM approvals').all();
  for (const a of apr) { audit(Object.keys(U).find((k) => U[k] === a.requested_by) || 'secretary', a.created_at, 'approvals', a.id, 'create', { title: a.title, amount: a.amount, status: 'pending' });
    if (a.status !== 'pending') audit(JSON.parse(a.decisions_json)[0].role, a.decided_at, 'approvals', a.id, 'decide', { title: a.title, status: a.status }); }
  for (const t of db.prepare('SELECT * FROM tasks').all()) { audit(t.assignee_role === 'chair' ? 'secretary' : t.assignee_role, t.created_at, 'tasks', t.id, 'create', { title: t.title });
    if (t.status === 'done') audit(t.assignee_role, t.done_at, 'tasks', t.id, 'status', { title: t.title, status: 'done' }, { title: t.title, status: 'open' }); }
  for (const q of db.prepare('SELECT * FROM requests').all()) { audit('secretary', q.opened_at, 'requests', q.id, 'create', { number: q.number, title: q.title });
    if (q.closed_at) audit(q.assignee_role, q.closed_at, 'requests', q.id, 'status', { number: q.number, title: q.title, status: 'closed' }, { number: q.number, status: 'in_progress' }); }
  for (const d of db.prepare('SELECT * FROM documents').all()) { audit(d.signer_role, d.signed_at, 'documents', d.id, 'sign', { title: d.title, number: d.number }); if (d.sent_at) audit(d.signer_role, d.sent_at, 'documents', d.id, 'send', { title: d.title, number: d.number }); }
  for (const c of db.prepare('SELECT * FROM campaigns').all()) audit('secretary', c.created_at, 'campaigns', c.id, 'create', { title: c.title });

  for (const t of ['approvals', 'tasks', 'task_comments', 'requests', 'request_updates', 'request_categories', 'outbox', 'outbox_delivery', 'campaigns', 'campaign_recipients', 'message_templates', 'notices', 'contact_log', 'voice_calls', 'voice_broadcasts', 'ivr_nodes', 'household_events', 'documents', 'automation_events', 'audit_log'])
    report.inserted[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) throw new Error('foreign_key_check: ' + J(fk.slice(0, 5)));
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(JSON.stringify(report, null, 1));
