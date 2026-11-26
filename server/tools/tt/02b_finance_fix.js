// tt/02b_finance_fix.js — «גבאי»: QA corrections on top of 02_finance.js (idempotent; one transaction).
// Called at the end of 02_finance.js, and can run on its own: node server/tools/tt/02b_finance_fix.js [path/to/demo.db]
//  · month names: the charge of 10.9 = תשרי, 11.10 = חשוון, 10.11 = כסלו (Rosh Chodesh) — in every text of the finance tables
//  · no unsaved December draft in billing_runs · fee 0 on returned payments (no fee charge exists)
//  · שפירא: one story — call 12.10 → approval A8 14.10 → arrangement 4,100 ₪ (4×1,025 from 15.11); ladder paused «בהסדר תשלומים»
//  · לוי: ladder reset at 20.10 15:01 (after ק-1023); RT-5101 settled on 20.10; November return detected on 25.11 after the void
//  · returned cases are detected after the bank void (10:00) · contact log: וייס automatic call 19.11, לוי message 25.11
//  · גולדברג: fourth reminder 26.10 · so_day = 10 · trip → 1410, books → 1430
'use strict';
const path = require('path');
const SH = require('../../lib/shabbat');

const at = (ymd, hm = '09:00') => SH.israelToDate(ymd, hm).toISOString();
const MONTH_FIX = [['ספטמבר 2026', 'תשרי תשפ״ז'], ['אוקטובר 2026', 'חשוון תשפ״ז'], ['נובמבר 2026', 'כסלו תשפ״ז'], ['דצמבר 2026', 'טבת תשפ״ז'],
  ['ספטמבר–אוקטובר', 'תשרי–חשוון'], ['ספטמבר', 'תשרי'], ['אוקטובר', 'חשוון'], ['נובמבר', 'כסלו']];
const TEXT_TABLES = ['charges', 'receipts', 'bank_lines', 'card_links', 'arrangements', 'standing_orders', 'collection_calls', 'dunning_events', 'dunning_state',
  'so_batches', 'so_returns', 'billing_runs', 'tak_returned', 'tak_returned_events', 'tak_snapshots', 'tak_diffs'];

function apply(db) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const NOW = new Date().toISOString();

  // 3. month names
  for (const t of TEXT_TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().filter((c) => /TEXT/i.test(c.type) && !/_at$|date|^at$|period|month|token|fingerprint|hash/.test(c.name)).map((c) => c.name);
    for (const c of cols) for (const [a, b] of MONTH_FIX) run(`UPDATE ${t} SET ${c}=replace(${c}, ?, ?) WHERE instr(${c}, ?)>0`, a, b, a);
  }

  // 4. drafts that were saved by a preview (no charges attached)
  run("DELETE FROM billing_runs WHERE status='draft' AND id NOT IN (SELECT DISTINCT run_id FROM charges WHERE run_id IS NOT NULL)");

  // 8. returned-payment fee — there is no fee charge, so the case shows only the returned amount
  run('UPDATE tak_returned SET fee=0 WHERE fee<>0');

  // 14. budget lines of the tariffs
  run("UPDATE tariffs SET budget_line_code='1410' WHERE name LIKE 'טיול שנתי%'");
  run("UPDATE tariffs SET budget_line_code='1430' WHERE name LIKE 'ספרים%'");

  // 13. standing orders are collected on the 10th, like the tuition
  run("INSERT INTO settings (key,value_json) VALUES ('payments.so_day','10') ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json");

  // returned cases: detected only after the bank void (10:00) of the receipt
  const caseOf = (ext) => one('SELECT * FROM tak_returned WHERE ext_id=? AND deleted_at IS NULL', ext);
  const evSet = (cid, kind, ts, note) => run(`UPDATE tak_returned_events SET at=?, created_at=?, updated_at=?${note !== undefined ? ', note=?' : ''} WHERE case_id=? AND kind=?`,
    ...[ts, ts, ts, ...(note !== undefined ? [note] : []), cid, kind]);
  for (const ext of ['RT-5101', 'RT-5102', 'RT-5103', 'RT-5106']) {
    const c = caseOf(ext); if (!c) continue;
    evSet(c.id, 'detected', at(c.returned_at, '10:05'), 'בקובץ ההחזרות של מס״ב ובבדיקה במערכת החשבונות');
    evSet(c.id, 'wa1', at(c.returned_at, '10:30'));
    run('UPDATE tak_returned SET created_at=? WHERE id=?', at(c.returned_at, '10:05'), c.id);
  }
  run("UPDATE dunning_events SET at=?, created_at=?, updated_at=? WHERE household_id=4 AND kind='pause'", at('2026-11-13', '10:35'), at('2026-11-13', '10:35'), at('2026-11-13', '10:35'));

  // 11. לוי — November return (returned and voided on 25.11 10:00)
  const levi = one("SELECT * FROM tak_returned WHERE household_id=1 AND returned_at='2026-11-25' AND deleted_at IS NULL");
  if (levi) {
    evSet(levi.id, 'detected', at('2026-11-25', '10:05'), 'בקובץ ההחזרות של מס״ב ובבדיקה במערכת החשבונות');
    evSet(levi.id, 'wa1', at('2026-11-25', '10:30'));
    run('UPDATE tak_returned SET last_step_at=?, created_at=?, updated_at=? WHERE id=?', '2026-11-25', at('2026-11-25', '10:05'), at('2026-11-25', '10:30'), levi.id);
  }
  run("UPDATE dunning_events SET at=?, created_at=?, updated_at=? WHERE household_id=1 AND kind='pause'", at('2026-11-25', '10:35'), at('2026-11-25', '10:35'), at('2026-11-25', '10:35'));
  run('UPDATE dunning_state SET updated_at=? WHERE household_id=1', at('2026-11-25', '10:35'));

  // 10. לוי — the ladder is reset only after ק-1023 (20.10), and RT-5101 is settled then
  const r1023 = one("SELECT id, number FROM receipts WHERE household_id=1 AND date='2026-10-20' AND status='valid'");
  run("UPDATE dunning_events SET at=?, created_at=?, updated_at=?, note=? WHERE household_id=1 AND kind='reset'", at('2026-10-20', '15:01'), at('2026-10-20', '15:01'), at('2026-10-20', '15:01'),
    `קבלה ק-${r1023 ? r1023.number : 1023} · היתרה 0 ₪`);
  const rt1 = caseOf('RT-5101');
  if (rt1) {
    run('UPDATE tak_returned SET closed_at=?, updated_at=? WHERE id=?', at('2026-10-20', '15:05'), at('2026-10-20', '15:05'), rt1.id);
    evSet(rt1.id, 'settled', at('2026-10-20', '15:05'), 'הוסדר במלואו: 1,450 ₪ בהעברה ב-24.09 ודמי הרישום 300 ₪ ב-20.10');
    if (!one("SELECT 1 FROM tak_returned_events WHERE case_id=? AND kind='note'", rt1.id)) {
      const ts = at('2026-09-24', '12:00');
      db.prepare('INSERT INTO tak_returned_events (case_id, at, kind, channel, note, auto, by_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(rt1.id, ts, 'note', null, 'נכנסה העברה של 1,450 ₪ (שכר הלימוד). דמי הרישום 300 ₪ עדיין פתוחים — ממשיכים בסולם התזכורות', 0, 'המזכירה גב׳ רחל מנדלסון', ts, ts);
    }
  }
  run("UPDATE so_returns SET handled_at=?, handled_note=? WHERE household_id=1 AND return_date='2026-09-15'", at('2026-10-20', '15:05'), 'שולם בשתי העברות: 1,450 ₪ ב-24.09 ו-300 ₪ ב-20.10');

  // 1. שפירא — call 12.10 → request 13.10 → approval A8 14.10 10:15 → arrangement 4,100 ₪
  const appr = one("SELECT id FROM approvals WHERE kind='arrangement' AND entity='households' AND entity_id=5 AND deleted_at IS NULL ORDER BY id DESC");
  const tA = at('2026-10-14', '10:15');
  run("UPDATE collection_calls SET at=?, created_at=?, updated_at=?, summary=? WHERE household_id=5 AND outcome='arrangement'", at('2026-10-12', '19:10'), at('2026-10-12', '19:10'), at('2026-10-12', '19:10'),
    'שוחחנו עם האב. מצב כלכלי קשה, וגם הוראת הקבע של חשוון לא תעבור. ביקש לפרוס את החוב של תשרי וחשוון (4,100 ₪). סוכם להציע לגזבר 4 תשלומים של 1,025 ₪ מ-15.11, ושכר הלימוד השוטף ימשיך בהוראת קבע.');
  run("UPDATE arrangements SET created_at=?, approved_at=?, approval_id=COALESCE(?, approval_id) WHERE household_id=5", at('2026-10-13', '12:00'), tA, appr ? appr.id : null);
  run("UPDATE arrangement_installments SET created_at=? WHERE household_id=5", tA);
  run("UPDATE arrangement_installments SET updated_at=? WHERE household_id=5 AND status<>'paid'", tA);
  run("UPDATE dunning_events SET at=?, created_at=?, updated_at=? WHERE household_id=5 AND kind='arrangement'", tA, tA, tA);
  run("UPDATE standing_orders SET notes='חודשה אחרי אישור הסדר התשלומים (14.10.2026)' WHERE household_id=5");
  run("UPDATE so_returns SET handled_at=? WHERE household_id=5", at('2026-10-14', '10:20'));
  const rt2 = caseOf('RT-5102'); const rt3 = caseOf('RT-5103');
  if (rt2) { run('UPDATE tak_returned SET closed_at=?, updated_at=? WHERE id=?', at('2026-10-14', '10:20'), at('2026-10-14', '10:20'), rt2.id); evSet(rt2.id, 'closed', at('2026-10-14', '10:20'), 'נכלל בהסדר התשלומים שאישר הגזבר (4 תשלומים מ-15.11)'); }
  if (rt3) {
    run("DELETE FROM tak_returned_events WHERE case_id=? AND kind='paused'", rt3.id);
    run('UPDATE tak_returned SET closed_at=?, updated_at=? WHERE id=?', at('2026-10-14', '10:21'), at('2026-10-14', '10:21'), rt3.id);
    evSet(rt3.id, 'closed', at('2026-10-14', '10:21'), 'נכלל בהסדר התשלומים שאישר הגזבר באותו יום');
  }
  // 6. the ladder skips the family while the arrangement is active
  run("UPDATE dunning_state SET stage='none', last_step_at='2026-10-14', next_step_at=NULL, paused_reason='בהסדר תשלומים פעיל — 4 תשלומים של 1,025 ₪', paused_until='2027-02-15', updated_at=? WHERE household_id=5", tA);

  // 9. contact log — the messages and the call of the returned-payment track
  const callIns = (hid, ts, by, outcome, summary) => {
    if (one('SELECT 1 FROM collection_calls WHERE household_id=? AND at=?', hid, ts)) return;
    db.prepare('INSERT INTO collection_calls (household_id, by_name, at, outcome, summary, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(hid, by, ts, outcome, summary, ts, ts);
  };
  callIns(4, at('2026-11-19', '10:00'), 'שיחה אוטומטית', 'no_answer', 'שיחה קולית אוטומטית על הוראת הקבע של כסלו שחזרה (1,200 ₪). לא נענתה, וההורים לא חזרו אלינו.');
  const dunIns = (hid, ts, kind, o) => {
    if (one('SELECT 1 FROM dunning_events WHERE household_id=? AND kind=? AND at=?', hid, kind, ts)) return;
    db.prepare('INSERT INTO dunning_events (household_id, at, kind, status, channel, amount, days_overdue, note, auto, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(hid, ts, kind, 'sent', o.channel, o.amount, o.days, o.note, o.auto ?? 1, ts, ts);
  };
  dunIns(1, at('2026-11-25', '10:30'), 'gentle', { channel: 'whatsapp', amount: 1450, days: 15, note: 'הודעה על הוראת הקבע של כסלו שחזרה («ההרשאה בוטלה») — נשלחה ממסלול «תשלומים שחזרו»' });

  // 12. גולדברג — fourth reminder, before the treasurer's personal call
  dunIns(6, at('2026-10-26', '09:00'), 'second', { channel: 'whatsapp', amount: 2500, days: 46, note: 'תזכורת רביעית לפני שיחה אישית · 2,500 ₪ — לא נענתה' });

  void NOW;
}

module.exports = { apply };

if (require.main === module) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.argv[2] || path.join(__dirname, '../../../data/demo.db'));
  db.exec('PRAGMA busy_timeout=10000'); db.exec('PRAGMA foreign_keys=ON');
  db.exec('BEGIN');
  try {
    apply(db);
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) throw new Error('foreign_key_check: ' + JSON.stringify(bad.slice(0, 5)));
    db.exec('COMMIT');
    console.log('ok');
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* none */ } console.error(e); process.exit(1); }
}
