// הרשמה לקבוצת ההורים של «גבאי»: יוצר כרטיס הורה ומחזיר את הקישור לקבוצת הוואטסאפ
import { qrSvg } from '../admin/sections/fieldwork/qr.js';
const API = '../api/public/gabbai/join';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>';
let classes = [];

function kidRow(n = '', c = '') {
  const d = document.createElement('div'); d.className = 'jn-kid';
  d.innerHTML = `<input aria-label="שם הילד" placeholder="שם הילד" maxlength="20" value="${esc(n)}">
    <select aria-label="כיתה"><option value="">כיתה…</option>${classes.map((x) => `<option${x === c ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
    <button type="button" class="jn-x" aria-label="הסרת הילד">×</button>`;
  d.querySelector('.jn-x').onclick = () => { if ($('#kids').children.length > 1) d.remove(); };
  $('#kids').append(d);
}

function done(r) {
  $('#formCard').hidden = true;
  const box = $('#done'); box.hidden = false;
  const wa = r.invite ? `<a class="jn-wa" href="${esc(r.invite)}" target="_blank" rel="noopener">${WA_ICON} הצטרפות לקבוצה בוואטסאפ</a>` : '<p>הקבוצה עוד לא פתוחה — נסו שוב בעוד רגע.</p>';
  box.innerHTML = r.existing
    ? `<img class="gi gi--big" src="../assets/icons/check.webp" alt=""><h2>המספר הזה כבר רשום אצלנו</h2>
       <p>משפחת ${esc(r.family)} כבר מופיעה ברשימת ההורים. מצטרפים לקבוצה עם אותו טלפון — ו«גבאי» יזהה אתכם.</p>${wa}<div class="jn-qr" id="qr"></div>`
    : `<img class="gi gi--big" src="../assets/icons/party.webp" alt=""><h2>נרשמתם, ${esc(r.parent.split(' ')[0])}!</h2>
       <p>נפתח כרטיס הורה למשפחת ${esc(r.family)}: ${esc(r.kids.join(', '))}. עכשיו מצטרפים לקבוצה — «גבאי» יזהה אתכם לפי הטלפון ויברך אתכם בשם.</p>
       ${wa}<div class="jn-qr" id="qr"></div>
       <span class="jn-code">קוד ההורה שלכם לאזור ההורים: <b class="num">${esc(r.code)}</b></span>
       <a class="jn-more" href="../parent/">לאזור ההורים ←</a>`;
  if (r.invite) { try { const q = $('#qr'); q.append(qrSvg(r.invite, { label: 'קוד QR להצטרפות לקבוצה' })); q.append(Object.assign(document.createElement('span'), { textContent: 'במחשב? סרקו עם הטלפון' })); } catch { /* the button is enough */ } }
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function init() {
  try { const r = await fetch(API, { cache: 'no-store' }); const j = await r.json(); classes = j.classes || []; } catch { classes = ['גן', 'כיתה א׳', 'כיתה ב׳', 'כיתה ג׳', 'כיתה ד׳', 'כיתה ה׳', 'כיתה ו׳', 'כיתה ז׳', 'כיתה ח׳']; }
  kidRow();
  $('#addKid').onclick = () => { if ($('#kids').children.length < 8) kidRow(); };
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#err'); err.hidden = true;
    const fd = new FormData(e.target);
    const kids = [...document.querySelectorAll('.jn-kid')].map((d) => ({ n: d.querySelector('input').value.trim(), c: d.querySelector('select').value }));
    const btn = e.target.querySelector('.jn-go'); btn.disabled = true; btn.textContent = 'רושמים…';
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent: fd.get('parent'), phone: fd.get('phone'), kids }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'משהו השתבש — נסו שוב');
      done(j);
    } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = 'נרשמים ומצטרפים לקבוצה'; }
  };
}
init();
