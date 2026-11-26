// יוצר פעם אחת את קבוצת ההורים של «גבאי» (הקו העסקי + עמיחי), שומר jid+קישור הזמנה ב-data/gabbai-wa.json
// ורושם אותה בגשר (data/forward-groups.json) כך שכל הודעה/הצטרפות עוברת לשרת גבאי (:3096) ולא ל-Claude Code.
const fs = require('fs'); const path = require('path'); const H = process.env.HOME;
const env = Object.fromEntries(fs.readFileSync(path.join(H, 'whatsapp-claude-bridge/.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const API = env.EVOLUTION_API_URL || 'http://localhost:8080'; const INST = env.EVOLUTION_INSTANCE || 'amichai'; const KEY = env.EVOLUTION_API_KEY;
const WFILE = path.join(H, 'gabbai-demo/system/data/gabbai-wa.json'); const FWD = path.join(H, 'whatsapp-claude-bridge/data/forward-groups.json');
const evo = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + t.slice(0, 300)); return JSON.parse(t); };
(async () => {
  const W = fs.existsSync(WFILE) ? JSON.parse(fs.readFileSync(WFILE, 'utf8')) : {};
  if (!W.group) {
    const name = 'הורי «אור התורה» · גבאי';
    const g = await evo('POST', `/group/create/${INST}`, { subject: name, description: 'הקבוצה הרשמית של הורי תלמוד תורה «אור התורה». «גבאי» — העוזר הדיגיטלי של המוסד — עונה כאן לכל הורה באופן אישי: תשלומים, הילדים, קרן הפינוקים. (הדגמה)', participants: ['972500000001'] });
    const jid = g.id || g.groupJid || g?.group?.id; if (!jid) throw new Error('no jid ' + JSON.stringify(g).slice(0, 200));
    W.group = { jid, name, created: new Date().toISOString() };
    try { await evo('POST', `/group/updateGroupPicture/${INST}?groupJid=${encodeURIComponent(jid)}`, { image: fs.readFileSync(path.join(__dirname, 'group-logo.jpg')).toString('base64') }); } catch (e) { console.error('picture:', e.message); }
  }
  const inv = await evo('GET', `/group/inviteCode/${INST}?groupJid=${encodeURIComponent(W.group.jid)}`);
  W.group.invite = inv.inviteCode || String(inv.inviteUrl || '').split('/').pop();
  fs.writeFileSync(WFILE, JSON.stringify(W, null, 1));
  const R = fs.existsSync(FWD) ? JSON.parse(fs.readFileSync(FWD, 'utf8')) : { groups: {} };
  R.groups[W.group.jid] = { name: 'gabbai-parents', url: 'http://127.0.0.1:3096/api/public/gabbai/wa/in', keyFile: '~/.secrets/gabbai-wa.key' };
  fs.writeFileSync(FWD, JSON.stringify(R, null, 2));
  console.log(JSON.stringify({ jid: W.group.jid, invite: `https://chat.whatsapp.com/${W.group.invite}` }));
})().catch((e) => { console.error(e.message); process.exit(1); });
