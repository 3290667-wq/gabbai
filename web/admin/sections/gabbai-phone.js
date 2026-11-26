// «גבאי» — טלפון מדומה עם וואטסאפ (עמיחי 26.11.2026): «שהצוות יוכל להריץ דמו ולעשות QA בלי חיבור אמיתי לווצאפ».
// כל מה שהמערכת שולחת בוואטסאפ (תזכורת, קישור, הסדר, קבלה) מגיע לכאן, ומה שכותבים כאן נענה ע״י אותו בוט של קבוצת ההורים
// (server/routes/99_gabbai_wa.js → /api/gabbai/sim*). שני צ׳אטים: פרטי עם «גבאי», וקבוצת ההורים.
import kit from '../kit.js';

const { h, api } = kit;
const QUICK = {
  dm: ['מה המצב שלי?', 'שלח לי קישור לתשלום', 'אפשר בתשלומים?', 'אין לי כסף החודש', 'כבר שילמתי', 'אני רוצה לדבר עם המזכירה'],
  group: ['מה המצב שלי?', 'מה הילדים לומדים השבוע?', 'כמה חסר לפינוק הבא?', 'מתי החיוב הבא?'],
};
const hm = (iso) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date(iso));

// טקסט → צמתים: קישורים לחיצים (רק http/https), *מודגש* כמו בוואטסאפ, שורות חדשות נשמרות ע״י CSS
function rich(text) {
  const out = [];
  String(text).split(/(https?:\/\/[^\s]+)/g).forEach((part, i) => {
    if (i % 2) { out.push(h('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part)); return; }
    part.split(/(\*[^*\n]+\*)/g).forEach((p, j) => out.push(j % 2 ? h('b', null, p.slice(1, -1)) : p));
  });
  return out;
}

export function phoneSim(timers) {
  const st = { open: false, fam: localStorage.getItem('gb-sim-fam') || '', chat: 'dm', seq: 0, msgs: [], fams: [], typing: [], joined: false, waReal: true, group: '', busy: false };

  const fab = h('button', { type: 'button', class: 'gwa-fab', 'aria-expanded': 'false', 'aria-controls': 'gwa-sheet' },
    h('span', { class: 'gwa-fab__dot', 'aria-hidden': 'true' }), 'טלפון מדומה · וואטסאפ');
  const famSel = h('select', { class: 'gwa-sel', 'aria-label': 'של מי הטלפון' });
  const realBtn = h('button', { type: 'button', class: 'gwa-tool', 'aria-pressed': 'true' });
  const clearBtn = h('button', { type: 'button', class: 'gwa-tool' }, 'ניקוי הצ׳אט');
  const closeBtn = h('button', { type: 'button', class: 'gwa-close', 'aria-label': 'סגירת הטלפון' }, '✕');

  const tabDm = h('button', { type: 'button', role: 'tab', class: 'gwa-tab', 'aria-selected': 'true' }, 'גבאי · אור התורה');
  const tabGr = h('button', { type: 'button', role: 'tab', class: 'gwa-tab', 'aria-selected': 'false' }, 'קבוצת ההורים');
  const title = h('b', { class: 'gwa-head__name' });
  const sub = h('small', { class: 'gwa-head__sub' });
  const avatar = h('span', { class: 'gwa-av', 'aria-hidden': 'true' });
  const list = h('ol', { class: 'gwa-msgs', 'aria-live': 'polite', 'aria-label': 'הודעות' });
  const quick = h('div', { class: 'gwa-quick', 'aria-label': 'תשובות מהירות לבדיקה' });
  const input = h('textarea', { class: 'gwa-in', rows: '1', placeholder: 'הודעה', 'aria-label': 'הודעה בשם ההורה', enterkeyhint: 'send' });
  const sendBtn = h('button', { type: 'button', class: 'gwa-send', 'aria-label': 'שליחה' }, h('span', { 'aria-hidden': 'true' }, '➤'));
  const joinBox = h('div', { class: 'gwa-join' });
  const clock = h('span', { class: 'gwa-clock' });

  const screen = h('div', { class: 'gwa-screen' },
    h('div', { class: 'gwa-status' }, clock, h('span', { class: 'gwa-notch', 'aria-hidden': 'true' }), h('span', { class: 'gwa-bat', 'aria-hidden': 'true' }, '5G ▮▮▮ 92%')),
    h('header', { class: 'gwa-head' }, avatar, h('div', { class: 'gwa-head__t' }, title, sub)),
    h('div', { class: 'gwa-tabs', role: 'tablist' }, tabDm, tabGr),
    h('div', { class: 'gwa-wall' }, list, joinBox),
    quick,
    h('div', { class: 'gwa-bar' }, input, sendBtn));
  const sheet = h('aside', { id: 'gwa-sheet', class: 'gwa-sheet', hidden: '', 'aria-label': 'טלפון מדומה עם וואטסאפ' },
    h('div', { class: 'gwa-top' }, h('label', { class: 'gwa-top__l' }, 'הטלפון של', famSel), closeBtn),
    h('div', { class: 'gwa-phone' }, screen),
    h('div', { class: 'gwa-tools' }, realBtn, clearBtn),
    h('p', { class: 'gwa-note' }, 'כל הודעת וואטסאפ שהמערכת שולחת מגיעה גם לכאן. מה שכותבים כאן נענה על ידי «גבאי» בדיוק כמו בוואטסאפ האמיתי.'));

  sheet.hidden = true; joinBox.hidden = true; // kit.h drops empty-string attributes, so «hidden: ''» alone is not enough
  const fam = () => st.fams.find((f) => f.id === st.fam);
  function paintHead() {
    const f = fam();
    if (st.chat === 'dm') { title.textContent = 'גבאי · תלמוד תורה «אור התורה»'; sub.textContent = st.typing.includes('dm') ? 'מקליד…' : 'עוזר דיגיטלי · מחובר/ת'; avatar.textContent = 'ג'; }
    else { title.textContent = st.group || 'קבוצת ההורים'; sub.textContent = st.typing.includes('group') ? 'גבאי מקליד…' : `גבאי, ${f ? f.parent : 'את/ה'} ועוד הורים`; avatar.textContent = '👥'; }
    tabDm.setAttribute('aria-selected', String(st.chat === 'dm')); tabGr.setAttribute('aria-selected', String(st.chat === 'group'));
    realBtn.textContent = st.waReal ? 'וואטסאפ אמיתי: פעיל' : 'וואטסאפ אמיתי: כבוי';
    realBtn.setAttribute('aria-pressed', String(st.waReal)); realBtn.classList.toggle('is-off', !st.waReal);
    quick.replaceChildren(...QUICK[st.chat].map((q) => { const b = h('button', { type: 'button', class: 'gwa-chip' }, q); b.addEventListener('click', () => send(q)); return b; }));
  }
  function paintMsgs() {
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const ms = st.msgs.filter((m) => m.chat === st.chat);
    const items = ms.map((m) => h('li', { class: `gwa-m ${m.from === 'parent' ? 'is-out' : 'is-in'}` },
      st.chat === 'group' && m.from !== 'parent' ? h('span', { class: 'gwa-m__who' }, 'גבאי') : null,
      h('span', { class: 'gwa-m__t' }, ...rich(m.text)),
      h('span', { class: 'gwa-m__meta' }, hm(m.at), m.from === 'parent' ? h('span', { class: 'gwa-ticks', 'aria-label': 'נקרא' }, '✓✓') : null)));
    if (!ms.length && !(st.chat === 'group' && !st.joined)) items.push(h('li', { class: 'gwa-empty' }, st.chat === 'dm' ? 'עוד אין הודעות. לחצו «וואטסאפ» בכרטיס המשפחה, או כתבו כאן בשם ההורה.' : 'כתבו בקבוצה בשם ההורה.'));
    if (st.typing.includes(st.chat)) items.push(h('li', { class: 'gwa-m is-in gwa-typing', 'aria-label': 'גבאי מקליד' }, h('i'), h('i'), h('i')));
    list.replaceChildren(...items);
    const locked = st.chat === 'group' && !st.joined;
    joinBox.hidden = !locked; input.disabled = locked; sendBtn.disabled = locked;
    if (locked) {
      const b = h('button', { type: 'button', class: 'gwa-joinbtn' }, 'הצטרפות לקבוצה');
      b.addEventListener('click', () => act(() => api.post('/api/gabbai/sim/join', { fam: st.fam })));
      joinBox.replaceChildren(h('div', { class: 'gwa-invite' }, h('span', { class: 'gwa-av is-big', 'aria-hidden': 'true' }, '👥'), h('b', null, st.group || 'קבוצת ההורים'),
        h('small', null, 'קבוצת וואטסאפ · הזמנה מהמוסד'), b));
    }
    if (near || items.length < 4) list.scrollTop = list.scrollHeight;
  }
  function paintFams() {
    const cur = famSel.value;
    if (famSel.options.length !== st.fams.length || cur !== st.fam) {
      famSel.replaceChildren(...st.fams.map((f) => h('option', { value: f.id }, `משפחת ${f.family} · ${f.parent}${f.debt ? ` · פתוח ₪${f.debt.toLocaleString('he-IL')}` : ''}`)));
    }
    famSel.value = st.fam;
  }
  async function poll(reset) {
    if (!st.open) return;
    if (reset) { st.seq = 0; st.msgs = []; }
    try {
      const j = await api.get('/api/gabbai/sim', { fam: st.fam, after: st.seq }, { quiet: true });
      st.fams = j.families; st.waReal = j.waReal; st.typing = j.typing; st.joined = j.joined; st.group = j.group;
      if (!st.fam || !fam()) { st.fam = (st.fams[0] || {}).id || ''; if (st.fam) return poll(true); }
      if (j.seq < st.seq) return poll(true);
      if (j.msgs.length) { st.msgs.push(...j.msgs); st.seq = j.msgs[j.msgs.length - 1].id; }
      paintFams(); paintHead(); paintMsgs();
    } catch { /* keep polling */ }
  }
  async function act(fn) { if (st.busy) return; st.busy = true; try { await fn(); } catch { /* kit toasts */ } finally { st.busy = false; poll(); } }
  function send(text) {
    const t = String(text ?? input.value).trim(); if (!t || !st.fam) return;
    if (text === undefined) input.value = '';
    input.style.height = '';
    act(() => api.post('/api/gabbai/sim/send', { fam: st.fam, chat: st.chat, text: t }));
  }
  function toggle(on) {
    st.open = on ?? !st.open; sheet.hidden = !st.open; fab.setAttribute('aria-expanded', String(st.open));
    document.documentElement.classList.toggle('gwa-lock', st.open && matchMedia('(max-width: 720px)').matches);
    if (st.open) { poll(true); setTimeout(() => input.focus({ preventScroll: true }), 50); }
  }

  fab.addEventListener('click', () => toggle());
  closeBtn.addEventListener('click', () => toggle(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.open) toggle(false); });
  famSel.addEventListener('change', () => { st.fam = famSel.value; localStorage.setItem('gb-sim-fam', st.fam); poll(true); });
  tabDm.addEventListener('click', () => { st.chat = 'dm'; paintHead(); paintMsgs(); });
  tabGr.addEventListener('click', () => { st.chat = 'group'; paintHead(); paintMsgs(); });
  sendBtn.addEventListener('click', () => send());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(110, input.scrollHeight)}px`; });
  realBtn.addEventListener('click', () => act(() => api.post('/api/gabbai/sim/real', { on: !st.waReal })));
  clearBtn.addEventListener('click', () => { if (confirm('לנקות את הצ׳אטים של המשפחה הזאת בטלפון המדומה?')) act(async () => { await api.post('/api/gabbai/sim/clear', { fam: st.fam }); st.seq = 0; st.msgs = []; }); });

  const tick = () => { clock.textContent = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date()); };
  tick();
  timers.push(setInterval(() => { tick(); if (st.open && !document.hidden) poll(); }, 1500));
  const root = h('div', { class: 'gwa' }, fab, sheet);
  return root;
}

export default { phoneSim };
