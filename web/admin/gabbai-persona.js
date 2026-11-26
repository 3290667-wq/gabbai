// «גבאי» — סוגי הורים בחדר הגבייה: תג לכל משפחה (עם עקיפה ידנית) ופאנל «סוגי הורים» עם תצוגת הנוסח לכל סוג.
// השרת מסווג ומנסח (server/lib/gabbai-persona.js, /api/gabbai/personas). הסוג מוצג רק למזכירות, לא להורה.
import kit from './kit.js';

const { h, api } = kit;
const ICO = (n) => new URL(`../assets/icons/${n}.webp?v=2`, import.meta.url).href;
const img = (n, cls = 'gbp-ico') => h('img', { src: ICO(n), alt: '', draggable: 'false', decoding: 'async', class: cls });
const LABELS = { reliable: 'משלם למופת', technical: 'תקלה טכנית', newbie: 'הורה חדש', procrastinator: 'דחיין', silent: 'לא מגיב', hardship: 'מתקשה כלכלית', dispute: 'חולק על החיוב' };
const ORDER = ['reliable', 'technical', 'newbie', 'procrastinator', 'silent', 'hardship', 'dispute'];

// תג הסוג בכרטיס המשפחה. onSet(key|'') = עקיפה ידנית / חזרה לאוטומטי
export function badge(f, onSet) {
  const p = f.persona; if (!p) return null;
  const sel = h('select', { class: 'gbp-sel', 'aria-label': `סוג ההורה — משפחת ${f.family}` },
    h('option', { value: '' }, `אוטומטי — ${LABELS[p.auto] || p.auto}`),
    ORDER.map((k) => h('option', { value: k }, LABELS[k])));
  sel.value = p.manual ? p.key : '';
  sel.addEventListener('change', () => onSet(sel.value));
  return h('div', { class: `gbp-badge is-${p.tone}` },
    h('div', { class: 'gbp-badge__top' }, img(p.ico), h('b', null, p.label), p.manual ? h('span', { class: 'gbp-tag' }, 'ידני') : null, sel),
    h('small', { class: 'gbp-why' }, p.why.join(' · ')));
}

export function panel(timers) {
  const grid = h('div', { class: 'gbp-grid' });
  const famSel = h('select', { class: 'gbp-sel gbp-sel--lg', 'aria-label': 'משפחה לתצוגה' });
  const tabs = h('div', { class: 'gbp-tabs', role: 'tablist', 'aria-label': 'סוג ההורה לתצוגה' });
  const out = h('div', { class: 'gbp-out' });
  let fam = ''; let key = ''; let data = null; let userPicked = false;

  const paintTypes = () => {
    grid.replaceChildren(...ORDER.map((k) => data.types.find((t) => t.key === k)).filter(Boolean).map((t) =>
      h('article', { class: `gbp-card is-${t.tone}${t.families.length ? ' has-fam' : ''}` },
        h('header', null, img(t.ico, 'gbp-ico gbp-ico--lg'), h('div', null, h('h3', null, t.label), h('p', null, t.who))),
        h('dl', null,
          h('dt', null, 'מתי'), h('dd', null, t.rule),
          h('dt', null, 'איך פונים'), h('dd', null, t.approach),
          h('dt', null, 'ערוץ'), h('dd', null, t.channel),
          h('dt', null, 'קצב'), h('dd', null, t.cadence)),
        h('footer', null, t.families.length ? `עכשיו: ${t.families.map((x) => `משפחת ${x}`).join(', ')}` : 'אין כרגע משפחות בסוג הזה'))));
  };
  const paintPreview = () => {
    const pv = data.previews?.[key]; if (!pv) { out.replaceChildren(); return; }
    const f = data.families.find((x) => x.id === fam);
    tabs.replaceChildren(...ORDER.map((k) => {
      const b = h('button', { type: 'button', role: 'tab', class: `gbp-tab${k === key ? ' is-on' : ''}${f?.persona.key === k ? ' is-own' : ''}`, 'aria-selected': String(k === key) }, LABELS[k]);
      b.addEventListener('click', () => { key = k; userPicked = true; paintPreview(); });
      return b;
    }));
    const lines = (t) => t.split('\n').map((l) => h('span', null, l));
    out.replaceChildren(
      h('section', { class: 'gbp-msg gbp-msg--wa' }, h('h4', null, img('chat'), 'וואטסאפ'), h('div', { class: 'gbp-bubble' }, lines(pv.text))),
      h('section', { class: 'gbp-msg gbp-msg--mail' }, h('h4', null, img('mail'), 'מייל'), h('div', { class: 'gbp-mail' }, h('b', null, pv.subject), h('div', null, lines(pv.text)))),
      h('section', { class: 'gbp-msg gbp-msg--ph' }, h('h4', null, img('phone'), 'שיחת טלפון — ההנחיה לגבאי'), h('p', { class: 'gbp-phone' }, pv.phone)));
  };
  async function load() {
    try {
      data = await api.get('/api/gabbai/personas', fam ? { fam } : null, { quiet: true });
      if (!fam && data.families.length) { fam = (data.families.find((x) => x.persona.key !== 'reliable') || data.families[0]).id; data = await api.get('/api/gabbai/personas', { fam }, { quiet: true }); }
      const f = data.families.find((x) => x.id === fam);
      if (!userPicked && f) key = f.persona.key;
      famSel.replaceChildren(...data.families.map((x) => h('option', { value: x.id }, `משפחת ${x.family} — ${x.persona.label}`)));
      famSel.value = fam;
      paintTypes(); paintPreview();
    } catch { /* keep the last view */ }
  }
  famSel.addEventListener('change', () => { fam = famSel.value; userPicked = false; load(); });
  load();
  timers.push(setInterval(() => { if (!document.hidden && !famSel.matches(':focus')) load(); }, 6000));

  return h('section', { class: 'gb-panel gbp', 'aria-label': 'סוגי הורים' },
    h('header', { class: 'gb-panel__head' }, h('h2', null, 'סוגי הורים — ניסוח שמותאם לכל הורה'),
      h('span', { class: 'gb-panel__hint' }, 'הסיווג מתעדכן לבד אחרי כל תשלום, תזכורת ושיחה')),
    h('p', { class: 'gbp-lead' }, 'גבאי לומד את דפוס התשלום של כל משפחה — איחורים, החזרות, כמה תזכורות עד שמשלמים, פניות שלא נענו ובקשות לפריסה — ומתאים את הטון, הערוץ והקצב. אותו סכום ואותו קישור, אבל הורה דחיין מקבל תאריך יעד, הורה שמתקשה מקבל הצעת פריסה בצנעה, ומשלם למופת מקבל תודה.'),
    grid,
    h('h3', { class: 'gb-sub' }, 'תצוגת הנוסח'),
    h('div', { class: 'gbp-pick' }, famSel, tabs),
    out);
}

export default { badge, panel };
