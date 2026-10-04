// Kagoj: web bookmark previews. Fetches a page and returns its title,
// description and site name (Open Graph tags when present).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Max-Age': '86400',
};
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
function meta(html: string, names: string[]): string {
  for (const n of names) {
    const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + n + '["\']', 'i');
    const m = re1.exec(html) || re2.exec(html);
    if (m && m[1]) { return decode(m[1]); }
  }
  return '';
}
function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') { return new Response(null, { status: 204, headers: cors }); }
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'authenticated') { return reply(401, { error: 'Log in first' }); }
  } catch { return reply(401, { error: 'Log in first' }); }
  let url = '';
  try { url = String((await req.json()).url || ''); } catch { return reply(400, { error: 'Bad request' }); }
  if (!/^https?:\/\//i.test(url) || url.length > 2000) { return reply(400, { error: 'Not a web link' }); }
  const host = new URL(url).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith('.internal')) { return reply(400, { error: 'Not allowed' }); }
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Kagoj link preview)', 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) { return reply(200, { title: decodeURIComponent(url.split('/').pop() || host), description: '', site: host }); }
    const html = (await res.text()).slice(0, 300000);
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return reply(200, {
      title: meta(html, ['og:title', 'twitter:title']) || (t ? decode(t[1]) : host),
      description: meta(html, ['og:description', 'description', 'twitter:description']).slice(0, 300),
      site: meta(html, ['og:site_name']) || host,
    });
  } catch (e) {
    return reply(200, { title: host, description: '', site: host });
  }
});
