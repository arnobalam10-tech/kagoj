// Kagoj: fetches a subscribed iCal calendar (Google "secret address",
// university timetable, ...) for the app, which can't fetch other sites itself.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response(null, { status: 204, headers: cors }); }
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'authenticated') { return reply(401, { error: 'Log in first' }); }
  } catch { return reply(401, { error: 'Log in first' }); }
  let url = '';
  try { url = String((await req.json()).url || '').trim().replace(/^webcal:\/\//i, 'https://'); } catch { return reply(400, { error: 'Bad request' }); }
  if (!/^https?:\/\//i.test(url) || url.length > 2000) { return reply(400, { error: 'Not a calendar link' }); }
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/.test(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    return reply(400, { error: 'Not allowed' });
  }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Kagoj calendar', Accept: 'text/calendar, text/plain, */*' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!res.ok) { return reply(200, { error: 'That calendar answered with error ' + res.status + '.' }); }
    const text = (await res.text()).slice(0, 4000000);
    if (text.indexOf('BEGIN:VCALENDAR') < 0) { return reply(200, { error: 'That link is not an iCal calendar (.ics).' }); }
    return reply(200, { text });
  } catch {
    return reply(200, { error: 'Could not reach that calendar.' });
  }
});
