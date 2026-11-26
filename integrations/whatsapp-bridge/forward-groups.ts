/**
 * קבוצות מועברות (26.11.2026, «גבאי» — בוט ה-AI של המוסד בקבוצת הורים):
 * קבוצה שרשומה ב-data/forward-groups.json לא מגיעה ל-Claude Code בכלל. כל הודעה בה, וכל הצטרפות/עזיבה,
 * נשלחות ב-HTTP לשירות שמטפל בה (localhost בלבד), והוא עונה בקבוצה דרך /send-text של הגשר.
 * הרישום: { "groups": { "<jid>@g.us": { "name": "...", "url": "http://127.0.0.1:PORT/...", "keyFile": "~/.secrets/x.key" } } }
 * נטען מחדש כשהקובץ משתנה — בלי restart.
 */
import fs from 'fs';
import path from 'path';

interface ForwardGroup { name?: string; url: string; keyFile?: string }
const REG = path.join(__dirname, '../../data/forward-groups.json');
let cache: Record<string, ForwardGroup> = {};
let mtime = 0;

function load(): Record<string, ForwardGroup> {
  try {
    const m = fs.statSync(REG).mtimeMs;
    if (m !== mtime) { cache = JSON.parse(fs.readFileSync(REG, 'utf8')).groups || {}; mtime = m; }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[FWD-GROUP] registry load failed:', e);
  }
  return cache;
}

export function getForwardGroup(chatId: string): ForwardGroup | null {
  if (!chatId || !chatId.endsWith('@g.us')) return null;
  const g = load()[chatId];
  return g && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(g.url) ? g : null;
}

function keyOf(g: ForwardGroup): string {
  if (!g.keyFile) return '';
  try { return fs.readFileSync(g.keyFile.replace(/^~/, process.env.HOME || '/home/user'), 'utf8').trim(); } catch { return ''; }
}

export async function forwardToGroupService(chatId: string, payload: Record<string, unknown>): Promise<void> {
  const g = getForwardGroup(chatId);
  if (!g) return;
  const body = JSON.stringify({ ...payload, group: chatId, k: keyOf(g) });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(g.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10000) });
      if (r.ok) { console.log(`[FWD-GROUP] ${g.name || chatId}: ${payload.type} forwarded`); return; }
      console.error(`[FWD-GROUP] ${g.name || chatId}: service answered ${r.status}`);
      if (r.status < 500) return;
    } catch (e) {
      console.error(`[FWD-GROUP] ${g.name || chatId}: attempt ${attempt} failed:`, (e as Error).message);
    }
    await new Promise((res) => setTimeout(res, 1500 * attempt));
  }
}
