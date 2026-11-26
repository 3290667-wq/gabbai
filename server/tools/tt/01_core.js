// tt/01_core.js — «גבאי»: replaces every household (and everything keyed by household_id) with the ten canonical families
// of תלמוד תורה «אור התורה». Re-runnable. Usage: node server/tools/tt/01_core.js [path/to/demo.db]
'use strict';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const DB = process.argv[2] || path.join(__dirname, '../../../data/demo.db');
const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout=10000');
db.exec('PRAGMA foreign_keys=OFF'); // must be set outside the transaction

const TEACHER = { 'גן': 'הגננת מרים', 'כיתה א׳': 'הרב נחום קליין', 'כיתה ב׳': 'הרב יחיאל שטרן', 'כיתה ג׳': 'הרב שלמה גרוס', 'כיתה ד׳': 'הרב שלמה גרוס',
  'כיתה ה׳': 'הרב משה פרלשטיין', 'כיתה ו׳': 'הרב אהרן ליבוביץ', 'כיתה ז׳': 'הרב אליעזר בלוי', 'כיתה ח׳': 'הרב יהושע ברנר' };
// birth year for the class in school year תשפ״ז (Sep 2026 – Jun 2027)
const BYEAR = { 'גן': 2021, 'כיתה א׳': 2020, 'כיתה ב׳': 2019, 'כיתה ג׳': 2018, 'כיתה ד׳': 2017, 'כיתה ה׳': 2016, 'כיתה ו׳': 2015, 'כיתה ז׳': 2014, 'כיתה ח׳': 2013 };

const F = [
  { n: 'לוי', lat: 'levi', f: 'יעקב', m: 'רחל', ph: '050-0000001', ph2: '052-0000201', fee: 1450, pm: 'standing_order', entry: '2019-08-20', fb: '1984-03-12', mb: '1987-06-02',
    kids: [['מנחם', 'כיתה ג׳', '04-15'], ['שמואל', 'כיתה ה׳', '01-28'], ['יוסף', 'גן', '09-07']],
    notes: 'הוראת קבע של כסלו חזרה ב-25.11.2026 «ההרשאה בוטלה». משלם באיחור — 2 איחורים ו-2 החזרות השנה. לחדש הרשאה מול האב.' },
  { n: 'כהן', lat: 'cohen', f: 'אברהם', m: 'שרה', ph: '050-7333117', ph2: '054-0000202', fee: 980, pm: 'standing_order', entry: '2018-08-28', fb: '1982-11-05', mb: '1985-02-19',
    kids: [['אהרן', 'כיתה ב׳', '07-11'], ['דוד', 'כיתה ז׳', '12-03']],
    notes: 'משלם למופת — כל התשלומים בזמן.' },
  { n: 'פרידמן', lat: 'friedman', f: 'חיים', m: 'מרים', ph: '053-2208749', ph2: '052-0000203', fee: 650, pm: 'standing_order', entry: '2021-08-17', fb: '1995-05-21', mb: '1997-09-14',
    kids: [['ישראל', 'כיתה א׳', '02-09']],
    notes: 'משלם בזמן. היה חוב קטן אחד שהוסדר.' },
  { n: 'וייס', lat: 'weiss', f: 'מרדכי', m: 'לאה', ph: '054-6620527', ph2: '058-0000204', fee: 1200, pm: 'standing_order', entry: '2023-08-24', fb: '1989-01-30', mb: '1991-04-08',
    kids: [['נחמן', 'כיתה ד׳', '10-22'], ['אליהו', 'כיתה א׳', '05-16']],
    notes: 'הוראת קבע חזרה «אין כיסוי». לתאם מועד חיוב חוזר עם ההורים.' },
  { n: 'שפירא', lat: 'shapira', f: 'שלמה', m: 'דבורה', ph: '050-0000105', ph2: '053-0000205', fee: 1900, pm: 'standing_order', entry: '2019-08-15', fb: '1980-07-17', mb: '1983-12-25',
    kids: [['נפתלי', 'כיתה ח׳', '03-04'], ['אברהם', 'כיתה ו׳', '08-19'], ['יצחק', 'כיתה ג׳', '11-27'], ['בנימין', 'גן', '06-13']],
    notes: 'מצב כלכלי קשה. הסדר פריסה פעיל ל-4 תשלומים — לעקוב אחרי עמידה בתשלומים.' },
  { n: 'גולדברג', lat: 'goldberg', f: 'יהודה', m: 'חנה', ph: '052-0000106', ph2: '050-0000206', fee: 1100, pm: 'standing_order', entry: '2021-08-26', fb: '1986-09-09', mb: '1988-10-31',
    kids: [['משה', 'כיתה ה׳', '02-22'], ['אריה', 'כיתה ב׳', '09-30']],
    notes: 'לא מגיבים — 3 חודשים פתוחים ו-4 תזכורות בלי מענה. לנסות שיחה טלפונית עם האם.' },
  { n: 'רוזנטל', lat: 'rosenthal', f: 'אליעזר', m: 'רבקה', ph: '054-0000107', ph2: '052-0000207', fee: 650, pm: 'standing_order', entry: '2019-08-29', fb: '1983-04-03', mb: '1986-08-26',
    kids: [['צבי', 'כיתה ח׳', '06-01']],
    notes: 'חולקים על החיוב — טוענים שהחיוב על הסעות שגוי. ממתין לבירור של מנהלת החשבונות.' },
  { n: 'ברגר', lat: 'berger', f: 'נתן', m: 'שושנה', ph: '053-0000108', ph2: '054-0000208', fee: 1450, pm: 'credit', entry: '2022-08-22', fb: '1987-12-14', mb: '1990-03-27',
    kids: [['יעקב', 'כיתה ד׳', '01-10'], ['מאיר', 'כיתה א׳', '08-05'], ['שמעון', 'גן', '04-24']],
    notes: 'תקלה טכנית: כרטיס האשראי פג תוקף — לבקש פרטי כרטיס חדש.' },
  { n: 'קליין', lat: 'klein', f: 'דניאל', m: 'אסתר', ph: '058-0000109', ph2: '053-0000209', fee: 1100, pm: 'standing_order', entry: '2026-08-25', fb: '1985-06-18', mb: '1988-01-07',
    kids: [['חיים', 'כיתה ו׳', '05-02'], ['זאב', 'כיתה ג׳', '12-18']],
    notes: 'הורים חדשים — הצטרפו באלול תשפ״ז.' },
  { n: 'אדלר', lat: 'adler', f: 'ברוך', m: 'פנינה', ph: '050-0000110', ph2: '058-0000210', fee: 1450, pm: 'standing_order', entry: '2018-08-21', fb: '1981-02-11', mb: '1984-05-29',
    kids: [['אלחנן', 'כיתה ז׳', '07-25'], ['שלום', 'כיתה ה׳', '10-12'], ['ישעיהו', 'כיתה ב׳', '03-17']],
    notes: 'משלם למופת — כל התשלומים בזמן.' },
];

const q = (s) => `"${s.replace(/"/g, '""')}"`;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
const cols = (t) => db.prepare(`PRAGMA table_info(${q(t)})`).all();
const report = { deleted: {}, fk_fixed: {} };

db.exec('BEGIN');
try {
  // 1. everything keyed by household_id (children tables of households/residents)
  for (const t of tables) {
    if (t === 'households' || t === 'residents') continue;
    if (!cols(t).some((c) => c.name === 'household_id')) continue;
    report.deleted[t] = Number(db.prepare(`DELETE FROM ${q(t)}`).run().changes);
  }
  // other references to households/residents under a different column name → NULL
  for (const t of tables) for (const fk of db.prepare(`PRAGMA foreign_key_list(${q(t)})`).all()) {
    if (!['households', 'residents'].includes(fk.table) || fk.from === 'household_id') continue;
    const n = Number(db.prepare(`UPDATE ${q(t)} SET ${q(fk.from)}=NULL WHERE ${q(fk.from)} IS NOT NULL`).run().changes);
    if (n) report.fk_fixed[`${t}.${fk.from}`] = n;
  }
  report.deleted.residents = Number(db.prepare('DELETE FROM residents').run().changes);
  report.deleted.households = Number(db.prepare('DELETE FROM households').run().changes);

  // 2. the ten families
  const now = new Date().toISOString();
  const insH = db.prepare(`INSERT INTO households (id, code, family_name, head_name, property_id, status, members_count, phone, phone2, email, kosher_phone, channel,
    consent_messages, entry_date, payment_method, notes, tags_json, created_at, updated_at) VALUES (?,?,?,?,NULL,'resident',?,?,?,?,0,'whatsapp',1,?,?,?,?,?,?)`);
  const insR = db.prepare(`INSERT INTO residents (id, household_id, first_name, last_name, id_number, birth_date, gender, role, phone, email, notes, created_at, updated_at)
    VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,?)`);
  let rid = 0;
  F.forEach((x, i) => {
    const id = i + 1; const created = `${x.entry}T09:00:00.000Z`;
    insH.run(id, `fam-${String(id).padStart(2, '0')}`, x.n, `${x.f} ו${x.m}`, 2 + x.kids.length, x.ph, x.ph2, `${x.lat}@example.com`,
      x.entry, x.pm, x.notes, JSON.stringify(['תלמוד תורה']), created, now);
    insR.run(++rid, id, x.f, x.fb, 'm', 'head', x.ph, `${x.lat}@example.com`, null, created, now);
    insR.run(++rid, id, x.m, x.mb, 'f', 'spouse', x.ph2, null, null, created, now);
    for (const [name, cls, md] of x.kids) insR.run(++rid, id, name, `${BYEAR[cls]}-${md}`, 'm', 'child', null, null, `${cls} · ${TEACHER[cls]}`, created, now);
  });

  // 3. any leftover FK breakage (rows that pointed at deleted rows): nullable column → NULL, otherwise delete the row
  for (let pass = 0; pass < 10; pass++) {
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (!bad.length) break;
    for (const b of bad) {
      const fk = db.prepare(`PRAGMA foreign_key_list(${q(b.table)})`).all().filter((f) => f.id === b.fkid);
      const c = cols(b.table); const col = fk[0]?.from; const notnull = c.find((x) => x.name === col)?.notnull;
      const key = `${b.table}.${col}`;
      if (col && !notnull) db.prepare(`UPDATE ${q(b.table)} SET ${q(col)}=NULL WHERE rowid=?`).run(b.rowid);
      else db.prepare(`DELETE FROM ${q(b.table)} WHERE rowid=?`).run(b.rowid);
      report.fk_fixed[key] = (report.fk_fixed[key] || 0) + 1;
    }
  }
  const left = db.prepare('PRAGMA foreign_key_check').all();
  if (left.length) throw new Error('foreign_key_check still fails: ' + JSON.stringify(left.slice(0, 5)));
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
db.exec('PRAGMA foreign_keys=ON');

const one = (s) => db.prepare(s).get().n;
report.counts = { households: one('SELECT COUNT(*) n FROM households'), parents: one("SELECT COUNT(*) n FROM residents WHERE role IN ('head','spouse')"),
  children: one("SELECT COUNT(*) n FROM residents WHERE role='child'"), fk_check: db.prepare('PRAGMA foreign_key_check').all().length };
console.log(JSON.stringify(report, null, 1));
