// tt/04_service_fix.js — QA round fixes on top of 03_service.js (owner: data-service). Run AFTER 03 (idempotent, one transaction).
// Aligns the service data with the finance data (receipts, so_returns, tak_returned, arrangements) and with the month mapping
// 10.09 = תשרי · 10.10 = חשוון · 10.11 = כסלו. Kosher-phone families (voice only): פרידמן 3, גולדברג 6, רוזנטל 7, קליין 9.
'use strict';
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(path.join(__dirname, '../../../data/demo.db'));
db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');

const KOSHER = [3, 6, 7, 9];
const OFFICE_PHONE = '03-0000000';
const T = (d, hm = '10:00') => new Date(`${d}T${hm}:00+02:00`).toISOString();
const J = (v) => JSON.stringify(v);
const plus = (iso, sec) => new Date(Date.parse(iso) + sec * 1000).toISOString();
const run = (sql, ...a) => db.prepare(sql).run(...a).changes;
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const colsOf = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
function ins(table, row) {
  const names = colsOf(table); const r = {};
  for (const [k, v] of Object.entries(row)) if (names.has(k)) r[k] = v;
  if (names.has('updated_at') && !r.updated_at) r.updated_at = r.created_at;
  const k = Object.keys(r);
  return Number(db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((x) => (r[x] !== null && typeof r[x] === 'object' ? J(r[x]) : r[x] ?? null))).lastInsertRowid);
}
const HH = Object.fromEntries(all('SELECT * FROM households WHERE id BETWEEN 1 AND 10').map((h) => [h.id, h]));
const U = { chair: 2, treasurer: 3, secretary: 4, bookkeeper: 8 };
const N = { chair: 'הרב שמחה ויסברג, מנהל המוסד', treasurer: 'ר׳ אהרן קרויס, גזבר', secretary: 'רחל מנדלסון, מזכירות', bookkeeper: 'טובה ליברמן, הנהלת חשבונות' };
const tpl = (id) => one('SELECT * FROM message_templates WHERE id=?', id);
const TPL = { tuition_reminder: 1, so_returned: 2, receipt: 3, welcome: 4, before_charge: 5, card_expired: 6, plan_update: 7, trip: 8 };
const fill = (body, h, bal, date) => body.replace('{ראש_משפחה}', `${h.head_name} ${h.family_name}`).replace('{משפחה}', h.family_name).replace('{יתרה}', bal || '0 ₪').replace('{תאריך}', date || '26.11.2026');
const report = {};
const note = (k, n) => { report[k] = (report[k] || 0) + (typeof n === 'number' ? n : 1); };

db.exec('BEGIN');
try {
  // ------------------------------------------------------------ 0. idempotency: drop rows a previous run of this script added
  const FIX = 790001; // rows added by this script: ids >= 790001, outbox marked by provider_ref 'fix04-…', events by ref 'fix04', runs by items_json ["fix04"]
  const mine = `SELECT outbox_id FROM outbox_delivery WHERE provider_ref LIKE 'fix04-%'`;
  run(`DELETE FROM contact_log WHERE id >= ${FIX} AND outbox_id IN (${mine})`);
  run(`UPDATE contact_log SET outbox_id=NULL WHERE outbox_id IN (${mine})`);
  run(`DELETE FROM campaign_recipients WHERE outbox_id IN (${mine})`);
  const mineIds = all(mine).map((x) => x.outbox_id);
  run(`DELETE FROM outbox_delivery WHERE provider_ref LIKE 'fix04-%'`);
  for (const id of mineIds) run('DELETE FROM outbox WHERE id=?', id);
  run("UPDATE automation_events SET run_id=NULL WHERE ref='fix04'"); run(`DELETE FROM automation_runs WHERE items_json='["fix04"]'`); run("DELETE FROM automation_events WHERE ref='fix04'");
  const nextFix = (t) => Math.max(FIX, one(`SELECT COALESCE(MAX(id),0) m FROM ${t}`).m + 1);

  const outbox = (o) => {
    const id = ins('outbox', { id: nextFix('outbox'), channel: o.ch, to_addr: o.to, subject: o.subject || null, body: o.body, attachments_json: '[]', entity: o.entity || 'households', entity_id: o.eid ?? o.hid,
      campaign_id: o.camp || null, status: 'sent', error: null, created_at: o.at, sent_at: plus(o.at, 40), created_by: o.by ? U[o.by] : null, category: 'resident', household_id: o.hid, automation: o.auto || null });
    ins('outbox_delivery', { outbox_id: id, integration: o.ch, attempts: 1, dry_run: 1, provider_ref: `fix04-${id}`, external_status: o.ch === 'voice' ? 'delivered' : 'read', external_at: plus(o.at, 600), created_at: o.at });
    return id;
  };
  const contact = (c) => ins('contact_log', { id: nextFix('contact_log'), household_id: c.hid, at: c.at, channel: c.ch, direction: c.dir || 'out', by_user_id: c.role ? U[c.role] : null, by_name: c.role ? N[c.role] : 'המערכת',
    summary: c.summary, follow_up_date: null, follow_up_done_at: null, outbox_id: c.out || null, source: c.src ? `${c.src}` : 'message', created_at: c.at });
  const setOutbox = (id, patch) => { const k = Object.keys(patch); run(`UPDATE outbox SET ${k.map((x) => `${x}=?`).join(',')} WHERE id=?`, ...k.map((x) => patch[x]), id);
    if (patch.channel) run('UPDATE outbox_delivery SET integration=? WHERE outbox_id=?', patch.channel, id);
    if (patch.created_at) run('UPDATE outbox_delivery SET created_at=?, external_at=? WHERE outbox_id=?', patch.created_at, plus(patch.created_at, 600), id); };
  const setContact = (id, patch) => { const k = Object.keys(patch); run(`UPDATE contact_log SET ${k.map((x) => `${x}=?`).join(',')} WHERE id=?`, ...k.map((x) => patch[x]), id); };
  const setEvent = (id, patch) => { const k = Object.keys(patch); run(`UPDATE automation_events SET ${k.map((x) => `${x}=?`).join(',')} WHERE id=?`, ...k.map((x) => patch[x]), id);
    const e = one('SELECT * FROM automation_events WHERE id=?', id);
    if (e?.run_id) run('UPDATE automation_runs SET key=?, started_at=?, finished_at=?, created_at=?, summary=?, done=? WHERE id=?', e.key, e.at, plus(e.at, 4), e.at, e.summary, e.n, e.run_id); };
  const event = (key, at, summary, x = {}) => {
    const id = ins('automation_events', { id: nextFix('automation_events'), key, entity: x.entity || (x.hid ? 'households' : null), entity_id: x.eid || x.hid || null, household_id: x.hid || null, ref: 'fix04', summary,
      status: x.status || 'sent', n: x.n || 1, outbox_id: x.out || null, approval_id: null, at, user_id: null, created_at: at });
    const r = ins('automation_runs', { id: nextFix('automation_runs'), key, trigger: 'schedule', slot: null, started_at: at, finished_at: plus(at, 4), status: 'ok', done: x.n || 1, summary, error: null, dry_run: 0, items_json: '["fix04"]', user_id: null, created_at: at });
    run('UPDATE automation_events SET run_id=? WHERE id=?', r, id); return id;
  };

  // ------------------------------------------------------------ 4. office phone + hours (IVR, templates, notices)
  for (const t of all("SELECT id, body FROM message_templates WHERE body LIKE '%03-5790000%'")) note('templates.phone', run('UPDATE message_templates SET body=? WHERE id=?', t.body.replaceAll('03-5790000', OFFICE_PHONE), t.id));
  run('UPDATE message_templates SET body=? WHERE id=?', 'שלום {ראש_משפחה},\nתזכורת: התשלום הבא בהסדר ייגבה ב-15 לחודש. יתרת ההסדר: {יתרה}.', TPL.plan_update);
  for (const o of all("SELECT id, body FROM outbox WHERE body LIKE '%03-5790000%'")) note('outbox.phone', run('UPDATE outbox SET body=? WHERE id=?', o.body.replaceAll('03-5790000', OFFICE_PHONE), o.id));
  const office = one("SELECT settings_json FROM ivr_nodes WHERE key='office'");
  if (office) { const s = JSON.parse(office.settings_json || '{}'); s.phone = OFFICE_PHONE; s.hours = [{ days: [0, 1, 2, 3, 4], from: '08:30', to: '13:30' }, { days: [1, 3], from: '16:00', to: '18:00' }];
    note('ivr.office', run("UPDATE ivr_nodes SET settings_json=? WHERE key='office'", J(s))); }
  run("UPDATE ivr_nodes SET text=? WHERE key='info-hours'", 'המזכירות פתוחה בימים ראשון עד חמישי משמונה וחצי בבוקר עד אחת וחצי בצהריים, ובימים שני ורביעי גם מארבע עד שש אחר הצהריים.');
  note('notices', run("UPDATE notices SET body=? WHERE title='לוח החיובים לשנת תשפ״ז'", 'שכר הלימוד נגבה ב-10 בכל חודש. דמי רישום, ספרים וטיול שנתי נוספים לחיוב לפי הלוח שנשלח להורים. לשאלות: המזכירות, א׳–ה׳ 8:30–13:30, ובימים ב׳ וד׳ גם 16:00–18:00, טלפון 03-0000000.'));

  // ------------------------------------------------------------ 5. kosher-phone families get voice only
  const camp = Object.fromEntries(all('SELECT id, title FROM campaigns').map((c) => [c.title, c.id]));
  const campStats = (wa, voice) => { const b = (n) => ({ total: n, sent: n, queued: 0, failed: 0, skipped: 0, print: 0 }); const by = { whatsapp: b(wa) }; if (voice) by.voice = b(voice);
    return J({ total: wa + voice, sent: wa + voice, queued: 0, failed: 0, skipped: 0, print: 0, by_channel: by, rate: 100 }); };
  for (const title of ['פתיחת שנת הלימודים תשפ״ז', 'תזכורת לפני חיוב חשוון']) {
    const cid = camp[title]; if (!cid) continue;
    for (const r of all('SELECT * FROM campaign_recipients WHERE campaign_id=? AND household_id IN (3,6,7,9)', cid)) {
      run("UPDATE campaign_recipients SET channel='voice', to_addr=? WHERE id=?", HH[r.household_id].phone, r.id);
      if (r.outbox_id) setOutbox(r.outbox_id, { channel: 'voice', to_addr: HH[r.household_id].phone });
    }
    run('UPDATE campaigns SET stats_json=?, channels_json=? WHERE id=?', campStats(6, 4), J({ allowed: ['whatsapp', 'email', 'voice'], essential: false, print_notice: false, notice_until: null }), cid);
    note('campaigns.voice', 1);
  }
  const kislev = camp['תזכורת לפני חיוב כסלו'];
  if (kislev) { // the kosher families got the voice broadcast of the same day instead
    for (const r of all('SELECT * FROM campaign_recipients WHERE campaign_id=? AND household_id IN (3,6,7,9)', kislev)) {
      run('DELETE FROM campaign_recipients WHERE id=?', r.id);
      if (r.outbox_id) { run('UPDATE contact_log SET outbox_id=NULL WHERE outbox_id=?', r.outbox_id); run('DELETE FROM outbox_delivery WHERE outbox_id=?', r.outbox_id); run('DELETE FROM outbox WHERE id=?', r.outbox_id); }
    }
    const aud = JSON.parse(one('SELECT audience_json FROM campaigns WHERE id=?', kislev).audience_json || '{}'); aud.kosher = 'none';
    run('UPDATE campaigns SET stats_json=?, audience_json=? WHERE id=?', campStats(6, 0), J(aud), kislev);
  }
  for (const c of [['פתיחת שנת הלימודים', '10 משפחות: 6 בוואטסאפ ו-4 בהודעה קולית לטלפון כשר', 10], ['תזכורת לפני חיוב חשוון', '10 משפחות: 6 בוואטסאפ ו-4 בהודעה קולית לטלפון כשר', 10], ['תזכורת לפני חיוב כסלו', '6 משפחות בוואטסאפ (4 המשפחות עם טלפון כשר קיבלו הודעה קולית)', 6]]) {
    const e = one("SELECT id FROM automation_events WHERE key='announce' AND summary LIKE ?", `%${c[0]}%`); if (e) setEvent(e.id, { summary: `דיוור «${c[0]}» נשלח ל-${c[1]}`, n: c[2] });
  }
  // voice broadcast «תזכורת לפני חיוב כסלו» → the 4 kosher families, with outbox rows (the screen counts them)
  const bc = one("SELECT * FROM voice_broadcasts WHERE title='תזכורת לפני חיוב כסלו'");
  if (bc) {
    run("DELETE FROM outbox_delivery WHERE outbox_id IN (SELECT id FROM outbox WHERE entity='voice_broadcasts' AND entity_id=?)", bc.id);
    run("DELETE FROM outbox WHERE entity='voice_broadcasts' AND entity_id=?", bc.id);
    for (const hid of KOSHER) outbox({ ch: 'voice', to: HH[hid].phone, subject: bc.title, body: bc.text, hid, entity: 'voice_broadcasts', eid: bc.id, at: bc.sent_at, by: 'secretary' });
    run('UPDATE voice_broadcasts SET audience_json=?, stats_json=? WHERE id=?', J({ kind: 'kosher', street_ids: [], household_ids: [] }), J({ total: 4, queued: 0, sent: 4, failed: 0, skipped: 0, no_phone: 0 }), bc.id);
    note('voice_broadcasts', 1);
  }
  run("UPDATE voice_broadcasts SET audience_json=? WHERE status='draft'", J({ kind: 'kosher', street_ids: [], household_ids: [] }));

  // ------------------------------------------------------------ 7. גולדברג (kosher): 4 voice reminders, months תשרי/חשוון/כסלו + דמי רישום
  const G = HH[6]; const remBody = tpl(TPL.tuition_reminder).body;
  const gold = [
    [700031, 700001, '2026-10-15', '11:00', '2,500 ₪', 'תשרי, חשוון ודמי הרישום פתוחים', 'משפחת גולדברג: תזכורת ראשונה, תשרי, חשוון ודמי רישום (2,500 ₪)'],
    [700032, 700002, '2026-10-29', '11:00', '2,500 ₪', 'תזכורת שנייה, בלי מענה', 'משפחת גולדברג: תזכורת שנייה, בלי מענה (2,500 ₪)'],
    [700033, 700003, '2026-11-12', '11:00', '3,600 ₪', 'שלושה חודשים פתוחים: תשרי, חשוון וכסלו', 'משפחת גולדברג: תזכורת שלישית, שלושה חודשים ודמי רישום (3,600 ₪)'],
    [700034, 700004, '2026-11-19', '10:00', '3,600 ₪', 'תזכורת רביעית, בלי מענה', null],
  ];
  for (const [oid, clid, d, hm, bal, nt, ev] of gold) {
    const at = T(d, hm); const [dd, mm, yy] = d.split('-').reverse();
    setOutbox(oid, { channel: 'voice', to_addr: G.phone, created_at: at, sent_at: plus(at, 40), body: fill(tpl(TPL.tuition_reminder).body, G, bal, `${dd}.${mm}.${yy}`) });
    setContact(clid, { channel: 'voice', at, created_at: at, summary: `תזכורת בהודעה קולית: שכר לימוד · ${nt}` });
    if (ev) { const e = one("SELECT id FROM automation_events WHERE key='dun' AND household_id=6 AND outbox_id IS NULL AND substr(at,1,10)=?", d) || one("SELECT id FROM automation_events WHERE key='dun' AND household_id=6 AND substr(at,1,10)=?", d);
      if (e) setEvent(e.id, { at, created_at: at, summary: ev }); }
  }
  void remBody;
  const ap = (title) => one('SELECT id FROM approvals WHERE title=?', title)?.id;
  run('UPDATE approvals SET summary=?, amount=3600 WHERE id=?', 'שלושה חודשים פתוחים (תשרי, חשוון וכסלו) ודמי רישום, 3,600 ₪. נשלחו 4 תזכורות בהודעה קולית (טלפון כשר) ושתי שיחות טלפון בלי מענה. המכתב יישלח בדואר ובמייל בחתימת מנהל המוסד.', ap('מכתב התראה רשמי למשפחת גולדברג'));
  run("UPDATE tasks SET body=? WHERE title='להתקשר למשפחת גולדברג: שלושה חודשים פתוחים'", `לא חוזרים אחרי ההודעות הקוליות (טלפון כשר). לנסות את האם (${G.phone2}) אחרי 16:00.`);

  // רוזנטל (kosher): the update of 22.11 went as a voice message
  { const at = T('2026-11-22', '11:00'); const o = outbox({ ch: 'voice', to: HH[7].phone, subject: 'עדכון על חיוב ההסעות', body: 'שלום ר׳ אליעזר, בדקנו וצדקת: צבי לא רשום להסעה. ההחזר על 180 ₪ ממתין לאישור הגזבר, ונעדכן כשיבוצע. הנהלת החשבונות.', hid: 7, at, by: 'bookkeeper' });
    const c = one("SELECT id FROM contact_log WHERE household_id=7 AND id < 790001 AND substr(at,1,10)='2026-11-22'");
    if (c) setContact(c.id, { channel: 'voice', at, created_at: at, outbox_id: o, summary: 'הודעה קולית: החיוב נמצא שגוי וההחזר ממתין לאישור הגזבר.' }); }
  // קליין (kosher): welcome letter by e-mail, and a voice update on 25.11
  { const c = one("SELECT id, outbox_id FROM contact_log WHERE household_id=9 AND outbox_id IS NOT NULL AND summary='ברוכים הבאים'");
    if (c) { setOutbox(c.outbox_id, { channel: 'email', to_addr: HH[9].email }); setContact(c.id, { channel: 'email', summary: 'ברוכים הבאים · מכתב פתיחה במייל עם לוח הזמנים, ההסעות ולוח החיובים' }); }
    const at = T('2026-11-25', '09:45');
    const o = outbox({ ch: 'voice', to: HH[9].phone, subject: 'בקשת הזיכוי בדמי הרישום', body: 'שלום משפחת קליין, בקשתכם לזיכוי חלקי בדמי הרישום הועברה לאישור הגזבר. נעדכן אתכם בקרוב. המזכירות.', hid: 9, at, by: 'secretary' });
    contact({ hid: 9, at, ch: 'voice', role: 'secretary', summary: 'הודעה קולית: בקשת הזיכוי בדמי הרישום הועברה לאישור הגזבר.', out: o, src: 'message' }); }

  // ------------------------------------------------------------ 1 + 7. לוי: תשרי חזר 15.09 «אין כיסוי», שולם 24.09; דמי רישום 20.10; כסלו חזר 25.11 (נקלט 26.11 08:00)
  { const L = HH[1];
    const sept = T('2026-09-15', '09:30');
    setOutbox(700035, { created_at: sept, sent_at: plus(sept, 40) });
    setContact(700007, { at: sept, created_at: sept, summary: 'התשלום לא עבר · הוראת הקבע של תשרי חזרה «אין כיסוי»' });
    const call = T('2026-09-16', '11:00');
    setContact(700008, { at: call, created_at: call, summary: 'הוראת הקבע של תשרי חזרה. האב הבטיח להסדיר בהעברה בנקאית (התקבלה ב-24.09).' });
    setContact(700011, { summary: 'תזכורת טלפונית על דמי הרישום שנותרו (300 ₪). שולמו בהעברה באותו יום (קבלה ק-1023).' });
    const kis = T('2026-11-26', '08:01');
    setOutbox(700036, { created_at: kis, sent_at: plus(kis, 40) });
    setContact(700009, { at: kis, created_at: kis, summary: 'התשלום לא עבר · הוראת הקבע של כסלו חזרה «ההרשאה בוטלה»' });
    const reply = T('2026-11-26', '08:25');
    setContact(700010, { at: reply, created_at: reply });
    for (const [d, s] of [['2026-09-12', { at: plus(sept, 0), summary: 'משפחת לוי: הוראת הקבע של תשרי חזרה «אין כיסוי», נשלחה הודעה' }], ['2026-11-25', { at: kis, summary: 'משפחת לוי: הוראת הקבע של כסלו חזרה «ההרשאה בוטלה», נשלחה הודעה' }]]) {
      const e = one("SELECT id FROM automation_events WHERE key='tak_returned' AND household_id=1 AND substr(at,1,10) IN (?, ?)", d, s.at.slice(0, 10)); if (e) setEvent(e.id, { ...s, created_at: s.at });
    }
    // request 1001 opened after the message of 26.11
    const rq = one('SELECT id FROM requests WHERE number=1001');
    if (rq) {
      const op = T('2026-11-26', '08:10');
      run("UPDATE requests SET opened_at=?, created_at=?, first_response_at=?, expected_date='2026-11-29', updated_at=? WHERE id=?", op, op, T('2026-11-26', '08:35'), T('2026-11-26', '08:50'), rq.id);
      const ups = all('SELECT * FROM request_updates WHERE request_id=? ORDER BY id', rq.id);
      const times = { status_open: op, auto: T('2026-11-26', '08:35'), in: T('2026-11-26', '08:25'), progress: T('2026-11-26', '08:45'), note: T('2026-11-26', '08:50') };
      for (const u of ups) {
        let at = u.at; let body = u.body;
        if (u.kind === 'status' && u.status_to === 'new') { at = times.status_open; body = body.replace(/צפי [\d.]+/, 'צפי 29.11.2026'); }
        else if (u.kind === 'message' && u.direction === 'out' && /פנייתך התקבלה/.test(u.body)) { at = times.auto; body = body.replace(/עד [\d.]+\./, 'עד 29.11.2026.'); }
        else if (u.kind === 'message' && u.direction === 'in') at = times.in;
        else if (u.kind === 'status') at = times.progress;
        else if (u.kind === 'note') at = times.note;
        run('UPDATE request_updates SET at=?, created_at=?, body=? WHERE id=?', at, at, body, u.id);
      }
      run("UPDATE audit_log SET at=? WHERE entity='requests' AND entity_id=? AND action='create'", op, rq.id);
    }
    const tk = one("SELECT id FROM tasks WHERE title='לברר עם משפחת לוי את ביטול ההרשאה בבנק'");
    if (tk) { run('UPDATE tasks SET created_at=?, updated_at=?, body=? WHERE id=?', T('2026-11-26', '08:50'), T('2026-11-26', '08:50'), 'הוראת הקבע של כסלו חזרה מהבנק ב-25.11 «ההרשאה בוטלה». צריך הרשאה חדשה או תשלום באשראי.', tk.id);
      run("UPDATE audit_log SET at=? WHERE entity='tasks' AND entity_id=? AND action='create'", T('2026-11-26', '08:50'), tk.id); }
    void L;
  }
  // וייס: כסלו (10.11) חזר 13.11 «אין כיסוי»
  setContact(700012, { summary: 'התשלום לא עבר · הוראת הקבע של כסלו חזרה «אין כיסוי»' });
  setContact(700014, { summary: 'סוכם לחייב שוב ב-1.12 ולפרוס את כסלו לשלושה תשלומים (ממתין לאישור הגזבר).' });
  { const e = one("SELECT id FROM automation_events WHERE key='tak_returned' AND household_id=4"); if (e) setEvent(e.id, { summary: 'משפחת וייס: הוראת הקבע של כסלו חזרה «אין כיסוי», נשלחה הודעה' }); }
  { const id = ap('פריסת חוב חשוון של משפחת וייס ל-3 תשלומים') || ap('פריסת חוב כסלו של משפחת וייס ל-3 תשלומים');
    if (id) run('UPDATE approvals SET title=?, summary=? WHERE id=?', 'פריסת חוב כסלו של משפחת וייס ל-3 תשלומים', 'הוראת הקבע של כסלו (10.11) חזרה ב-13.11 «אין כיסוי». האב ביקש לפרוס את 1,200 ₪ לשלושה תשלומים בדצמבר, ינואר ופברואר, בנוסף לחיוב השוטף.', id); }
  // ברגר: האשראי של כסלו נכשל ב-10.11 (כמו בתיק ההחזרה: 12:05–12:06)
  { const at = T('2026-11-10', '12:06');
    setOutbox(700039, { created_at: at, sent_at: plus(at, 40) }); setContact(700016, { at, created_at: at });
    const e = one("SELECT id FROM automation_events WHERE key='tak_returned' AND household_id=8"); if (e) setEvent(e.id, { at, created_at: at, summary: 'משפחת ברגר: חיוב האשראי של כסלו נכשל (כרטיס פג תוקף), נשלחה הודעה' }); }
  // שפירא: הסדר 4,100 ₪ = 4 × 1,025 ₪ ב-15 לחודש מ-15.11 (כמו ב-arrangements); תשלום 1 נגבה 15.11 (ק-1032)
  { const S = HH[5];
    const id = ap('הסדר פריסה למשפחת שפירא: 4 תשלומים');
    if (id) run('UPDATE approvals SET summary=?, amount=4100 WHERE id=?', 'פריסת חוב של 4,100 ₪ (שכר הלימוד ודמי הרישום של תשרי וחשוון) לארבעה תשלומים חודשיים של 1,025 ₪ ב-15 לחודש, מ-15.11 עד 15.2, בנוסף לשכר הלימוד השוטף.', id);
    const rq = one('SELECT id FROM requests WHERE number=1007');
    if (rq) { run('UPDATE requests SET body=?, close_summary=? WHERE id=?', 'חוב של 4,100 ₪ על שכר הלימוד ודמי הרישום של תשרי וחשוון. מבקשים לפרוס לארבעה חודשים.', 'אושר הסדר ל-4 תשלומים של 1,025 ₪ מ-15.11.', rq.id);
      run("UPDATE request_updates SET body=? WHERE request_id=? AND kind='status' AND status_to='closed'", 'בטיפול ← נסגרה · אושר הסדר ל-4 תשלומים של 1,025 ₪ מ-15.11.', rq.id); }
    run("UPDATE documents SET body_text=?, data_json=? WHERE household_id=5 AND title='אישור הסדר תשלומים'", 'הסדר תשלומים למשפחת שפירא: חוב של 4,100 ₪ ייפרע בארבעה תשלומים של 1,025 ₪ ב-15 לחודש, מ-15 בנובמבר 2026 עד 15 בפברואר 2027, בנוסף לשכר הלימוד השוטף.',
      J({ subject: 'אישור הסדר תשלומים', free_text: 'הסדר תשלומים למשפחת שפירא: חוב של 4,100 ₪ ייפרע בארבעה תשלומים של 1,025 ₪ ב-15 לחודש, מ-15 בנובמבר 2026 עד 15 בפברואר 2027, בנוסף לשכר הלימוד השוטף.' }));
    run("UPDATE household_events SET reason='נפתח הסדר תשלומים: 4 תשלומים של 1,025 ₪' WHERE household_id=5 AND reason LIKE 'נפתח הסדר%'");
    run("UPDATE tasks SET due_date='2026-12-15', body='תשלום 2 מתוך 4 (1,025 ₪) ב-15.12. תשלום 1 נגבה ב-15.11.' WHERE title='לעקוב אחרי תשלום 2 מתוך 4 בהסדר של שפירא'");
    setOutbox(700040, { body: fill(tpl(TPL.plan_update).body, S, '4,100 ₪') });
    setContact(700019, { summary: 'הסדר התשלומים שלכם · נשלח לוח התשלומים: 4 × 1,025 ₪ ב-15 לחודש' });
    const at = T('2026-11-12', '09:00');
    setOutbox(700041, { created_at: at, sent_at: plus(at, 40), automation: 'plan_remind', body: fill(tpl(TPL.plan_update).body, S, '4,100 ₪') });
    setContact(700020, { at, created_at: at, source: 'plan_remind', summary: 'הסדר התשלומים שלכם · תזכורת לתשלום 1 מתוך 4 (1,025 ₪) ב-15.11' });
    const e = one("SELECT id FROM automation_events WHERE household_id=5 AND key IN ('dun','plan_remind')");
    if (e) setEvent(e.id, { key: 'plan_remind', at, created_at: at, outbox_id: 700041, summary: 'משפחת שפירא: תזכורת לתשלום 1 מתוך 4 בהסדר (1,025 ₪ ב-15.11)' });
  }

  // ------------------------------------------------------------ 3. receipt automation = the receipts of the last 30 days (7 valid); sobounce = the so_returns
  { const e = one("SELECT id FROM automation_events WHERE key='receipt' AND id < 790001");
    if (e) setEvent(e.id, { n: 6, summary: '6 קבלות הופקו על גביית כסלו (10.11) ונשלחו במייל' });
    const rc = (hid, amount, at, text) => { const h = HH[hid]; const body = fill(tpl(TPL.receipt).body, h, '0 ₪');
      const o = outbox({ ch: 'email', to: h.email, subject: 'קבלה על תשלום שכר לימוד', body, hid, at, auto: 'receipt' });
      contact({ hid, at, ch: 'email', summary: `קבלה על תשלום שכר לימוד · ${text}`, out: o, src: 'receipt' }); return o; };
    rc(5, 1900, T('2026-11-10', '14:00'), 'קבלה על 1,900 ₪ · כסלו');
    rc(7, 650, T('2026-11-10', '14:00'), 'קבלה על 650 ₪ · כסלו');
    const o = rc(5, 1025, T('2026-11-15', '10:12'), 'קבלה ק-1032 על 1,025 ₪ · תשלום 1 מתוך 4 בהסדר');
    event('receipt', T('2026-11-15', '10:12'), 'קבלה ק-1032 למשפחת שפירא: תשלום 1 מתוך 4 בהסדר (1,025 ₪), נשלחה במייל', { hid: 5, out: o });
    for (const r of all('SELECT s.*, h.family_name FROM so_returns s JOIN households h ON h.id=s.household_id WHERE s.deleted_at IS NULL ORDER BY s.created_at'))
      event('sobounce', r.created_at, `משפחת ${r.family_name}: הוראת הקבע של ${{ '2026-09': 'תשרי', '2026-10': 'חשוון', '2026-11': 'כסלו' }[String(r.return_date).slice(0, 7)] || ''} חזרה בקובץ של מס״ב «${r.reason_text}», נפתחה משימה למזכירות`.replace('של  ', 'של '), { hid: r.household_id, entity: 'so_returns', eid: r.id, status: 'done' });
  }

  // ------------------------------------------------------------ 2. request 1006 → משפחת כהן (אח צעיר לגן בשנה הבאה)
  { const rq = one('SELECT id FROM requests WHERE number=1006');
    if (rq) { const C2 = HH[2];
      run('UPDATE requests SET household_id=2, contact_name=?, contact_phone=?, body=? WHERE id=?', `שרה כהן (האם)`, C2.phone, 'הודעה קולית: האם מבקשת לרשום את הבן הצעיר לגן בשנת תשפ״ח, ושואלת מתי נפתח הרישום ומה שכר הלימוד בגן.', rq.id);
      run("UPDATE voice_calls SET household_id=2, phone=? WHERE request_id=?", C2.phone.replace(/-/g, ''), rq.id); note('request1006', 1); } }

  // ------------------------------------------------------------ 8. no request is escalated (none is older than 7 days)
  note('requests.unescalated', run("UPDATE requests SET escalated_at=NULL WHERE status IN ('new','in_progress','waiting') AND escalated_at IS NOT NULL AND substr(opened_at,1,10) > '2026-11-19'"));

  // ------------------------------------------------------------ 6. voiceline: one event per incoming call (the call log of the last 30 days)
  run("DELETE FROM voice_calls WHERE sim=1 AND created_at > '2026-11-26T21:00'");
  { const old = one("SELECT id, run_id FROM automation_events WHERE key='voiceline' AND id < 790001");
    if (old) { run('UPDATE automation_events SET run_id=NULL WHERE id=?', old.id); if (old.run_id) run('DELETE FROM automation_runs WHERE id=?', old.run_id); run('DELETE FROM automation_events WHERE id=?', old.id); }
    const RES = { info: 'קיבלה מידע', request: 'נפתחה פנייה', transfer: 'הועברה למזכירות', voicemail: 'השאירה הודעה בתא הקולי', hangup: 'ניתקה בתפריט', unidentified: 'מספר לא מזוהה' };
    const OPT = { balance: 'מצב חשבון שכר לימוד', request: 'פנייה למזכירות', office: 'המזכירות', announcements: 'הודעות התלמוד תורה', info: 'מידע להורים' };
    for (const c of all("SELECT v.*, h.family_name, r.number FROM voice_calls v LEFT JOIN households h ON h.id=v.household_id LEFT JOIN requests r ON r.id=v.request_id WHERE v.sim=0 AND v.deleted_at IS NULL ORDER BY v.started_at")) {
      const who = c.family_name ? `משפחת ${c.family_name}` : 'מספר לא מזוהה'; const opt = OPT[String(c.path).split('>')[1]] || 'תפריט ראשי';
      const s = c.result === 'request' ? `${who}: הודעה קולית נפתחה כפנייה ${c.number}` : `${who}: ${opt} · ${RES[c.result] || c.result}`;
      event('voiceline', c.started_at, s, { hid: c.household_id || null, entity: 'voice_calls', eid: c.id, status: 'done' });
    }
  }

  // ------------------------------------------------------------ 9. QA leftovers after the demo day (26.11 23:00 Israel) — audit_log only (files/import_runs are not ours)
  { const last = one("SELECT id FROM audit_log WHERE entity='users' AND action='login' ORDER BY at DESC, id DESC LIMIT 1");
    note('audit.qa_removed', run("DELETE FROM audit_log WHERE at > '2026-11-26T21:00:00Z' AND id <> ?", last ? last.id : -1)); }

  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) throw new Error('foreign_key_check: ' + J(fk.slice(0, 5)));
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(JSON.stringify(report, null, 1));
