// «גבאי» — פאנל «למה גבאי החליט ככה» בחדר הגבייה (26.11.2026).
// מציג את ההחלטה של מנוע «הצעד הבא» לכל משפחה (server/lib/gabbai-decide.js, /api/gabbai/decide), את הנימוק ואת הסיכוי המשוער לתשלום,
// ויומן של כל הודעה: נענתה במענה מהיר מהקוד או ע״י Claude, כמה זמן לקח, והאם ההורה שילם אחרי הפנייה. אפשר גם לנסות הודעה בלי לשלוח.
import kit from './kit.js';

const { h, api, fmt } = kit;
const ACT_ICO = { none: 'check', human: 'person', plan: 'calendar', call: 'phone', link: 'link', update_card: 'card' };
const ICO = (n) => new URL(`../assets/icons/${n}.webp?v=2`, import.meta.url).href;
const img = (n) => h('img', { src: ICO(n), alt: '', draggable: 'false', decoding: 'async', class: 'gbd-ico' });
const t = (iso) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }).format(new Date(iso));
const ms = (n) => (n == null ? '—' : n < 1000 ? `${n} מ״ש` : `${(n / 1000).toFixed(1)} שנ׳`);

export function panel(timers) {
  const famSel = h('select', { class: 'gbp-sel gbp-sel--lg', 'aria-label': 'משפחה' });
  const card = h('div', { class: 'gbd-card' });
  const stats = h('div', { class: 'gbd-stats' });
  const log = h('ol', { class: 'gbd-log', 'aria-label': 'יומן ההחלטות' });
  const tryIn = h('input', { class: 'gbd-try__in', type: 'text', maxlength: '200', placeholder: 'למשל: «כמה אני חייב?» או «אפשר פריסה ל-5?»', 'aria-label': 'הודעה לניסיון' });
  const tryBtn = h('button', { type: 'button', class: 'gbd-try__b' }, 'מה גבאי יענה?');
  const tryOut = h('div', { class: 'gbd-try__out', 'aria-live': 'polite' });
  let fam = ''; let data = null;

  const paintCard = () => {
    const x = data.families.find((f) => f.id === fam); if (!x) { card.replaceChildren(); return; }
    const d = x.decision;
    const meter = d.prob == null ? h('p', { class: 'gbd-prob is-none' }, 'אין תשלום פתוח — אין מה לחזות')
      : h('div', { class: 'gbd-prob' }, h('div', { class: 'gbd-prob__top' }, h('span', null, 'סיכוי משוער לתשלום תוך 48 שעות'), h('b', null, `${d.prob}%`)),
        h('div', { class: 'gbd-bar', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(d.prob), 'aria-label': 'סיכוי לתשלום' }, h('i', { style: `width:${d.prob}%` })));
    card.replaceChildren(
      h('header', { class: 'gbd-card__head' }, img(ACT_ICO[d.action] || 'robot'),
        h('div', null, h('small', null, `משפחת ${x.family} · ${d.personaLabel}${d.debt ? ` · פתוח ₪${fmt.int(d.debt)}` : ''}`), h('h3', null, d.label))),
      meter,
      h('dl', { class: 'gbd-dl' },
        h('dt', null, 'ההצעה'), h('dd', null, d.offer),
        h('dt', null, 'פריסה'), h('dd', null, d.maxPlan ? `עד ${d.maxPlan} תשלומים${d.suggestPlan ? ` · מציעים ${d.suggestPlan}` : ' · רק אם ההורה מבקש'}` : 'לא מוצעת'),
        h('dt', null, 'ערוץ'), h('dd', null, d.channel || '—'),
        h('dt', null, 'מתי'), h('dd', null, d.when || '—'),
        d.avoid.length ? [h('dt', null, 'להימנע'), h('dd', null, d.avoid.join(' · '))] : null),
      h('div', { class: 'gbd-why' }, h('b', null, 'הנימוק: '), d.why.join(' · ')),
      h('details', { class: 'gbd-dir' }, h('summary', null, 'מה Claude מקבל כהנחיה'), h('p', null, x.directive)));
  };
  const paintStats = () => {
    const s = data.stats;
    const pct = s.total ? Math.round((s.fast / s.total) * 100) : 0;
    stats.replaceChildren(
      h('div', { class: 'gbd-stat' }, h('b', null, fmt.int(s.total)), h('small', null, 'הודעות שנענו')),
      h('div', { class: 'gbd-stat is-fast' }, h('b', null, `${pct}%`), h('small', null, `מענה מהיר · ממוצע ${ms(s.avgFast)}`)),
      h('div', { class: 'gbd-stat' }, h('b', null, fmt.int(s.claude)), h('small', null, `ל-Claude · ממוצע ${ms(s.avgClaude)}`)));
  };
  const paintLog = () => {
    if (!data.log.length) { log.replaceChildren(h('li', { class: 'gbd-log__empty' }, 'עוד אין הודעות. כתבו לגבאי בטלפון המדומה (בפינה) — כל תשובה תופיע כאן עם ההחלטה.')); return; }
    log.replaceChildren(...data.log.map((e) => h('li', { class: `gbd-row is-${e.path}` },
      h('span', { class: 'gbd-row__path' }, e.path === 'fast' ? 'מהיר' : 'Claude'),
      h('span', { class: 'gbd-row__tx' }, h('b', null, `משפחת ${e.family}: `), `«${e.text}»`, h('small', null, `${e.intentHe} → ${e.label}`)),
      h('span', { class: 'gbd-row__meta' }, h('time', null, t(e.at)), h('small', null, ms(e.ms)), e.paid ? h('em', { class: 'gbd-paid' }, 'שילם ✓') : null))));
  };
  async function load() {
    try {
      data = await api.get('/api/gabbai/decide', null, { quiet: true });
      if (!fam || !data.families.some((f) => f.id === fam)) fam = (data.families.find((f) => f.decision.debt) || data.families[0])?.id || '';
      if (!famSel.matches(':focus')) {
        famSel.replaceChildren(...data.families.map((f) => h('option', { value: f.id }, `משפחת ${f.family} — ${f.decision.label}`)));
        famSel.value = fam;
      }
      paintCard(); paintStats(); paintLog();
    } catch { /* keep the last view */ }
  }
  famSel.addEventListener('change', () => { fam = famSel.value; tryOut.replaceChildren(); paintCard(); });
  const doTry = async () => {
    const text = tryIn.value.trim(); if (!text || tryBtn.disabled) return;
    tryBtn.disabled = true;
    try {
      const j = await api.post('/api/gabbai/decide/try', { fam, text });
      tryOut.replaceChildren(j.fast
        ? h('div', { class: 'gbd-try__res is-fast' }, h('b', null, `מענה מהיר מהקוד (${j.fast.intent}) — בלי Claude:`), ...j.fast.text.split('\n').map((l) => h('span', null, l.replace('[קישור]', '🔗 (כאן ייכנס קישור תשלום)').replace(/\[פריסה (\d)\]/, '📅 (כאן יירשם הסדר של $1 תשלומים)').replace('[מזכירה]', '✔️ העברתי למזכירות — יחזרו אליך עוד היום.'))))
        : h('div', { class: 'gbd-try__res' }, h('b', null, 'ההודעה מורכבת — עוברת ל-Claude, '), 'עם ההנחיה של המנוע. התשובה תלויה בניסוח של Claude.'));
    } catch { /* toast by kit */ } finally { tryBtn.disabled = false; }
  };
  tryBtn.addEventListener('click', doTry);
  tryIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doTry(); });
  load();
  timers.push(setInterval(() => { if (!document.hidden) load(); }, 4000));

  return h('section', { class: 'gb-panel gbd', 'aria-label': 'למה גבאי החליט ככה' },
    h('header', { class: 'gb-panel__head' }, h('h2', null, 'למה גבאי החליט ככה'),
      h('span', { class: 'gb-panel__hint' }, 'ההחלטה בקוד · Claude רק מנסח')),
    h('p', { class: 'gbp-lead' }, 'לכל משפחה מנוע ההחלטה קובע את הצעד הבא לפי הנתונים: איזו הצעה, כמה תשלומים מותר לתת, באיזה ערוץ ומתי (לא בשבת). הודעה פשוטה, כמו «כמה אני חייב?», נענית מיד מהקוד עם הסכום המדויק. הודעה מורכבת עוברת ל-Claude, שמקבל את ההחלטה כהנחיה ולא יכול להמציא הצעה או סכום.'),
    h('div', { class: 'gbd-grid' },
      h('div', { class: 'gbd-col' }, famSel, card,
        h('div', { class: 'gbd-try' }, h('h3', { class: 'gb-sub' }, 'נסו הודעה (לא נשלח כלום)'), h('div', { class: 'gbd-try__row' }, tryIn, tryBtn), tryOut)),
      h('div', { class: 'gbd-col' }, h('h3', { class: 'gb-sub' }, 'החלטות אחרונות'), stats, log)));
}

export default { panel };
