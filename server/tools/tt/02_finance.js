// tt/02_finance.js — «גבאי»: tuition-collection financial data for the ten families of תלמוד תורה «אור התורה» (run after 01_core.js).
// Wipes and rebuilds: tariffs, discounts, household_discounts, billing_runs, charges, receipts, receipt_allocations, standing_orders,
// so_batches, so_batch_lines, so_returns, bank_imports, bank_lines, card_links, arrangements, arrangement_installments, dunning_state,
// dunning_events, collection_calls, collection_targets, tak_runs, tak_snapshots, tak_diffs, tak_returned, tak_returned_events, invoices;
// renames cash_accounts. Re-runnable, one transaction. Usage: node server/tools/tt/02_finance.js [path/to/demo.db]
// Story (today 26.11.2026): charges for 09/10/11-2026 (due on the 10th, moved past Shabbat), December not charged yet.
// Balances = charges − non-reversed allocations: לוי 1,450 · וייס 1,200 · שפירא 3,075 (הסדר) · גולדברג 3,600 · רוזנטל 300 (הסעות, במחלוקת) · ברגר 1,450.
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const SH = require('../../lib/shabbat');
const A = require('../../routes/28_taktzivit/adapter');
const { createEngine } = require('../../routes/28_taktzivit/engine');
const { engine: billingEngine } = require('../../routes/20_billing.js');

const DB = process.argv[2] || path.join(__dirname, '../../../data/demo.db');
const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout=10000');
db.exec('PRAGMA foreign_keys=ON');

const TODAY = '2026-11-26';
const NOW = new Date().toISOString();
const at = (ymd, hm = '09:00') => SH.israelToDate(ymd, hm).toISOString();
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const plabel = (p) => `${MONTHS[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`;
const ils = (n) => `${Math.round(n).toLocaleString('en-US')} ₪`;
function ins(table, row) {
  const r = { created_at: NOW, updated_at: NOW, ...row };
  const k = Object.keys(r);
  return Number(db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`)
    .run(...k.map((x) => (r[x] !== null && typeof r[x] === 'object' ? JSON.stringify(r[x]) : r[x]))).lastInsertRowid);
}

// ------------------------------------------------------------------ the families (from 01_core)
const HH = new Map(db.prepare('SELECT * FROM households WHERE deleted_at IS NULL ORDER BY id').all().map((h) => [h.id, h]));
if (HH.size !== 10) throw new Error(`expected 10 households, found ${HH.size} — run 01_core.js first`);
const KIDS = new Map(); const FATHER = new Map();
for (const r of db.prepare("SELECT * FROM residents WHERE deleted_at IS NULL ORDER BY household_id, id").all()) {
  if (r.role === 'child') { if (!KIDS.has(r.household_id)) KIDS.set(r.household_id, []); KIDS.get(r.household_id).push({ name: r.first_name, cls: String(r.notes || '').split(' · ')[0] }); }
  if (r.role === 'head') FATHER.set(r.household_id, r.first_name);
}
const fam = (id) => HH.get(id).family_name;
const payer = (id) => `${FATHER.get(id)} ${fam(id)}`;
// monthly tuition after discount, and the discount that brings 650 ₪ per student down to it
const TUITION = { 1: 1450, 2: 980, 3: 650, 4: 1100, 5: 1900, 6: 1100, 7: 650, 8: 1450, 9: 1100, 10: 1450 };
const BUS = { 4: 'נחמן', 7: 'צבי' }; // registered for transport (100 ₪ a month)
const RATE = 650;

const OWN = ['receipt_allocations', 'so_returns', 'so_batch_lines', 'card_links', 'bank_lines', 'receipts', 'so_batches', 'standing_orders', 'bank_imports',
  'charges', 'billing_runs', 'household_discounts', 'discounts', 'tariffs', 'arrangement_installments', 'arrangements', 'dunning_events', 'dunning_state',
  'collection_calls', 'collection_targets', 'tak_returned_events', 'tak_returned', 'tak_diffs', 'tak_snapshots', 'tak_runs', 'invoices'];

async function main() {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE tak_emails SET case_id=NULL').run();
    for (const t of OWN) db.prepare(`DELETE FROM ${t}`).run();
    const E = billingEngine(db);
    const DUE = Object.fromEntries(['2026-09', '2026-10', '2026-11', '2026-12'].map((p) => [p, E.dueDate(p)]));

    // ---------------------------------------------------------------- tariffs & discounts
    const T = {};
    T.tuition = ins('tariffs', { name: 'שכר לימוד — לתלמיד', kind: 'levy', basis: 'per_member', amount: RATE, period: 'monthly', auto: 1, valid_from: '2026-09-01', valid_to: '2027-06-30', budget_line_code: '1100', sort: 1, notes: 'לכל תלמיד בגן ובכיתות א׳–ח׳. הנחת אחים לפי מספר התלמידים במשפחה.', created_at: at('2026-08-01') });
    T.reg = ins('tariffs', { name: 'דמי רישום — למשפחה', kind: 'certificate', basis: 'per_household', amount: 300, period: 'once', auto: 1, valid_from: '2026-08-01', valid_to: '2026-09-30', budget_line_code: '1350', sort: 2, notes: 'פעם אחת בשנה, עם החיוב של ספטמבר (משפחה חדשה — ביום ההרשמה)', created_at: at('2026-08-01') });
    T.bus = ins('tariffs', { name: 'הסעות — לתלמיד', kind: 'water', basis: 'per_member', amount: 100, period: 'monthly', auto: 0, valid_from: '2026-09-01', valid_to: '2027-06-30', budget_line_code: '1250', sort: 3, notes: 'רק לתלמידים שנרשמו להסעה', created_at: at('2026-08-01') });
    T.meals = ins('tariffs', { name: 'ארוחות צהריים — לתלמיד', kind: 'hall', basis: 'per_member', amount: 180, period: 'monthly', auto: 0, valid_from: '2026-09-01', valid_to: '2027-06-30', budget_line_code: '1300', sort: 4, notes: 'למשפחות שנרשמו לארוחות', created_at: at('2026-08-01') });
    T.trip = ins('tariffs', { name: 'טיול שנתי — לתלמיד', kind: 'activity', basis: 'per_member', amount: 150, period: 'yearly', bill_month: 5, auto: 0, budget_line_code: '1400', sort: 5, notes: 'נגבה באייר, לפני הטיול', created_at: at('2026-08-01') });
    T.books = ins('tariffs', { name: 'ספרים וחוברות — לתלמיד', kind: 'fine', basis: 'per_member', amount: 120, period: 'once', auto: 0, budget_line_code: '1500', sort: 6, notes: 'לפי רשימת הספרים של הכיתה', created_at: at('2026-08-01') });
    const D = {};
    const disc = (name, value, notes, kind = 'amount', criteria = 'manual') => ins('discounts', { name, kind, value, criteria, applies_to: 'levy', auto: 0, approval_ref: 'החלטת הנהלה 2/תשפ״ז', valid_from: '2026-09-01', valid_to: '2027-06-30', notes, created_at: at('2026-08-01') });
    D[2] = disc('הנחת אחים — 2 תלמידים', 200, '200 ₪ בחודש למשפחה עם שני תלמידים');
    D[3] = disc('הנחת אחים — 3 תלמידים', 500, '500 ₪ בחודש למשפחה עם שלושה תלמידים');
    D[4] = disc('הנחת אחים — 4 תלמידים', 700, '700 ₪ בחודש למשפחה עם ארבעה תלמידים');
    D.grant = disc('מלגת הנהלה', 320, 'מלגה אישית לפי החלטת ההנהלה, כוללת את הנחת האחים');
    disc('הנחת מצוקה', 20, 'רק לפי החלטת ההנהלה, לתקופה מוגדרת, אחרי פנייה של המשפחה', 'percent', 'hardship');
    const DISC_OF = {}; const DNAME = {};
    for (const [id, fee] of Object.entries(TUITION)) {
      const n = KIDS.get(+id).length; const off = n * RATE - fee; if (!off) continue;
      const d = +id === 2 ? D.grant : D[n];
      DISC_OF[id] = off; DNAME[id] = db.prepare('SELECT name FROM discounts WHERE id=?').get(d).name;
      ins('household_discounts', { household_id: +id, discount_id: d, valid_from: '2026-09-01', valid_to: '2027-06-30', approval_ref: +id === 2 ? 'החלטת הנהלה 4/תשפ״ז' : 'החלטת הנהלה 2/תשפ״ז',
        reason: +id === 2 ? 'מלגה לפי בקשת המשפחה' : `הנחת אחים — ${n} תלמידים`, created_at: at('2026-08-28') });
    }

    // ---------------------------------------------------------------- charges
    const CH = []; // {id, hid, kind, period, amount, due, paid}
    const charge = (c) => {
      const row = { household_id: c.hid, run_id: c.run || null, kind: c.kind, description: c.description, amount: c.amount, gross_amount: c.gross ?? c.amount, discount_amount: c.discount || 0,
        discount_name: c.discount_name || null, lines_json: c.lines || [], due_date: c.due, period: c.period, status: 'open', paid_amount: 0, source: c.source || 'run',
        budget_line_code: c.budget, tariff_id: c.tariff, reason: c.reason || null, created_at: c.created, updated_at: c.created };
      const id = ins('charges', row);
      const o = { id, hid: c.hid, kind: c.kind, period: c.period, amount: c.amount, due: c.due, paid: 0 }; CH.push(o); return o;
    };
    const ch = (hid, period, kind = 'levy') => CH.find((c) => c.hid === hid && c.period === period && c.kind === kind);
    // Klein registered on 25.08 — registration fee at once
    charge({ hid: 9, kind: 'certificate', description: 'דמי רישום · שנת הלימודים תשפ״ז', amount: 300, due: '2026-08-25', period: '2026-08', source: 'manual', budget: '1350', tariff: T.reg,
      lines: [{ tariff_id: T.reg, name: 'דמי רישום — למשפחה', basis: 'per_household', qty: 1, rate: 300, gross: 300 }], reason: 'הרשמה של משפחה חדשה', created: at('2026-08-25', '10:15') });
    let prevTotal = null;
    for (const p of ['2026-09', '2026-10', '2026-11']) {
      const posted = at(`${p}-01`, '07:30');
      const runId = ins('billing_runs', { period: p, status: 'posted', due_date: DUE[p], posted_at: posted, prev_total: prevTotal, notes: p === '2026-09' ? 'חיוב ראשון של שנת הלימודים תשפ״ז, כולל דמי רישום' : null, created_at: posted, updated_at: posted });
      let gross = 0, discounts = 0, total = 0, n = 0;
      for (const [hid] of HH) {
        const kids = KIDS.get(hid);
        const g = kids.length * RATE; const off = DISC_OF[hid] || 0;
        charge({ hid, run: runId, kind: 'levy', period: p, due: DUE[p], amount: g - off, gross: g, discount: off, discount_name: DNAME[hid] || null, budget: '1100', tariff: T.tuition, created: posted,
          description: `שכר לימוד · ${plabel(p)} · ${kids.length === 1 ? 'תלמיד אחד' : `${kids.length} תלמידים`}`,
          lines: kids.map((k) => ({ tariff_id: T.tuition, name: `שכר לימוד — ${k.name} (${k.cls})`, basis: 'per_member', qty: 1, rate: RATE, gross: RATE })) });
        gross += g; discounts += off; total += g - off; n++;
        if (p === '2026-09' && hid !== 9) {
          charge({ hid, run: runId, kind: 'certificate', period: p, due: DUE[p], amount: 300, budget: '1350', tariff: T.reg, created: posted, description: 'דמי רישום · שנת הלימודים תשפ״ז',
            lines: [{ tariff_id: T.reg, name: 'דמי רישום — למשפחה', basis: 'per_household', qty: 1, rate: 300, gross: 300 }] });
          gross += 300; total += 300; n++;
        }
        if (BUS[hid]) {
          charge({ hid, run: runId, kind: 'water', period: p, due: DUE[p], amount: 100, budget: '1250', tariff: T.bus, created: posted, description: `הסעות · ${plabel(p)} · ${BUS[hid]}`,
            lines: [{ tariff_id: T.bus, name: `הסעות — ${BUS[hid]}`, basis: 'per_member', qty: 1, rate: 100, gross: 100 }] });
          gross += 100; total += 100; n++;
        }
      }
      db.prepare('UPDATE billing_runs SET households=?, charges_count=?, gross=?, discounts=?, total=? WHERE id=?').run(HH.size, n, gross, discounts, total, runId);
      prevTotal = total;
    }

    // ---------------------------------------------------------------- standing orders
    const SO = new Map();
    const soSpec = {
      1: { bank: '12', branch: '726', status: 'cancelled', reason: 'ההרשאה בוטלה בבנק על ידי בעל החשבון', end: '2026-11-25' },
      2: { bank: '20', branch: '462' }, 3: { bank: '31', branch: '066', max: 700, notes: 'תקרת ההרשאה 700 ₪ — דמי רישום נגבים בנפרד' },
      4: { bank: '12', branch: '776' }, 5: { bank: '54', branch: '012', notes: 'חודשה אחרי אישור הסדר התשלומים (28.10.2026)' },
      6: { bank: '10', branch: '902', status: 'cancelled', reason: 'ההרשאה פגה בסוף תשפ״ו ולא חודשה', end: '2026-08-31' },
      7: { bank: '20', branch: '470', max: 650, notes: 'תקרת ההרשאה 650 ₪ — שכר הלימוד בלבד' },
      9: { bank: '12', branch: '715', start: '2026-09-20', notes: 'הוראה חדשה — שכר ספטמבר שולם בהעברה' }, 10: { bank: '20', branch: '455' },
    };
    let acct = 100;
    for (const [id, s] of Object.entries(soSpec)) {
      const h = HH.get(+id); const start = s.start || h.entry_date;
      const o = { household_id: +id, bank: s.bank, branch: s.branch, account: String(310000 + (acct += 4373)), holder: payer(+id), holder_id: null, max_amount: s.max || null,
        status: s.status || 'active', status_reason: s.reason || null, start_date: start, end_date: s.end || null, bounce_count: 0, last_bounce_at: null, notes: s.notes || null,
        created_at: at(start), updated_at: at(start) };
      o.id = ins('standing_orders', o); SO.set(+id, o);
    }

    // ---------------------------------------------------------------- payments plan
    const BATCH = { '2026-09': '2026-09-10', '2026-10': '2026-10-11', '2026-11': '2026-11-10' };
    const R = []; // receipt specs
    const RET = { // returned standing-order lines: `${hid}:${period}` → {date, code}
      '1:2026-09': { date: '2026-09-15', code: 1 }, '5:2026-09': { date: '2026-09-15', code: 1 }, '5:2026-10': { date: '2026-10-14', code: 1 },
      '4:2026-11': { date: '2026-11-13', code: 1 }, '1:2026-11': { date: '2026-11-25', code: 4 },
    };
    const RET_TEXT = { 1: 'אין כיסוי מספיק בחשבון', 4: 'ההרשאה בוטלה על ידי בעל החשבון' };
    const LINES = {
      '2026-09': { 1: ['levy', 'certificate'], 2: ['levy', 'certificate'], 3: ['levy'], 4: ['levy', 'certificate', 'water'], 5: ['levy', 'certificate'], 7: ['levy'], 10: ['levy', 'certificate'] },
      '2026-10': { 1: ['levy'], 2: ['levy'], 3: ['levy'], 4: ['levy', 'water'], 5: ['levy'], 7: ['levy'], 9: ['levy'], 10: ['levy'] },
      '2026-11': { 1: ['levy'], 2: ['levy'], 3: ['levy'], 4: ['levy', 'water'], 5: ['levy'], 7: ['levy'], 9: ['levy'], 10: ['levy'] },
    };
    for (const [p, fams] of Object.entries(LINES)) for (const [hid, kinds] of Object.entries(fams)) {
      const parts = kinds.map((k) => ch(+hid, p, k)).map((c) => ({ c, amount: c.amount }));
      const ret = RET[`${hid}:${p}`];
      R.push({ hid: +hid, date: BATCH[p], method: 'standing_order', parts, batch: p, ret });
    }
    const one = (hid, date, method, parts, extra = {}) => R.push({ hid, date, method, parts, ...extra });
    one(9, '2026-08-25', 'credit', [{ c: ch(9, '2026-08', 'certificate'), amount: 300 }], { card: '9032', notes: 'דמי רישום ביום ההרשמה' });
    one(9, '2026-09-08', 'transfer', [{ c: ch(9, '2026-09'), amount: 1100 }], { notes: 'הוראת הקבע עוד לא הוקמה בבנק' });
    one(8, '2026-09-10', 'credit', [{ c: ch(8, '2026-09'), amount: 1450 }, { c: ch(8, '2026-09', 'certificate'), amount: 300 }], { card: '4417' });
    one(7, '2026-09-20', 'transfer', [{ c: ch(7, '2026-09', 'certificate'), amount: 300 }]);
    one(1, '2026-09-24', 'transfer', [{ c: ch(1, '2026-09'), amount: 1450 }], { notes: 'שולם בהעברה אחרי שהוראת הקבע חזרה' });
    one(3, '2026-10-05', 'check', [{ c: ch(3, '2026-09', 'certificate'), amount: 300 }], { check: '000214', notes: 'דמי רישום — שולם במזכירות' });
    one(8, '2026-10-11', 'credit', [{ c: ch(8, '2026-10'), amount: 1450 }], { card: '4417' });
    one(1, '2026-10-20', 'transfer', [{ c: ch(1, '2026-09', 'certificate'), amount: 300 }], { notes: 'דמי רישום — באיחור' });
    one(5, '2026-11-15', 'transfer', [{ c: ch(5, '2026-09'), amount: 1025 }], { notes: 'תשלום 1 מתוך 4 בהסדר התשלומים' });
    R.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hid - b.hid));

    // batches
    const B = {};
    for (const [p, cd] of Object.entries(BATCH)) {
      const open = p === '2026-11';
      B[p] = { id: ins('so_batches', { month: p, collect_date: cd, status: open ? 'collected' : 'closed', file_format: 'masav', exported_at: at(addDays(cd, -3), '11:00'), collected_at: at(cd, '12:00'),
        closed_at: open ? null : at(addDays(cd, 8), '12:00'), notes: open ? 'ממתינים לקובץ ההחזרות האחרון של החודש' : null, created_at: at(addDays(cd, -4), '09:00'), updated_at: at(cd, '12:00') }), n: 0, total: 0, rn: 0, rt: 0, cd };
    }
    // receipts, allocations, batch lines, returns
    let number = 1001; const RCPT = [];
    const RC = { 1: 'standing_order', credit: 'credit' };
    void RC;
    for (const e of R) {
      const amount = e.parts.reduce((s, x) => s + x.amount, 0);
      const b = e.batch ? B[e.batch] : null; const so = SO.get(e.hid);
      const ref = b ? `${b.id}-${String(b.n + 1).padStart(4, '0')}` : null;
      const voided = e.ret ? { at: at(e.ret.date, '10:00'), reason: `הוראת קבע חזרה: ${RET_TEXT[e.ret.code]}` } : null;
      const id = ins('receipts', { series: 'ק', number: number++, household_id: e.hid, amount, date: e.date, method: e.method,
        reference: b ? `גבייה ${plabel(e.batch)} · ${ref}` : e.method === 'transfer' ? `העברה ${String(48211 + number * 37).slice(-5)}` : null,
        check_no: e.check || null, check_bank: e.check ? '20' : null, check_branch: e.check ? '462' : null, check_due_date: e.check ? e.date : null,
        card_last4: e.card || null, card_approval: e.card ? String(700000 + number * 131).slice(-6) : null,
        payer_name: payer(e.hid), status: voided ? 'voided' : 'valid', void_reason: voided?.reason || null, voided_at: voided?.at || null,
        budget_line_code: '1100', unallocated: 0, source: b ? 'so_batch' : 'manual', so_batch_id: b ? b.id : null, sent_at: at(e.date, '10:30'), notes: e.notes || null,
        created_at: at(e.date, '10:00'), updated_at: voided ? voided.at : at(e.date, '10:00') });
      RCPT.push({ id, ...e, amount, voided });
      for (const x of e.parts) {
        ins('receipt_allocations', { receipt_id: id, charge_id: x.c.id, amount: x.amount, reversed_at: voided?.at || null, created_at: at(e.date, '10:00'), updated_at: voided ? voided.at : at(e.date, '10:00') });
        if (!voided) { x.c.paid += x.amount; if (x.c.paid >= x.c.amount) x.c.paidAt = e.date; }
      }
      if (b) {
        const lineId = ins('so_batch_lines', { batch_id: b.id, standing_order_id: so.id, household_id: e.hid, reference: ref, amount, charge_ids_json: e.parts.map((x) => x.c.id),
          status: e.ret ? 'returned' : 'collected', receipt_id: id, created_at: at(addDays(b.cd, -4), '09:00'), updated_at: e.ret ? at(e.ret.date, '10:00') : at(b.cd, '12:00') });
        b.n++; b.total += amount;
        if (e.ret) {
          b.rn++; b.rt += amount;
          const handled = { '1:2026-09': ['2026-09-24', 'המשפחה שילמה בהעברה בנקאית'], '5:2026-09': ['2026-10-28', 'נקבע הסדר תשלומים באישור הגזבר'], '5:2026-10': ['2026-10-28', 'נקבע הסדר תשלומים באישור הגזבר'] }[`${e.hid}:${e.batch}`];
          ins('so_returns', { batch_id: b.id, line_id: lineId, standing_order_id: so.id, household_id: e.hid, amount, reason_code: String(e.ret.code), reason_text: RET_TEXT[e.ret.code],
            return_date: e.ret.date, receipt_id: id, status: handled ? 'handled' : 'open', handled_at: handled ? at(handled[0], '12:00') : null, handled_note: handled ? handled[1] : null,
            created_at: at(e.ret.date, '10:00'), updated_at: handled ? at(handled[0], '12:00') : at(e.ret.date, '10:00') });
          so.bounce_count++; so.last_bounce_at = e.ret.date;
        }
      }
    }
    for (const b of Object.values(B)) db.prepare('UPDATE so_batches SET lines_count=?, total=?, returned_count=?, returned_total=? WHERE id=?').run(b.n, b.total, b.rn, b.rt, b.id);
    for (const s of SO.values()) db.prepare('UPDATE standing_orders SET bounce_count=?, last_bounce_at=? WHERE id=?').run(s.bounce_count, s.last_bounce_at, s.id);
    for (const c of CH) db.prepare('UPDATE charges SET paid_amount=?, status=?, paid_at=? WHERE id=?')
      .run(c.paid, c.paid >= c.amount ? 'paid' : c.paid > 0 ? 'partial' : 'open', c.paid >= c.amount ? c.paidAt : null, c.id);

    // ---------------------------------------------------------------- bank statement
    const imp = ins('bank_imports', { file_name: 'תנועות-חשבון-המוסד-נובמבר-2026.csv', account: '12-726-482117', lines_count: 0, skipped_count: 3, date_from: '2026-08-25', date_to: '2026-11-25', created_at: at('2026-11-25', '16:00'), updated_at: at('2026-11-25', '16:00') });
    let nl = 0;
    const bl = (row) => { nl++; return ins('bank_lines', { import_id: imp, fingerprint: `tt-${nl}`, matched_receipt_ids_json: [], created_at: at('2026-11-25', '16:00'), updated_at: at('2026-11-25', '16:00'), ...row }); };
    for (const [p, b] of Object.entries(B)) {
      const ids = RCPT.filter((r) => r.batch === p).map((r) => r.id);
      const id = bl({ date: b.cd, amount: b.total, description: `זיכוי מס״ב — גבייה בהוראות קבע ${plabel(p)}`, reference: `MSV${b.id}`, status: 'matched', so_batch_id: b.id, matched_receipt_ids_json: ids, matched_at: at(addDays(b.cd, 2), '11:00') });
      db.prepare('UPDATE receipts SET bank_line_id=? WHERE so_batch_id=?').run(id, b.id);
    }
    for (const r of RCPT.filter((x) => !x.batch)) {
      const d = r.method === 'credit' ? addDays(r.date, 2) : r.method === 'check' ? addDays(r.date, 1) : r.date;
      const desc = r.method === 'credit' ? 'זיכוי ישראכרט — עסקאות אשראי' : r.method === 'check' ? 'הפקדת שיק' : `העברה מאת ${payer(r.hid)}`;
      const id = bl({ date: d, amount: r.amount, description: desc, reference: String(900100 + r.id * 7), status: 'matched', matched_receipt_ids_json: [r.id], matched_at: at(addDays(d, 1), '11:00') });
      db.prepare('UPDATE receipts SET bank_line_id=? WHERE id=?').run(id, r.id);
    }
    bl({ date: '2026-11-23', amount: 500, description: 'העברה מאת י. גולדשטיין', reference: '771204', status: 'unmatched' });
    bl({ date: '2026-11-01', amount: 14, description: 'ריבית זכות', reference: 'INT', status: 'ignored', note: 'ריבית בנק — נרשמת בהכנסות אחרות' });
    db.prepare('UPDATE bank_imports SET lines_count=? WHERE id=?').run(nl, imp);

    // ---------------------------------------------------------------- card link for Berger (expired card)
    ins('card_links', { household_id: 8, amount: 1450, description: 'שכר לימוד נובמבר 2026 — תשלום בכרטיס חדש', token: 'tt8c41e9d27', provider: 'demo', url: '/#/pay/tt8c41e9d27', dry_run: 1,
      status: 'pending', expires_at: '2026-11-29', created_at: at('2026-11-15', '11:20'), updated_at: at('2026-11-15', '11:20') });

    // ---------------------------------------------------------------- arrangement (Shapira)
    const inst = [['2026-11-15', 1025], ['2026-12-15', 1025], ['2027-01-15', 1025], ['2027-02-15', 1025]];
    const arr = ins('arrangements', { household_id: 5, total: 4100, installments_json: inst.map(([d, a], i) => ({ n: i + 1, due_date: d, amount: a })), start: '2026-11-15', method: 'transfer', status: 'active',
      approved_at: at('2026-10-28', '12:10'), notes: 'מצב כלכלי קשה. ההסדר מכסה את החוב של ספטמבר–אוקטובר (שכר לימוד ודמי רישום); שכר הלימוד השוטף נגבה בהוראת קבע.',
      created_at: at('2026-10-26', '16:40'), updated_at: at('2026-11-15', '10:00') });
    inst.forEach(([d, a], i) => ins('arrangement_installments', { arrangement_id: arr, household_id: 5, n: i + 1, due_date: d, amount: a, paid_amount: i ? 0 : a, paid_at: i ? null : '2026-11-15',
      status: i ? 'scheduled' : 'paid', created_at: at('2026-10-28', '12:10'), updated_at: at(i ? '2026-10-28' : '2026-11-15', '12:10') }));

    // ---------------------------------------------------------------- reminder ladder & calls
    const ev = (hid, date, kind, o = {}) => ins('dunning_events', { household_id: hid, at: at(date, o.hm || '09:00'), kind, status: o.status || (['gentle', 'second', 'letter'].includes(kind) ? 'sent' : 'done'),
      channel: ['gentle', 'second'].includes(kind) ? 'whatsapp' : kind === 'letter' ? 'email' : null, amount: o.amount ?? null, days_overdue: o.days ?? null, note: o.note || null, auto: o.auto ?? 1, created_at: at(date, o.hm || '09:00'), updated_at: at(date, o.hm || '09:00') });
    const state = (hid, s) => ins('dunning_state', { household_id: hid, stage: s.stage || 'none', last_step_at: s.last || null, next_step_at: s.next || null, paused_reason: s.pause || null, paused_until: s.until || null,
      debt_at_step: s.debt ?? null, oldest_due: s.oldest || null, created_at: at('2026-09-13'), updated_at: at(s.updated || s.last || '2026-09-13') });
    const call = (hid, date, hm, by, outcome, summary, o = {}) => ins('collection_calls', { household_id: hid, by_name: by, at: at(date, hm), outcome, summary, promised_amount: o.amount ?? null, promised_date: o.date || null, follow_up_date: o.follow || null, created_at: at(date, hm), updated_at: at(date, hm) });
    const GZ = 'הגזבר ר׳ אהרן קרויס'; const MZ = 'המזכירה גב׳ רחל מנדלסון'; const HC = 'מנהלת החשבונות גב׳ טובה ליברמן';
    // לוי
    ev(1, '2026-09-18', 'gentle', { amount: 1750, days: 8 });
    call(1, '2026-09-22', '17:40', MZ, 'promised', 'האב הבטיח להעביר את שכר הלימוד של ספטמבר עד יום חמישי', { amount: 1450, date: '2026-09-24' });
    ev(1, '2026-09-27', 'second', { amount: 300, days: 17, note: 'נשארו דמי הרישום' });
    ev(1, '2026-10-20', 'reset', { amount: 0, note: 'החוב שולם — הסולם אופס' });
    ev(1, '2026-11-26', 'pause', { hm: '08:05', note: 'הוראת הקבע חזרה — הטיפול במסך «תשלומים שחזרו»' });
    state(1, { stage: 'none', last: '2026-10-20', pause: 'בטיפול במסלול «תשלומים שחזרו»', until: '2026-12-10', debt: 1450, oldest: DUE['2026-11'], updated: '2026-11-26' });
    // פרידמן
    ev(3, '2026-09-13', 'gentle', { amount: 300, days: 3, note: 'דמי רישום' });
    ev(3, '2026-09-24', 'second', { amount: 300, days: 14 });
    ev(3, '2026-10-05', 'reset', { amount: 0, note: 'שולם בשיק במזכירות' });
    state(3, { stage: 'none', last: '2026-10-05' });
    // וייס
    ev(4, '2026-11-13', 'pause', { hm: '10:05', note: 'הוראת הקבע חזרה — הטיפול במסך «תשלומים שחזרו»' });
    state(4, { stage: 'none', last: '2026-11-13', pause: 'בטיפול במסלול «תשלומים שחזרו»', until: '2026-12-10', debt: 1200, oldest: DUE['2026-11'] });
    // שפירא
    ev(5, '2026-09-18', 'gentle', { amount: 2200, days: 8 });
    ev(5, '2026-10-02', 'second', { amount: 2200, days: 22 });
    call(5, '2026-10-26', '19:10', GZ, 'arrangement', 'שוחחנו עם האב. מצב כלכלי קשה, ביקש לפרוס את החוב. סוכם הסדר של 4 תשלומים מ-15.11, ושכר הלימוד השוטף ימשיך בהוראת קבע.');
    ev(5, '2026-10-28', 'arrangement', { hm: '12:10', amount: 4100, auto: 0, note: 'הסדר אושר: 4,100 ₪ ב-4 תשלומים של 1,025 ₪' });
    state(5, { stage: 'second', last: '2026-10-02', debt: 4100, oldest: DUE['2026-09'], updated: '2026-10-28' });
    // גולדברג
    ev(6, '2026-09-13', 'gentle', { amount: 1400, days: 3 });
    ev(6, '2026-09-24', 'second', { amount: 1400, days: 14 });
    ev(6, '2026-10-12', 'letter', { amount: 2500, days: 32, note: 'מכתב רשמי נשלח אחרי אישור המזכירה' });
    ev(6, '2026-11-12', 'personal', { amount: 3600, days: 63, note: 'משימת שיחה אישית לגזבר' });
    call(6, '2026-11-13', '18:30', GZ, 'no_answer', 'אין מענה בנייד של האב. הושארה הודעה קולית.');
    call(6, '2026-11-20', '12:15', GZ, 'no_answer', 'גם האם לא ענתה. לנסות שוב בתחילת השבוע.', { follow: '2026-11-29' });
    state(6, { stage: 'personal', last: '2026-11-12', next: '2026-11-29', debt: 3600, oldest: DUE['2026-09'], updated: '2026-11-20' });
    // רוזנטל
    ev(7, '2026-09-13', 'gentle', { amount: 400, days: 3 });
    call(7, '2026-10-19', '11:00', HC, 'dispute', 'האב טוען שצבי לא נוסע בהסעה מתחילת השנה ושהחיוב על ההסעות שגוי. בודקים מול רשימת ההסעות ונותנים תשובה עד 30.11.', { follow: '2026-11-30' });
    ev(7, '2026-10-19', 'pause', { hm: '11:20', auto: 0, note: 'המשפחה חולקת על חיוב ההסעות' });
    state(7, { stage: 'gentle', last: '2026-09-13', pause: 'חולק על חיוב ההסעות — בבירור אצל מנהלת החשבונות', debt: 300, oldest: DUE['2026-09'], updated: '2026-10-19' });
    // ברגר
    ev(8, '2026-11-15', 'pause', { hm: '11:25', auto: 0, note: 'הכרטיס פג תוקף — נשלח קישור לתשלום בכרטיס חדש' });
    call(8, '2026-11-15', '11:10', MZ, 'promised', 'האב אמר שהכרטיס הוחלף בבנק ויעביר את הפרטים החדשים עד סוף החודש.', { amount: 1450, date: '2026-11-30' });
    state(8, { stage: 'none', last: '2026-11-15', pause: 'ממתינים לפרטי כרטיס אשראי חדש', until: '2026-11-30', debt: 1450, oldest: DUE['2026-11'] });
    for (const [p, v] of [['2026', 95], ['2027', 96]]) ins('collection_targets', { period: p, target_pct: v });

    // ---------------------------------------------------------------- returned-payment cases (taktzivit 28)
    const tr = (c, events) => {
      const id = ins('tak_returned', { fee: 0, source: 'sync', method: 'standing_order', status: 'open', ...c, created_at: events[0][2], updated_at: events[events.length - 1][2] });
      for (const [kind, channel, ts, note, by] of events) ins('tak_returned_events', { case_id: id, at: ts, kind, channel, note: note || null, auto: by ? 0 : 1, by_name: by || 'המערכת', created_at: ts, updated_at: ts });
      return id;
    };
    tr({ household_id: 1, ext_id: 'RT-5101', amount: 1750, fee: 10, reason: RET_TEXT[1], charge_date: '2026-09-10', returned_at: '2026-09-15', stage: 'wa2', last_step_at: '2026-09-18', status: 'closed', closed_at: at('2026-09-24', '12:00'), close_reason: 'settled', sources: 'sync,bank' }, [
      ['detected', null, at('2026-09-15', '08:05'), 'בבדיקה התקופתית במערכת החשבונות'], ['wa1', 'whatsapp', at('2026-09-15', '09:30')], ['wa2', 'whatsapp', at('2026-09-18', '09:30')],
      ['email', 'email', at('2026-09-18', '09:31')], ['settled', null, at('2026-09-24', '12:00'), 'נכנסה העברה בנקאית של 1,450 ₪']]);
    tr({ household_id: 5, ext_id: 'RT-5102', amount: 2200, fee: 10, reason: RET_TEXT[1], charge_date: '2026-09-10', returned_at: '2026-09-15', stage: 'secretary', last_step_at: '2026-09-23', status: 'closed', closed_at: at('2026-10-28', '12:15'), close_reason: 'manual', sources: 'sync,bank' }, [
      ['detected', null, at('2026-09-15', '08:05'), 'בבדיקה התקופתית במערכת החשבונות'], ['wa1', 'whatsapp', at('2026-09-15', '09:30')], ['wa2', 'whatsapp', at('2026-09-18', '09:30')],
      ['call', 'voice', at('2026-09-21', '10:00')], ['task', 'task', at('2026-09-23', '09:30'), 'הועבר למזכירות'], ['closed', null, at('2026-10-28', '12:15'), 'נקבע הסדר תשלומים — 4 תשלומים מ-15.11', MZ]]);
    tr({ household_id: 5, ext_id: 'RT-5103', amount: 1900, fee: 10, reason: RET_TEXT[1], charge_date: '2026-10-11', returned_at: '2026-10-14', stage: 'wa1', last_step_at: '2026-10-14', status: 'closed', closed_at: at('2026-10-28', '12:16'), close_reason: 'manual', sources: 'sync,bank' }, [
      ['detected', null, at('2026-10-14', '08:05'), 'בבדיקה התקופתית במערכת החשבונות'], ['wa1', 'whatsapp', at('2026-10-14', '09:30')],
      ['paused', null, at('2026-10-15', '11:00'), 'בתהליך הסדר תשלומים מול הגזבר', MZ], ['closed', null, at('2026-10-28', '12:16'), 'נכלל בהסדר התשלומים', MZ]]);
    tr({ household_id: 4, ext_id: 'RT-5106', amount: 1200, fee: 10, reason: RET_TEXT[1], charge_date: '2026-11-10', returned_at: '2026-11-13', stage: 'secretary', last_step_at: '2026-11-21', sources: 'sync,bank',
      notes: 'לתאם עם ההורים מועד לחיוב חוזר' }, [
      ['detected', null, at('2026-11-13', '08:05'), 'בבדיקה התקופתית במערכת החשבונות'], ['wa1', 'whatsapp', at('2026-11-13', '09:30')], ['wa2', 'whatsapp', at('2026-11-16', '09:30')],
      ['email', 'email', at('2026-11-16', '09:31')], ['call', 'voice', at('2026-11-19', '10:00')], ['task', 'task', at('2026-11-22', '09:30'), 'שתי הודעות, מייל ושיחה — בלי הסדרה. הועבר למזכירות']]);
    tr({ household_id: 8, ext_id: 'RT-5107', method: 'credit', amount: 1450, fee: 0, reason: 'כרטיס האשראי פג תוקף', charge_date: '2026-11-10', returned_at: '2026-11-10', stage: 'wa2', last_step_at: '2026-11-13',
      paused_until: '2026-11-30', paused_reason: 'האב ביקש עד סוף החודש למסור פרטי כרטיס חדש', sources: 'sync' }, [
      ['detected', null, at('2026-11-10', '12:05'), 'בבדיקה התקופתית במערכת החשבונות'], ['wa1', 'whatsapp', at('2026-11-10', '12:06')], ['wa2', 'whatsapp', at('2026-11-13', '09:30')],
      ['email', 'email', at('2026-11-13', '09:31')], ['paused', null, at('2026-11-15', '11:25'), 'נשלח קישור לתשלום בכרטיס חדש; ממתינים עד 30.11', MZ]]);
    // Levi's November return: same ext_id the demo provider uses for this family, so later demo syncs do not open it twice
    const base = A.baseReturned(db, TODAY);
    const leviExt = base.find((x) => x.ext_id === 'RT-5004' && x.household_id === 1) ? 'RT-5004' : 'RT-5108';
    tr({ household_id: 1, ext_id: leviExt, amount: 1450, fee: 10, reason: RET_TEXT[4], charge_date: '2026-11-10', returned_at: '2026-11-25', stage: 'wa1', last_step_at: '2026-11-26', sources: 'sync,bank',
      notes: 'ההרשאה בוטלה — צריך הרשאה חדשה מהאב' }, [
      ['detected', null, at('2026-11-26', '08:00'), 'בבדיקה התקופתית במערכת החשבונות'], ['wa1', 'whatsapp', at('2026-11-26', '08:01')]]);

    // ---------------------------------------------------------------- sync history (8 runs, one failed night) through the real engine
    const C = { nowISO: () => new Date().toISOString(), todayISO: () => TODAY };
    const eng = createEngine({ db, C });
    const fx = A.fixtures({ db, generation: 0, today: TODAY });
    const custNo = A.custNo;
    const STORY_RET = [
      { ext_id: 'RT-5101', hid: 1, method: 'standing_order', amount: 1750, fee: 10, reason: RET_TEXT[1], charge_date: '2026-09-10', returned_date: '2026-09-15', status: 'settled', settled_date: '2026-09-24' },
      { ext_id: 'RT-5102', hid: 5, method: 'standing_order', amount: 2200, fee: 10, reason: RET_TEXT[1], charge_date: '2026-09-10', returned_date: '2026-09-15', status: 'open' },
      { ext_id: 'RT-5103', hid: 5, method: 'standing_order', amount: 1900, fee: 10, reason: RET_TEXT[1], charge_date: '2026-10-11', returned_date: '2026-10-14', status: 'open' },
      { ext_id: 'RT-5106', hid: 4, method: 'standing_order', amount: 1200, fee: 10, reason: RET_TEXT[1], charge_date: '2026-11-10', returned_date: '2026-11-13', status: 'open' },
      { ext_id: 'RT-5107', hid: 8, method: 'credit', amount: 1450, fee: 0, reason: 'כרטיס האשראי פג תוקף', charge_date: '2026-11-10', returned_date: '2026-11-10', status: 'open' },
      { ext_id: leviExt, hid: 1, method: 'standing_order', amount: 1450, fee: 10, reason: RET_TEXT[4], charge_date: '2026-11-10', returned_date: '2026-11-25', status: 'open', levi: true },
    ];
    // the other returns the demo provider would report are recorded as already settled → no phantom cases on the next demo sync
    const placeholders = base.filter((x) => x.ext_id !== leviExt && !STORY_RET.some((s) => s.ext_id === x.ext_id))
      .map((x) => ({ ext_id: x.ext_id, customer_no: x.customer_no, method: x.method, amount: x.amount, fee: x.fee, reason: x.reason, charge_date: '2026-08-31', returned_date: '2026-09-02', status: 'settled', settled_date: '2026-09-04' }));
    const PM = { standing_order: 'standing_order', credit: 'credit_card', check: 'check', transfer: 'bank_transfer', cash: 'cash' };
    const story = (withLevi, runDay) => ({
      key: 'fixtures', label: 'נתוני הדגמה', generation: null,
      listResidents: fx.listResidents,
      listCharges: async () => db.prepare("SELECT id, household_id, kind, description, amount FROM charges WHERE deleted_at IS NULL AND period='2026-11' AND kind IN ('levy','water','other') AND status<>'cancelled' ORDER BY household_id, id").all()
        .map((c) => ({ charge_id: `CH-${c.id}`, customer_no: custNo(c.household_id), period: '2026-11', kind: c.kind, description: c.description, amount: c.amount })),
      listBalances: async () => [...HH.keys()].map((hid) => {
        const r = db.prepare("SELECT COALESCE(SUM(amount-paid_amount),0) b, COALESCE(SUM(CASE WHEN due_date<? THEN amount-paid_amount ELSE 0 END),0) o FROM charges WHERE household_id=? AND status<>'cancelled' AND deleted_at IS NULL").get(TODAY, hid);
        const adj = !withLevi && hid === 1 ? 1450 : 0;
        return { customer_no: custNo(hid), balance: r.b - adj, overdue: r.o - adj };
      }),
      listPayments: async () => db.prepare("SELECT id, household_id, amount, date, method, reference FROM receipts WHERE deleted_at IS NULL AND IFNULL(status,'')<>'void' AND date>=? AND date<=? ORDER BY date DESC, id DESC").all(addDays(TODAY, -45), runDay)
        .map((r) => ({ payment_id: `PY-R${r.id}`, customer_no: custNo(r.household_id), date: r.date, amount: r.amount, method: PM[r.method] || r.method, reference: r.reference || null })),
      listReturned: async () => [...placeholders, ...STORY_RET.filter((s) => withLevi || !s.levi).map(({ hid, levi, ...s }) => ({ ...s, customer_no: custNo(hid), settled_date: s.settled_date || null }))],
      listInvoices: fx.listInvoices, listSuppliers: fx.listSuppliers, listPaymentsDue: fx.listPaymentsDue, listPendingInvoices: fx.listPendingInvoices,
    });
    const fail = { key: 'fixtures', label: 'נתוני הדגמה', generation: null };
    for (const m of Object.keys(A.METHOD)) fail[m] = async () => { const e = new Error('תם הזמן לתשובה משער CoreHub'); e.code = 'timeout'; throw e; };
    const SLOTS = [['2026-11-25', '18:00'], ['2026-11-26', '02:30'], ['2026-11-26', '08:00'], ['2026-11-26', '10:00'], ['2026-11-26', '12:00'], ['2026-11-26', '14:00'], ['2026-11-26', '16:00'], ['2026-11-26', '18:00']];
    for (const [d, t] of SLOTS) {
      const night = t === '02:30';
      await eng.sync({ provider: night ? fail : story(d === '2026-11-26', d), trigger: night ? 'night' : 'schedule', slot: `${d}@${t}`, at: at(d, t) });
    }

    // ---------------------------------------------------------------- cash accounts (renamed for the institution)
    const cash = db.prepare('SELECT id, kind FROM cash_accounts ORDER BY id').all();
    for (const c of cash) {
      const v = c.kind === 'bank' ? ['חשבון עו״ש התלמוד תורה', 'בנק הפועלים', '726', '482117', 84300, 96450, null, 1]
        : c.kind === 'cash' ? ['קופה קטנה במזכירות', null, null, null, 1500, 1320, null, 1]
          : ['פיקדון קרן המלגות', 'בנק הפועלים', '726', '482117-05', 120000, 121350, 'לא נכלל בתזרים השוטף — משיכה רק בהחלטת ההנהלה', 0];
      db.prepare('UPDATE cash_accounts SET name=?, bank_name=?, branch=?, account_no=?, opening_balance=?, opening_date=?, balance=?, balance_date=?, notes=?, in_forecast=?, updated_at=? WHERE id=?')
        .run(v[0], v[1], v[2], v[3], v[4], '2026-09-01', v[5], '2026-11-25', v[6], v[7], NOW, c.id);
    }

    // ---------------------------------------------------------------- QA corrections (month names, Shapira timeline, ladder, fees …)
    require('./02b_finance_fix').apply(db);

    // ---------------------------------------------------------------- checks
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) throw new Error('foreign_key_check: ' + JSON.stringify(bad.slice(0, 5)));
    const bal = db.prepare(`SELECT h.id, h.family_name f, SUM(c.amount) charged,
      (SELECT COALESCE(SUM(a.amount),0) FROM receipt_allocations a JOIN charges x ON x.id=a.charge_id WHERE x.household_id=h.id AND a.reversed_at IS NULL) alloc,
      SUM(c.amount-c.paid_amount) open FROM households h JOIN charges c ON c.household_id=h.id AND c.status<>'cancelled' GROUP BY h.id ORDER BY h.id`).all();
    for (const b of bal) if (b.charged - b.alloc !== b.open) throw new Error(`balance mismatch ${b.f}: ${b.charged}-${b.alloc}≠${b.open}`);
    db.exec('COMMIT');
    const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    console.log(JSON.stringify({ balances: Object.fromEntries(bal.map((b) => [b.f, ils(b.open)])), counts: Object.fromEntries(OWN.map((t) => [t, n(t)])) }, null, 1));
  } catch (e) { try { db.exec('ROLLBACK'); } catch { /* none */ } throw e; }
}
main().catch((e) => { console.error(e); process.exit(1); });
