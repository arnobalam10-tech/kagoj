// Kagoj: handwriting recognition relay.
// The iPad 2 (iOS 9) cannot call Google's handwriting-input service directly,
// but it reaches Supabase fine, so the app sends the stroke data here and this
// function forwards it. JWT verification is on: only logged-in users can call it.
const GOOGLE = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8';
const MAX_BYTES = 1_000_000;
const MAX_LINES = 80;

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
  if (req.method !== 'POST') { return reply(405, { error: 'POST only' }); }

  // The gateway has already verified the JWT; also require a signed-in user,
  // not the public anon key that ships with the app.
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'authenticated') { return reply(401, { error: 'Log in to use handwriting to text' }); }
  } catch {
    return reply(401, { error: 'Log in to use handwriting to text' });
  }

  const text = await req.text();
  if (text.length > MAX_BYTES) { return reply(413, { error: 'Selection too large' }); }
  let body: { requests?: unknown[] };
  try { body = JSON.parse(text); } catch { return reply(400, { error: 'Bad JSON' }); }
  if (!body || !Array.isArray(body.requests) || body.requests.length === 0 || body.requests.length > MAX_LINES) {
    return reply(400, { error: 'Expected 1-' + MAX_LINES + ' lines' });
  }

  try {
    const res = await fetch(GOOGLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: 'enable_pre_space', requests: body.requests }),
      signal: AbortSignal.timeout(15000),
    });
    const out = await res.text();
    if (!res.ok) { return reply(502, { error: 'Handwriting service returned ' + res.status }); }
    return new Response(out, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return reply(504, { error: 'Handwriting service unreachable: ' + String((e as Error).message || e) });
  }
});
