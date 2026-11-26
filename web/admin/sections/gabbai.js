// «חדר הגבייה» (#/admin/gabbai) — the command room of «גבאי — עובד גבייה דיגיטלי».
// KPIs from the real endpoints (returned/summary, returned list, collection/summary, payments list), fall back to demo numbers.
// Channels (mail / WhatsApp / voice secretary), the live agent pipeline + activity feed and «הפעל סבב גבייה» are a front-end simulation.
import kit from '../kit.js';
import charts from '../charts.js';
import persona from '../gabbai-persona.js'; // סוגי הורים + ניסוח מותאם (26.11)

const { h, api, fmt, icon } = kit;

const FALLBACK_NAMES = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'פרידמן', 'שפירא', 'רוזנברג', 'גולדשטיין', 'וייס', 'אבוטבול', 'דהן', 'קליין'];
const REASONS = ['אין כיסוי', 'ההרשאה בוטלה', 'החשבון מוגבל', 'הסכום חורג מהתקרה', 'כרטיס פג תוקף'];
const STAGES = [
  { key: 'classify', label: 'מסווג', sub: 'מזהה סיבת החזרה ודחיפות', ico: 'filter' },
  { key: 'reach', label: 'פונה', sub: 'מייל · וואטסאפ · קו קולי', ico: 'send' },
  { key: 'negotiate', label: 'משא ומתן', sub: 'הסדר ופריסה לתשלומים', ico: 'scale' },
  { key: 'supervise', label: 'מנהל עבודה', sub: 'בקרה ואישור לפני שליחה', ico: 'shield' },
  { key: 'pay', label: 'קישור תשלום', sub: 'קישור מאובטח לתשלום', ico: 'link' },
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const amt = () => pick([180, 240, 320, 365, 450, 520, 615, 780, 960, 1180]);
const nowT = () => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date());

function countUp(el, to, { money = false, pct = false, ms = 900 } = {}) {
  const from = +el.dataset.v || 0; el.dataset.v = to;
  const t0 = performance.now();
  const show = (v) => { el.textContent = money ? `₪${fmt.int(Math.round(v))}` : pct ? `${Math.round(v)}%` : fmt.int(Math.round(v)); };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { show(to); return; }
  const step = (t) => { const k = Math.min(1, (t - t0) / ms); show(from + (to - from) * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

async function loadData() {
  const d = { collected: 87450, openReturned: 6, openAmount: 4300, inAgent: 5, human: 1, rate: 91, names: FALLBACK_NAMES, days: null };
  const today = fmt.todayISO ? fmt.todayISO() : new Date().toISOString().slice(0, 10);
  const from14 = new Date(Date.parse(`${today}T12:00:00Z`) - 13 * 864e5).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const q = { quiet: true };
  const [rs, rl, cs, pays, hh] = await Promise.allSettled([
    api.get('/api/returned/summary', null, q), api.get('/api/returned', {}, q), api.get('/api/collection/summary', null, q),
    api.get('/api/payments', { from: monthStart < from14 ? monthStart : from14, limit: 5000 }, q), api.get('/api/households', null, q)]);
  if (rs.status === 'fulfilled') {
    const k = Object.fromEntries((rs.value.kpis || []).map((x) => [x.key, x]));
    if (k.open) { d.openReturned = +k.open.value || d.openReturned; const m = String(k.open.sub || '').replace(/[^\d]/g, ''); if (m) d.openAmount = +m; }
    if (k.secretary) d.human = +k.secretary.value || 0;
  }
  if (rl.status === 'fulfilled' && Array.isArray(rl.value)) {
    const open = rl.value.filter((c) => c.status === 'open');
    if (open.length) { d.openReturned = open.length; d.human = open.filter((c) => c.stage === 'secretary').length; d.inAgent = open.length - d.human; }
  } else d.inAgent = Math.max(0, d.openReturned - d.human);
  if (cs.status === 'fulfilled') { const r = (cs.value.kpis || []).find((x) => x.key === 'rate'); if (r && +r.value) d.rate = +r.value; }
  if (pays.status === 'fulfilled' && Array.isArray(pays.value) && pays.value.length) {
    const valid = pays.value.filter((p) => p.status !== 'void');
    const month = valid.filter((p) => p.date >= monthStart).reduce((s, p) => s + (+p.amount || 0), 0);
    if (month) d.collected = month;
    const by = {}; valid.forEach((p) => { if (p.date >= from14) by[p.date] = (by[p.date] || 0) + (+p.amount || 0); });
    d.days = Array.from({ length: 14 }, (_, i) => { const iso = new Date(Date.parse(`${from14}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10); return { iso, v: Math.round(by[iso] || 0) }; });
    // the demo seed holds few recent receipts — a near-empty 14-day strip would contradict the month total, so use the demo curve
    if (d.days.reduce((a, x) => a + x.v, 0) < d.collected * 0.25) d.days = null;
  }
  if (!d.days) d.days = Array.from({ length: 14 }, (_, i) => ({ iso: new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10), v: 2400 + Math.round(Math.abs(Math.sin(i * 1.7)) * 5200) }));
  if (hh.status === 'fulfilled' && Array.isArray(hh.value) && hh.value.length) {
    const n = [...new Set(hh.value.map((x) => x.family_name).filter(Boolean))]; if (n.length > 4) d.names = n;
  }
  return d;
}

// ---------- live demo: real families, a real outgoing call from the Achvata line, WhatsApp + e-mail (server/routes/98_gabbai_live.js)
function livePanel(timers) {
  const KIND = { dial: 'phone', call: 'phone', call_end: 'phone', say: 'chat', link: 'link', plan: 'calendar', paid: 'check', wa: 'chat', mail: 'mail', human: 'person', persona: 'search', warn: 'shield', login: 'person', reset: 'robot' };
  const rows = h('div', { class: 'gb-lv__fams' });
  const talk = h('ol', { class: 'gb-lv__talk', 'aria-live': 'polite', 'aria-label': 'יומן השיחה והפעולות' });
  const empty = h('li', { class: 'gb-lv__empty' }, 'לחצו «חייג עכשיו» — השיחה תופיע כאן בזמן אמת.');
  talk.append(empty);
  let seq = 0; let phones = []; let busy = false;
  const ico = (n) => h('img', { src: new URL(`../../assets/icons/${n}.webp?v=2`, import.meta.url).href, alt: '', draggable: 'false', class: 'gb-lv__ico' });
  const t = (iso) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
  const act = async (fn, btn) => { if (busy) return; busy = true; btn && (btn.disabled = true); try { await fn(); } catch (e) { /* toast by kit */ } finally { busy = false; btn && (btn.disabled = false); poll(); } };
  function paintFams(fams) {
    rows.replaceChildren(...fams.map((f) => {
      const sel = h('select', { class: 'gb-lv__sel', 'aria-label': `טלפון להדגמה — משפחת ${f.family}` }, phones.map((p) => h('option', { value: p.phone, selected: p.phone === f.phone ? '' : null }, `${p.name} · ${p.phone.replace(/^(\d{3})/, '$1-')}`)));
      sel.value = f.phone;
      sel.addEventListener('change', () => act(() => api.post('/api/gabbai/live/phone', { id: f.id, phone: sel.value })));
      const st = f.debt ? h('span', { class: 'gb-lv__st is-debt' }, `חוב ₪${fmt.int(f.debt.amount)} · ${f.debt.reason}`) : h('span', { class: 'gb-lv__st is-ok' }, 'מסודר ✓');
      const b = (label, cls, fn) => { const x = h('button', { type: 'button', class: `gb-lv__b ${cls}` }, label); x.addEventListener('click', () => act(fn, x)); return x; };
      return h('article', { class: `gb-lv__fam${f.debt ? ' has-debt' : ''}` },
        h('div', { class: 'gb-lv__who' }, h('b', null, `משפחת ${f.family}`), h('small', null, `${f.parent} · ${f.kids} ילדים · קוד הורה ${f.code}`), st,
          f.plan ? h('small', { class: 'gb-lv__plan' }, `הסדר: ${f.plan.n} × ₪${fmt.int(f.plan.each)}`) : null,
          persona.badge(f, (key) => act(() => api.post('/api/gabbai/live/persona', { id: f.id, key })))),
        sel,
        h('div', { class: 'gb-lv__acts' },
          b('חייג עכשיו', 'is-call', () => api.post('/api/gabbai/live/call', { id: f.id }).then(() => kit.toast?.('מחייג… הטלפון יצלצל בעוד כמה שניות', 'success'))),
          b('וואטסאפ', '', () => api.post('/api/gabbai/live/remind', { id: f.id, channel: 'whatsapp' })),
          b('מייל', '', () => api.post('/api/gabbai/live/remind', { id: f.id, channel: 'email' })),
          f.link ? h('a', { class: 'gb-lv__b', href: f.link, target: '_blank', rel: 'noopener' }, 'קישור התשלום ↗') : null));
    }));
  }
  function addEv(e) {
    empty.remove();
    const cls = e.who === 'parent' ? 'is-parent' : e.who === 'bot' ? 'is-bot' : `is-${e.kind}`;
    const label = e.who === 'parent' ? `הורה${e.family ? ` (${e.family})` : ''}` : e.who === 'bot' ? 'גבאי' : null;
    talk.prepend(h('li', { class: `gb-lv__ev ${cls}` }, e.who ? null : ico(KIND[e.kind] || 'robot'),
      h('span', { class: 'gb-lv__tx' }, label ? h('b', null, `${label}: `) : null, e.text), h('time', null, t(e.at))));
    while (talk.children.length > 60) talk.lastChild.remove();
  }
  async function poll() {
    try {
      const j = await api.get('/api/gabbai/live', { since: seq }, { quiet: true });
      phones = j.phones; paintFams(j.families);
      if (j.seq < seq) { talk.replaceChildren(empty); seq = 0; return poll(); }
      j.events.forEach(addEv); seq = j.seq;
    } catch { /* keep polling */ }
  }
  poll();
  timers.push(setInterval(() => { if (!document.hidden) poll(); }, 2000));
  const reset = h('button', { type: 'button', class: 'gb-lv__reset' }, 'איפוס ההדגמה');
  reset.addEventListener('click', () => { if (confirm('לאפס את ההדגמה (חובות, קישורים ויומן)?')) act(() => api.post('/api/gabbai/live/reset', {}), reset); });
  return h('section', { class: 'gb-panel gb-lv', 'aria-label': 'הדגמה חיה' },
    h('header', { class: 'gb-panel__head' }, h('h2', null, h('span', { class: 'gb-live', 'aria-hidden': 'true' }), 'הדגמה חיה — שיחה יוצאת, וואטסאפ ומייל'),
      h('span', { class: 'gb-panel__hint' }, 'מחייג מקו הטלפון של המוסד 03-0000000'), reset),
    h('div', { class: 'gb-lv__grid' }, rows, h('div', { class: 'gb-lv__log' }, h('h3', { class: 'gb-sub' }, 'השיחה והפעולות — בזמן אמת'), talk)));
}

export async function mount(el, { setTitle } = {}) {
  setTitle?.('חדר הגבייה');
  kit.loadCss?.('gabbai'); kit.loadCss?.('gabbai-persona');
  const timers = [];
  const d = await loadData();
  const st = { collected: d.collected, open: d.openReturned, agent: d.inAgent, human: d.human, rate: d.rate,
    stages: { classify: 2, reach: Math.max(1, d.inAgent), negotiate: 2, supervise: 1, pay: 3 },
    ch: { mail: 14, wa: 37, voice: 9 } };

  // ---------- KPIs
  const kpi = (key, label, sub, tone, ico) => {
    const v = h('b', { class: 'gb-kpi__v ui-num', 'data-k': key }, '0');
    return { v, el: h('article', { class: `gb-kpi gb-kpi--${tone}` },
      h('span', { class: 'gb-kpi__ico', 'aria-hidden': 'true' }, icon(ico, { size: 18 })),
      h('span', { class: 'gb-kpi__l' }, label), v, h('span', { class: 'gb-kpi__s' }, sub)) };
  };
  const K = {
    collected: kpi('collected', 'נגבה החודש', 'שכר לימוד מכל אמצעי התשלום', 'gold', 'wallet'),
    open: kpi('open', 'הוראות קבע שחזרו — פתוחות', `₪${fmt.int(d.openAmount)} שכר לימוד במעקב`, 'warn', 'alert'),
    agent: kpi('agent', 'בטיפול הסוכן', 'פונה להורים עכשיו, בלי מגע יד', 'live', 'bolt'),
    human: kpi('human', 'הועברו לנציג אנושי', 'רק מה שבאמת צריך את מזכירות המוסד', 'muted', 'user'),
    rate: kpi('rate', 'שיעור הצלחה', 'שכר לימוד שנגבה מתוך החיוב', 'ok', 'chart'),
  };
  const paintKpis = () => {
    countUp(K.collected.v, st.collected, { money: true }); countUp(K.open.v, st.open); countUp(K.agent.v, st.agent);
    countUp(K.human.v, st.human); countUp(K.rate.v, st.rate, { pct: true });
  };

  // ---------- channels
  const chEls = {};
  const channel = (key, name, ico, sample) => {
    const n = h('b', { class: 'gb-ch__n ui-num' }, fmt.int(st.ch[key]));
    const last = h('p', { class: 'gb-ch__last' }, sample);
    chEls[key] = { n, last };
    return h('article', { class: `gb-ch gb-ch--${key}` },
      h('header', { class: 'gb-ch__head' }, h('span', { class: 'gb-ch__ico', 'aria-hidden': 'true' }, icon(ico, { size: 20 })),
        h('h3', null, name), h('span', { class: 'gb-status' }, h('i', { 'aria-hidden': 'true' }), 'מחובר')),
      h('div', { class: 'gb-ch__row' }, n, h('span', null, 'הודעות היום')), last);
  };
  const channels = h('section', { class: 'gb-panel gb-channels', 'aria-label': 'ערוצים' },
    h('header', { class: 'gb-panel__head' }, h('h2', null, 'ערוצים'), h('span', { class: 'gb-panel__hint' }, 'כל הערוצים פעילים')),
    h('div', { class: 'gb-ch-grid' },
      channel('mail', 'מייל', 'mail', '«שלום להורי מנחם לוי, מצורף קישור לעדכון פרטי הכרטיס לשכר הלימוד…»'),
      channel('wa', 'וואטסאפ', 'whatsapp', '«תודה, אסדיר את שכר הלימוד היום דרך הקישור 🙏»'),
      channel('voice', 'מזכירה טלפונית (קו קולי)', 'phone', 'שיחה עם הורי יוסף פרץ (כיתה ה׳) — סוכם הסדר ב-3 תשלומים')));

  // ---------- pipeline
  const stEls = {};
  const pipeline = h('ol', { class: 'gb-pipe' }, STAGES.map((s, i) => {
    const n = h('b', { class: 'gb-stage__n ui-num' }, fmt.int(st.stages[s.key]));
    const li = h('li', { class: 'gb-stage', style: `--i:${i}` },
      h('span', { class: 'gb-stage__pulse', 'aria-hidden': 'true' }),
      h('span', { class: 'gb-stage__ico', 'aria-hidden': 'true' }, icon(s.ico, { size: 18 })),
      h('div', { class: 'gb-stage__txt' }, h('strong', null, s.label), h('span', null, s.sub)), n);
    stEls[s.key] = { n, li };
    return li;
  }));
  const feed = h('ol', { class: 'gb-feed', 'aria-live': 'polite', 'aria-label': 'פעילות הסוכנים' });
  const agents = h('section', { class: 'gb-panel gb-agents' },
    h('header', { class: 'gb-panel__head' }, h('h2', null, h('span', { class: 'gb-live', 'aria-hidden': 'true' }), 'הסוכנים עובדים עכשיו'),
      h('span', { class: 'gb-panel__hint' }, 'מתעדכן בזמן אמת')),
    pipeline, h('h3', { class: 'gb-sub' }, 'יומן פעולות חי'), feed);

  // ---------- chart
  const days = d.days;
  const chartBox = h('div', { class: 'gb-chart' });
  const sum14 = days.reduce((s, x) => s + x.v, 0);
  const chart = h('section', { class: 'gb-panel gb-chartp' },
    h('header', { class: 'gb-panel__head' }, h('h2', null, 'נגבה ב-14 הימים האחרונים'), h('span', { class: 'gb-panel__hint ui-num' }, `₪${fmt.int(sum14)}`)), chartBox);
  try {
    chartBox.append(charts.barChart({ x: days.map((x) => `${+x.iso.slice(8)}/${+x.iso.slice(5, 7)}`), series: [{ name: 'נגבה', y: days.map((x) => x.v) }], unit: '₪', height: 200, legend: false, values: false, title: 'נגבה ליום', tones: days.map(() => 'warn') }));
  } catch (e) { console.warn('[gabbai] chart', e); }

  // ---------- run button
  const themeBtn = h('button', { class: 'gb-theme', type: 'button' });
  const runBtn = h('button', { class: 'gb-run', type: 'button' }, icon('bolt', { size: 18 }), h('span', null, 'הפעל סבב גבייה'));
  const hero = h('header', { class: 'gb-hero' },
    h('div', { class: 'gb-hero__txt' },
      h('span', { class: 'gb-eyebrow' }, 'גבאי — גבייה חכמה למוסדות חינוך'),
      h('h1', null, 'חדר הגבייה'),
      h('p', null, 'הסוכנים גובים שכר לימוד בתלמוד התורה: מזהים הוראת קבע שחזרה, פונים להורים בערוץ הנכון, מגיעים להסדר בכבוד ושולחים קישור תשלום — והמזכירות רואה הכול כאן.')),
    h('div', { class: 'gb-hero__acts' }, runBtn,
      h('a', { class: 'gb-parent', href: new URL('parent/', document.baseURI).href, target: '_blank', rel: 'noopener' }, 'תצוגת הורה ↗'), themeBtn));

  const page = h('div', { class: 'gb' }, hero, livePanel(timers), persona.panel(timers),
    h('div', { class: 'gb-kpis' }, Object.values(K).map((k) => k.el)),
    channels, h('div', { class: 'gb-two' }, agents, chart));
  // מצב יום ברירת מחדל; לילה רק אם נבחר ונשמר
  const paintTheme = () => { const night = localStorage.getItem('gb-theme') === 'night'; page.classList.toggle('gb--night', night); themeBtn.textContent = night ? '☀ מצב יום' : '☾ מצב לילה'; themeBtn.setAttribute('aria-pressed', String(night)); };
  themeBtn.addEventListener('click', () => { localStorage.setItem('gb-theme', page.classList.contains('gb--night') ? 'day' : 'night'); paintTheme(); });
  paintTheme();
  el.replaceChildren(page);
  paintKpis();

  // ---------- simulation
  const fam = () => pick(d.names);
  const bump = (key) => { const s = stEls[key]; if (!s) return; s.li.classList.remove('is-hit'); void s.li.offsetWidth; s.li.classList.add('is-hit'); };
  const setStage = (key, delta) => { st.stages[key] = Math.max(1, st.stages[key] + delta); stEls[key].n.textContent = fmt.int(st.stages[key]); bump(key); };
  const chMsg = (key, text) => { st.ch[key] += 1; chEls[key].n.textContent = fmt.int(st.ch[key]); chEls[key].last.textContent = text; chEls[key].last.closest('.gb-ch')?.classList.add('is-hit'); setTimeout(() => chEls[key].last.closest('.gb-ch')?.classList.remove('is-hit'), 900); };
  const EVENTS = [
    () => { const f = fam(), a = amt(), r = pick(REASONS); setStage('classify', 1); return { e: 'search', t: `המסווג זיהה החזרה של שכר לימוד: משפחת ${f} — ${r}, ₪${fmt.int(a)}`, tone: 'info', after: () => { st.open += 1; } }; },
    () => { const f = fam(), a = amt(), r = pick(REASONS); setStage('reach', 1); chMsg('wa', `«שלום להורי ${pick(['מנחם', 'יוסף', 'שמואל', 'אהרן', 'דוד'])} ${f}, הוראת הקבע של שכר הלימוד (₪${fmt.int(a)}) חזרה (${r}). אפשר להסדיר כאן בקליק»`); return { e: 'robot', t: `הסוכן שלח וואטסאפ להורי ${pick(['מנחם', 'יוסף', 'שמואל', 'אהרן', 'דוד'])} ${f} (כיתה ${pick(['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ז׳', 'ח׳'])}) — הוראת קבע של שכר לימוד חזרה: ${r}, ₪${fmt.int(a)}`, tone: 'info', after: () => { st.agent += 1; } }; },
    () => { const f = fam(), n = pick([2, 3, 4]); setStage('negotiate', 1); chMsg('voice', `שיחה עם משפחת ${f} — סוכם הסדר ב-${n} תשלומים`); return { e: 'phone', t: `המזכירה הטלפונית סגרה הסדר עם משפחת ${f}: ${n} תשלומים`, tone: 'ok' }; },
    () => { const f = fam(); setStage('reach', 1); chMsg('mail', `«שלום להורים היקרים ממשפחת ${f}, מצורף קישור מאובטח לעדכון כרטיס האשראי לשכר הלימוד»`); return { e: 'mail', t: `נשלח מייל להורים ממשפחת ${f} עם קישור לעדכון כרטיס`, tone: 'info' }; },
    () => { const f = fam(); setStage('supervise', 1); return { e: 'shield', t: `מנהל העבודה אישר את נוסח ההסדר להורים ממשפחת ${f} לפני שליחה`, tone: 'info' }; },
    () => { const f = fam(), a = amt(); setStage('pay', 1); setStage('negotiate', -1); return { e: 'check', t: `שולם ₪${fmt.int(a)} שכר לימוד — משפחת ${f} · הפינוק הבא התקרב: ${pick(['טיול שנתי', 'מסיבת סיום מסכת', 'פרס לכיתה', 'יום כיף'])}`, tone: 'ok', after: () => { st.collected += a; st.open = Math.max(0, st.open - 1); st.agent = Math.max(0, st.agent - 1); st.rate = Math.min(99, st.rate + (Math.random() < 0.35 ? 1 : 0)); } }; },
    () => { const f = fam(); setStage('supervise', -1); return { e: 'person', t: `הועבר למזכירות המוסד: הורי משפחת ${f} ביקשו לדבר עם אדם`, tone: 'warn', after: () => { st.human += 1; st.agent = Math.max(0, st.agent - 1); } }; },
  ];
  const WEIGHTS = [2, 3, 2, 2, 1, 3, 1];
  const nextEvent = () => { let r = Math.random() * WEIGHTS.reduce((a, b) => a + b, 0); for (let i = 0; i < EVENTS.length; i++) { r -= WEIGHTS[i]; if (r <= 0) return EVENTS[i]; } return EVENTS[0]; };
  const push = (ev) => {
    const x = ev();
    feed.prepend(h('li', { class: `gb-ev gb-ev--${x.tone}` }, h('span', { class: 'gb-ev__e', 'aria-hidden': 'true' }, h('img', { src: new URL(`../../assets/icons/${x.e}.webp?v=2`, import.meta.url).href, alt: '', draggable: 'false', decoding: 'async' })), h('span', { class: 'gb-ev__t' }, x.t), h('time', null, nowT())));
    while (feed.children.length > 14) feed.lastChild.remove();
    x.after?.(); paintKpis();
  };
  // seed the feed with a few events so it is never empty
  [1, 0, 3, 2, 5].forEach((i) => push(EVENTS[i]));
  timers.push(setInterval(() => { if (!document.hidden) push(nextEvent()); }, 4000));

  runBtn.addEventListener('click', () => {
    if (runBtn.disabled) return;
    runBtn.disabled = true; runBtn.classList.add('is-running'); runBtn.querySelector('span').textContent = 'הסבב רץ…';
    page.classList.add('is-burst');
    const seq = [0, 1, 1, 3, 2, 4, 5, 1, 5, 6, 5];
    seq.forEach((i, k) => timers.push(setTimeout(() => push(EVENTS[i]), 260 * k)));
    timers.push(setTimeout(() => { runBtn.disabled = false; runBtn.classList.remove('is-running'); runBtn.querySelector('span').textContent = 'הפעל סבב גבייה'; page.classList.remove('is-burst'); kit.toast?.('הסבב הסתיים: 11 פעולות בוצעו בידי הסוכנים', 'success'); }, 260 * seq.length + 300));
  });

  return () => timers.forEach((t) => { clearInterval(t); clearTimeout(t); });
}
export default { mount };
