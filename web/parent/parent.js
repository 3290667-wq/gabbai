// «האזור של ההורים» — דף ההורה של «גבאי». כניסה בטלפון + קוד הורה (דמו), הנתונים מהשרת (/api/public/parent/*).
// כל הורה רואה רק את המשפחה שלו: התשלומים, מצב החשבון, קרן הפינוקים, וכרטיס לכל ילד.
const API = new URL('../api/public/parent/', location.href).href;
const ICO = new URL('../assets/icons/', import.meta.url).href;
const I = (n, cls = 'gi') => `<img class="${cls}" src="${ICO}${n}.webp?v=2" alt="" draggable="false" decoding="async">`;
const LOCK = `<svg class="gi-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
const METHOD = { debit: [I('bank'), 'הוראת קבע'], card: [I('card'), 'אשראי'], link: [I('link'), 'קישור תשלום'] };
const STATUS = { ok: ['ok', 'שולם ✓'], fix: ['fix', 'חזר והוסדר'], wait: ['wait', 'ממתין לחיוב'] };
const ils = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const N = (s) => `<span class="num">${s}</span>`;
const root = document.getElementById('pa');
const crest = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 7c4-1 7 0 10 2 3-2 6-3 10-2v17c-4-1-7 0-10 2-3-2-6-3-10-2z" fill="none" stroke="#1d1405" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 9v17" stroke="#1d1405" stroke-width="2.2"/></svg>`;
const INST = 'תלמוד תורה «אור התורה»';
const DONE = [{ t: 'מסיבת חנוכה עם סופגניות', s: 'לכל הכיתות · כסלו', i: I('donut') }, { t: 'ספרים חדשים לספריית הכיתה', s: '120 ספרי קריאה · חשון', i: I('books') }];
const FUTURE = [{ t: 'מזגן חדש לכיתה ג׳', s: 'יעד ₪9,500', i: I('snow') }, { t: 'ערב הוקרה למתמידים', s: 'יעד ₪6,000', i: I('trophy') }, { t: 'ציוד ספורט לחצר', s: 'יעד ₪7,200', i: I('ball') }];
let D = null;

async function call(p, body) {
  const res = await fetch(API + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'שגיאה');
  return j;
}

// ---------- login
function loginView(demo) {
  root.innerHTML = `
  <header class="pa-top"><div class="pa-crest">${crest}</div><div class="pa-inst"><b>${INST}</b><span>האזור של ההורים</span></div></header>
  <section class="pa-hello pa-login">
    <h1>כניסת הורים ${I('wave', 'gi gi--h1')}</h1>
    <p>הכניסו את מספר הטלפון שרשום במוסד ואת קוד ההורה שקיבלתם מהמזכירות.</p>
    <form id="lf" class="pa-lform" novalidate>
      <label class="pa-field">טלפון<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="050-0000000" required></label>
      <label class="pa-field">קוד הורה<input name="code" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="4 ספרות" required></label>
      <p class="pa-err" id="lerr" role="alert" hidden></p>
      <button class="btn btn-gold" type="submit">כניסה לאזור ההורים</button>
    </form>
    <p class="pa-share" style="margin-top:14px">הורה חדש? <a class="pa-joinlink" href="../join/">הרשמה והצטרפות לקבוצת ההורים בוואטסאפ ←</a></p>
  </section>
  <section class="pa-card pa-demo">
    <h2>חשבונות להדגמה</h2>
    <p class="hint">לחיצה ממלאת את הפרטים</p>
    <ul>${demo.map((d) => `<li><button type="button" class="pa-demo__b" data-p="${esc(d.phone)}" data-c="${esc(d.code)}"><b>משפחת ${esc(d.family)}</b><span>${N(esc(d.phone))} · קוד ${N(esc(d.code))}</span></button></li>`).join('')}</ul>
  </section>
  <footer class="pa-foot">${INST} · מופעל ע״י «גבאי» · דף הדגמה</footer>`;
  const f = document.getElementById('lf');
  root.querySelectorAll('.pa-demo__b').forEach((b) => b.addEventListener('click', () => { f.phone.value = b.dataset.p; f.code.value = b.dataset.c; f.querySelector('button').focus(); }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('lerr'); err.hidden = true;
    const btn = f.querySelector('button'); btn.disabled = true;
    try { const j = await call('login', { phone: f.phone.value, code: f.code.value }); D = j.data; render(); window.scrollTo(0, 0); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { btn.disabled = false; }
  });
}

// ---------- the family page
function render() {
  const fund = D.fund;
  const pct = Math.min(100, Math.round(fund.got / fund.goal * 100));
  const missing = fund.goal - fund.got;
  const debt = D.debt;
  root.innerHTML = `
  <header class="pa-top">
    <div class="pa-crest">${crest}</div>
    <div class="pa-inst"><b>${esc(D.inst)}</b><span>האזור של ההורים · שנת הלימודים תשפ״ז</span></div>
    <button class="pa-out" type="button" id="out">יציאה</button>
  </header>
  ${debt ? `<section class="pa-alert" role="status">
      <span class="pa-alert__ic" aria-hidden="true">${I('card')}</span>
      <div><b>נשאר להסדיר ${N(ils(debt.amount))}</b><small>הוראת הקבע לחודש ${esc(debt.month)} לא עברה (${esc(debt.reason)})${D.plan ? ` · סוכם הסדר: ${N(D.plan.n)} תשלומים של ${N(ils(D.plan.each))}` : ''}</small></div>
      ${D.pay_url ? `<a class="btn btn-gold" href="${esc(D.pay_url)}">לתשלום מאובטח</a>` : `<button class="btn btn-gold" type="button" data-sheet="settle">להסדרה</button>`}
    </section>` : ''}
  <section class="pa-hello">
    <h1>שלום משפחת ${esc(D.family)} ${I('wave', 'gi gi--h1')}</h1>
    <p>תודה שאתם שותפים בחינוך הילדים. לחצו על ילד כדי לראות את הכרטיס שלו.</p>
    <ul class="pa-kids" aria-label="הילדים במוסד">
      ${D.kids.map((k, i) => `<li><button type="button" class="pa-kid" data-kid="${i}"><i aria-hidden="true">${I(k.icon)}</i><b>${esc(k.n)}</b><small>— ${esc(k.c)}</small><span class="pa-kid__go" aria-hidden="true">‹</span></button></li>`).join('')}
    </ul>
  </section>
  <div class="pa-grid">
    <section class="pa-card pa-heart" aria-labelledby="heart-h">
      <h2 id="heart-h">בזכות התשלומים שלכם — מה המוסד יכול לפנק את הילדים</h2>
      <p class="lead">${N(fund.sharePct + '%')} מכל תשלום שמגיע בזמן נכנס ל«קרן הפינוקים» של הילדים. כשההורים משלמים בזמן — המוסד לא משלם עמלות ופיגורים, והכסף הולך לשמחה של הילדים.</p>
      <div class="pa-next">
        <span class="pa-next__tag">הפינוק הבא בדרך</span>
        <div class="pa-next__t"><i aria-hidden="true">${I('lion')}</i><b>${esc(fund.title)}</b></div>
        <div class="pa-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="התקדמות לעבר ${esc(fund.title)}"><div class="pa-bar__fill" id="pa-fill"></div></div>
        <div class="pa-bar__nums"><span>נאסף <b>${N(ils(fund.got))}</b> (${N(pct + '%')})</span><span>יעד ${N(ils(fund.goal))}</span></div>
        <p class="pa-missing">${missing > 0 ? `חסרים עוד ${N(ils(missing))} ל${esc(fund.title)}` : 'הגענו ליעד!'} ${I('party', 'gi gi--in')}</p>
        <div class="pa-mine"><span aria-hidden="true">${I('heart')}</span><span>החלק שלכם בקרן השנה: <b>${N(ils(D.mine))}</b> — תודה!</span></div>
      </div>
      <ul class="pa-tl">
        <li><h3>כבר קרה בזכותכם</h3></li>
        ${DONE.map((t) => `<li class="pa-treat done"><span class="pa-treat__ic" aria-hidden="true">${t.i}</span><span><b>${esc(t.t)}</b><small>${esc(t.s)}</small></span><span class="ck" aria-label="הושלם">✓</span></li>`).join('')}
        <li><h3>הפינוקים הבאים</h3></li>
        ${FUTURE.map((t) => `<li class="pa-treat locked"><span class="pa-treat__ic" aria-hidden="true">${t.i}</span><span><b>${esc(t.t)}</b><small>${esc(t.s)}</small></span><span class="lock" aria-label="עוד לא נפתח">${LOCK}</span></li>`).join('')}
      </ul>
      <div class="pa-cta">
        <button class="btn btn-gold" type="button" data-sheet="method">${I('card', 'gi gi--btn')} לעדכן אמצעי תשלום</button>
        <button class="btn btn-ghost" type="button" data-sheet="settle">להסדיר תשלום</button>
      </div>
    </section>
    <section class="pa-card" aria-labelledby="pay-h">
      <header><h2 id="pay-h">התשלומים שלי</h2><span class="hint">שכר לימוד חודשי ${N(ils(D.monthly))}</span></header>
      <div class="pa-stats">
        <div class="pa-stat"><span>שולם השנה</span><b>${N(ils(D.paid))}</b></div>
        <div class="pa-stat"><span>תשלומים</span><b>${N(D.pays.length)}</b></div>
        <div class="pa-stat is-next"><span>החיוב הבא</span><b>${N(D.nextCharge)}</b></div>
        <div class="pa-stat"><span>מצב החשבון</span>${debt ? `<b style="color:var(--warn)">${N(ils(debt.amount))} פתוח</b>` : '<b style="color:var(--ok)">מסודר ✓</b>'}</div>
      </div>
      <ul class="pa-pays">
        ${[...D.pays].reverse().map((p) => { const [ic, mn] = METHOD[p.k] || METHOD.link; const [cl, lb] = STATUS[p.st] || STATUS.ok; return `
        <li class="pa-pay">
          <span class="pa-pay__ic" aria-hidden="true">${ic}</span>
          <span class="pa-pay__main"><b>${esc(p.m)}</b><small>${N(p.d)} · ${mn}${p.note ? ` · ${esc(p.note)}` : ''}</small></span>
          <span class="pa-pay__end"><b>${N(ils(p.s))}</b><span class="pill ${cl}">${lb}</span></span>
        </li>`; }).join('')}
      </ul>
    </section>
  </div>
  <footer class="pa-foot">${esc(D.inst)} · בני ברק · מופעל ע״י «גבאי» · דף הדגמה</footer>`;
  requestAnimationFrame(() => setTimeout(() => { const f = document.getElementById('pa-fill'); if (f) f.style.width = pct + '%'; }, 250));
  document.getElementById('out').addEventListener('click', async () => { await call('logout', {}).catch(() => {}); D = null; boot(); });
}

// ---------- bottom sheet
const sheet = document.getElementById('pa-sheet');
const body = document.getElementById('pa-sheet-body');
let lastFocus = null;
const SHEETS = {
  kid: (i) => {
    const k = D.kids[i]; const share = Math.round(D.monthly / D.kids.length);
    return `
    <div class="pa-kc">
      <div class="pa-kc__head"><i aria-hidden="true">${I(k.icon, 'gi gi--big')}</i><div><h2 id="pa-sheet-t">${esc(k.n)} ${esc(D.family)}</h2><p>${esc(k.c)} · ${esc(k.teacher)}</p></div></div>
      <div class="pa-stats">
        <div class="pa-stat"><span>נוכחות החודש</span><b>${N(k.att + '%')}</b></div>
        <div class="pa-stat"><span>חלקו בשכר הלימוד</span><b>${N(ils(share))}</b></div>
      </div>
      <dl class="pa-kc__dl">
        <div><dt>מה לומדים עכשיו</dt><dd>${esc(k.learn)}</dd></div>
        <div><dt>מהמלמד</dt><dd>${esc(k.star)}</dd></div>
        <div><dt>פינוקים שנהנה מהם השנה</dt><dd>${DONE.map((t) => esc(t.t)).join(' · ')}</dd></div>
        <div><dt>הפינוק הבא</dt><dd>${esc(D.fund.title)}</dd></div>
      </dl>
    </div>
    <div class="btns"><button class="btn btn-gold" type="button" data-close>סגירה</button></div>`;
  },
  method: () => `
    <h2 id="pa-sheet-t">עדכון אמצעי תשלום</h2>
    <p>בחרו איך נוח לכם לשלם את שכר הלימוד החודשי. אפשר לשנות בכל עת.</p>
    <div class="pa-opts" role="radiogroup">
      <label class="pa-opt"><input type="radio" name="m" checked><i aria-hidden="true">${I('bank')}</i>הוראת קבע מהבנק</label>
      <label class="pa-opt"><input type="radio" name="m"><i aria-hidden="true">${I('card')}</i>כרטיס אשראי</label>
      <label class="pa-opt"><input type="radio" name="m"><i aria-hidden="true">${I('link')}</i>קישור תשלום בכל חודש</label>
    </div>
    <div class="btns"><button class="btn btn-gold" type="button" data-ok>שמירה</button><button class="btn btn-ghost" type="button" data-close>ביטול</button></div>`,
  settle: () => `
    <h2 id="pa-sheet-t">הסדרת תשלום</h2>
    <p>${D.debt ? `נשאר להסדיר ${N(ils(D.debt.amount))} (חודש ${esc(D.debt.month)}).` : `החשבון שלכם מסודר. החיוב הבא — ${N(ils(D.monthly))} ב-${N(D.nextCharge)}.`}</p>
    ${D.pay_url ? `<div class="btns" style="margin:14px 0"><a class="btn btn-gold" href="${esc(D.pay_url)}">לתשלום מאובטח עכשיו</a></div>` : ''}
    <div class="pa-opts" role="radiogroup">
      <label class="pa-opt"><input type="radio" name="s" checked><i aria-hidden="true">${I('calendar')}</i>לבקש פריסה / דחייה קצרה</label>
      <label class="pa-opt"><input type="radio" name="s"><i aria-hidden="true">${I('phone')}</i>שהמזכירות תחזור אליי</label>
    </div>
    <div class="btns"><button class="btn ${D.pay_url ? 'btn-ghost' : 'btn-gold'}" type="button" data-ok>שליחת בקשה</button><button class="btn btn-ghost" type="button" data-close>אחר כך</button></div>`,
};
function openSheet(kind, arg) {
  lastFocus = document.activeElement;
  body.innerHTML = SHEETS[kind](arg);
  sheet.hidden = false; sheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  body.querySelector('button, a')?.focus();
}
function closeSheet() { sheet.hidden = true; sheet.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; lastFocus?.focus?.(); }
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-sheet],[data-close],[data-ok],[data-kid]');
  if (!t) return;
  if (t.dataset.kid != null) return openSheet('kid', +t.dataset.kid);
  if (t.dataset.sheet) return openSheet(t.dataset.sheet);
  if (t.hasAttribute('data-close')) return closeSheet();
  if (t.hasAttribute('data-ok')) {
    body.innerHTML = `<div class="pa-done"><div class="big" aria-hidden="true">${I('thanks', 'gi gi--big')}</div><h2 id="pa-sheet-t">תודה רבה!</h2><p>הבקשה נקלטה. אישור יישלח אליכם בהודעה. (דף הדגמה — לא בוצע חיוב)</p></div>
      <div class="btns"><button class="btn btn-gold" type="button" data-close>סגירה</button></div>`;
    body.querySelector('button').focus();
  }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

async function boot() {
  try { const j = await call('me'); if (j.user) { D = j.data; render(); } else loginView(j.demo || []); }
  catch { root.innerHTML = '<p class="pa-err">לא הצלחנו להתחבר לשרת. נסו לרענן.</p>'; }
}
boot();
// refresh after returning from the payment page
document.addEventListener('visibilitychange', () => { if (!document.hidden && D) call('me').then((j) => { if (j.user) { D = j.data; if (sheet.hidden) render(); } }).catch(() => {}); });
