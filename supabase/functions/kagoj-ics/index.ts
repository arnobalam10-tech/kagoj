// Kagoj: private calendar feed (.ics) for the phone's calendar app.
// GET /functions/v1/kagoj-ics?t=<feed token>
// Calendar apps cannot send a login, so this function does not use a JWT;
// the long random feed token (user_settings.feed_token) is the key. It only
// ever reads, and only that user's dated rows and @date mentions.
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP = 'https://kagoj-three.vercel.app';

type Doc = { id: string; parent_id: string | null; kind: string; title: string; content: unknown; props: Record<string, unknown>; schema: any; settings: any; deleted_at: string | null };

async function rest(path: string) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, { headers: { apikey: SERVICE, Authorization: 'Bearer ' + SERVICE, Accept: 'application/json' } });
  if (!r.ok) { throw new Error('db ' + r.status); }
  return r.json();
}

function esc(s: string) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function fold(line: string) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 74) { return line; }
  const out: string[] = []; let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > 73) { out.push(cur); cur = ' ' + ch; } else { cur += ch; }
  }
  out.push(cur);
  return out.join('\r\n');
}
function plain(html: string) { return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }

// "2026-10-05" or "2026-10-05T09:30" -> parts
function parts(s: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(s || '');
  if (!m) { return null; }
  return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ? +m[4] : null, mi: m[5] ? +m[5] : 0 };
}
const p2 = (n: number) => (n < 10 ? '0' : '') + n;
function dateVal(p: { y: number; mo: number; d: number }) { return p.y + p2(p.mo) + p2(p.d); }
function nextDay(p: { y: number; mo: number; d: number }) { const t = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1)); return t.getUTCFullYear() + p2(t.getUTCMonth() + 1) + p2(t.getUTCDate()); }
function dtVal(p: { y: number; mo: number; d: number; h: number | null; mi: number }) { return dateVal(p) + 'T' + p2(p.h || 0) + p2(p.mi) + '00'; }
function plusHour(p: any) { const t = new Date(Date.UTC(p.y, p.mo - 1, p.d, (p.h || 0) + 1, p.mi)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() }; }
function dayNum(p: any) { return Date.UTC(p.y, p.mo - 1, p.d) / 86400000; }

function event(uid: string, title: string, s: string, e: string | null, remind: number | null, url: string, desc: string, stamp: string) {
  const ps = parts(s); if (!ps) { return null; }
  const pe = e ? parts(e) : null;
  const L = ['BEGIN:VEVENT', 'UID:' + uid + '@kagoj', 'DTSTAMP:' + stamp, 'SUMMARY:' + esc(title || 'Untitled')];
  if (ps.h === null) {
    L.push('DTSTART;VALUE=DATE:' + dateVal(ps), 'DTEND;VALUE=DATE:' + nextDay(pe && dayNum(pe) >= dayNum(ps) ? pe : ps));
  } else {
    L.push('DTSTART:' + dtVal(ps), 'DTEND:' + dtVal(pe && pe.h !== null && dtVal(pe) > dtVal(ps) ? pe : (pe && pe.h === null && dayNum(pe) > dayNum(ps) ? { ...pe, h: 23, mi: 59 } : plusHour(ps))));
  }
  L.push('URL:' + url);
  if (desc) { L.push('DESCRIPTION:' + esc(desc)); }
  if (remind !== null && remind !== undefined && !isNaN(remind)) {
    // all-day items remind at 9:00 on the day
    const mins = ps.h === null ? 9 * 60 - remind : -remind;
    L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title || 'Reminder'), 'TRIGGER:' + (mins < 0 ? '-' : '') + 'PT' + Math.abs(mins) + 'M', 'END:VALARM');
  }
  L.push('END:VEVENT');
  return L.map(fold).join('\r\n');
}

// every rich-text string anywhere in a page's blocks (columns and tables included)
function htmlStrings(v: unknown, out: { html: string; checked: boolean }[], checked = false) {
  if (!v || typeof v !== 'object') { return; }
  if (Array.isArray(v)) { v.forEach((x) => htmlStrings(x, out, checked)); return; }
  const o = v as Record<string, unknown>;
  if (typeof o.html === 'string' && o.html.indexOf('data-date') >= 0) { out.push({ html: o.html, checked: !!o.checked }); }
  for (const k of Object.keys(o)) { if (k !== 'html' && o[k] && typeof o[k] === 'object') { htmlStrings(o[k], out); } }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const t = (url.searchParams.get('t') || '').toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(t)) { return new Response('Not found', { status: 404 }); }
  try {
    const us = await rest('user_settings?select=user_id&feed_token=eq.' + t);
    if (!us.length) { return new Response('Not found', { status: 404 }); }
    const uid = us[0].user_id;
    const docs: Doc[] = await rest('docs?select=id,parent_id,kind,title,content,props,schema,settings,deleted_at&deleted_at=is.null&user_id=eq.' + uid);
    const byId: Record<string, Doc> = {};
    docs.forEach((d) => { byId[d.id] = d; });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const ev: string[] = [];
    for (const d of docs) {
      if (d.kind === 'row' && d.parent_id && byId[d.parent_id] && !(d.settings && d.settings.template)) {
        const db = byId[d.parent_id];
        const props = (db.schema && db.schema.props) || [];
        const dp = props.find((p: any) => p.id === db.schema.calProp && p.type === 'date') || props.find((p: any) => p.type === 'date');
        const v: any = dp ? (d.props || {})[dp.id] : null;
        if (v && v.s && (v.e || v.s) >= cutoff) {
          const st = props.find((p: any) => p.type === 'status');
          const opt = st ? (st.options || []).find((o: any) => o.id === (d.props || {})[st.id]) : null;
          const done = opt && opt.g === 'done';
          const e = event(d.id, (done ? '\u2713 ' : '') + (d.title || 'Untitled'), v.s, v.e || null, typeof v.r === 'number' && !done ? v.r : null, APP + '/#/p/' + d.id, (db.title || 'Database'), stamp);
          if (e) { ev.push(e); }
        }
      }
      if (d.kind === 'page' || d.kind === 'row') {
        const list: { html: string; checked: boolean }[] = [];
        htmlStrings(d.content, list);
        let k = 0;
        for (const b of list) {
          const re = /data-date="([0-9T:\-]+)"( data-remind="1")?/g;
          let m: RegExpExecArray | null;
          const text = plain(b.html.replace(/<span class="mdate[^>]*>[^<]*<\/span>/g, ''));
          while ((m = re.exec(b.html))) {
            if (m[1] < cutoff) { continue; }
            const e = event(d.id + '-' + (k++), (b.checked ? '\u2713 ' : '') + (text || d.title || 'Untitled'), m[1], null, m[2] && !b.checked ? 0 : null, APP + '/#/p/' + d.id, d.title || '', stamp);
            if (e) { ev.push(e); }
          }
        }
      }
      if (ev.length > 3000) { break; }
    }
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kagoj//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Kagoj', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'].concat(ev, ['END:VCALENDAR']).join('\r\n') + '\r\n';
    return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline; filename="kagoj.ics"' } });
  } catch (_e) {
    return new Response('Calendar is not available right now', { status: 503 });
  }
});
