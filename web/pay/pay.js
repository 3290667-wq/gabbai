// דף התשלום של «גבאי» — קישור אישי (?t=) שנשלח בוואטסאפ / במייל / בשיחה. הדגמה: לא מתבצע חיוב אמיתי.
const t = new URLSearchParams(location.search).get('t') || '';
const API = new URL(`../api/public/gabbai/pay/${encodeURIComponent(t)}`, location.href).href;
const ICO = new URL('../assets/icons/', import.meta.url).href;
const I = (n, cls = 'gi') => `<img class="${cls}" src="${ICO}${n}.webp?v=2" alt="" draggable="false">`;
const ils = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`;
const N = (s) => `<span class="num">${s}</span>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('pa');
const crest = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 7c4-1 7 0 10 2 3-2 6-3 10-2v17c-4-1-7 0-10 2-3-2-6-3-10-2z" fill="none" stroke="#1d1405" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 9v17" stroke="#1d1405" stroke-width="2.2"/></svg>`;
const top = (L) => `<header class="pa-top"><div class="pa-crest">${crest}</div><div class="pa-inst"><b>${esc(L.inst)}</b><span>תשלום מאובטח · משפחת ${esc(L.family)}</span></div></header>`;
const parentLink = new URL('../parent/', location.href).href;

function done(L, fund, share) {
  const pct = Math.min(100, Math.round(fund.got / fund.goal * 100));
  root.innerHTML = `${top(L)}
  <section class="pa-card pay-ok">
    ${I('thanks', 'gi gi--big')}
    <h1>התשלום התקבל, תודה!</h1>
    <p>${share ? `בזכותכם נכנסו ${N(ils(share))} לקרן הפינוקים של הילדים.` : 'החשבון עודכן.'} קבלה נשלחה אליכם בוואטסאפ ובמייל.</p>
    <div class="pa-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="pa-bar__fill" id="pf"></div></div>
    <p class="pa-missing">${esc(fund.title)}: נאסף ${N(pct + '%')} · חסרים עוד ${N(ils(fund.goal - fund.got))}</p>
    <div class="btns" style="margin-top:16px"><a class="btn btn-gold" href="${parentLink}">לאזור ההורים</a></div>
  </section>`;
  requestAnimationFrame(() => setTimeout(() => { document.getElementById('pf').style.width = pct + '%'; }, 200));
}

async function boot() {
  let L;
  try { const r = await fetch(API, { cache: 'no-store' }); L = await r.json(); if (!r.ok) throw new Error(L.error); }
  catch (e) { root.innerHTML = `<section class="pa-card"><h2>הקישור לא תקף</h2><p class="hint">${esc(e.message || '')}. אפשר לבקש קישור חדש מהמזכירות.</p></section>`; return; }
  if (L.paid_at) return done(L, L.fund, 0);
  root.innerHTML = `${top(L)}
  <section class="pa-card pay-sum">
    <small>שכר לימוד${L.month ? ` · ${esc(L.month)}` : ''}${L.n ? ` · תשלום ${N(L.n)} מתוך ${N(L.of)}` : ''}</small>
    <div class="amt num">${ils(L.amount)}</div>
    <small>${esc(L.parent)} · ${esc(L.kids.join(', '))}</small>
  </section>
  <section class="pa-card">
    <form id="pf" class="pay-card" novalidate>
      <label class="pa-field">מספר כרטיס<input name="card" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000" maxlength="23" required></label>
      <div class="pay-row">
        <label class="pa-field">תוקף<input name="exp" inputmode="numeric" autocomplete="cc-exp" placeholder="חודש/שנה" maxlength="5"></label>
        <label class="pa-field">3 ספרות בגב הכרטיס<input name="cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4"></label>
      </div>
      <label class="pa-field">תעודת זהות של בעל הכרטיס<input name="id" inputmode="numeric" maxlength="9" placeholder="9 ספרות"></label>
      <p class="pa-err" id="perr" role="alert" hidden></p>
      <button class="btn btn-gold" type="submit">${I('card', 'gi gi--btn')} לתשלום ${ils(L.amount)}</button>
      <p class="pay-safe">${I('shield', 'gi')} דף הדגמה — לא מתבצע חיוב אמיתי. אפשר להקליד כל מספר.</p>
    </form>
  </section>
  <p class="pa-share">${I('heart', 'gi gi--in')} ${N(L.fund.sharePct + '%')} מהתשלום (${N(ils(L.share))}) נכנסים לקרן הפינוקים: ${esc(L.fund.title)}.</p>`;
  const f = document.getElementById('pf');
  f.card.addEventListener('input', () => { const d = f.card.value.replace(/\D/g, '').slice(0, 19); f.card.value = d.replace(/(.{4})/g, '$1 ').trim(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('perr'); err.hidden = true;
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'מעבד תשלום…';
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: f.card.value }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      done(L, j.fund || L.fund, j.share || 0); window.scrollTo(0, 0);
    } catch (x) { err.textContent = x.message || 'התשלום נכשל'; err.hidden = false; b.disabled = false; b.innerHTML = `לתשלום ${ils(L.amount)}`; }
  });
}
boot();
