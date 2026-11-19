// Cloudflare Worker «rpg-turn»: выдаёт сайту «Лист героя» временные пароли ретранслятора (TURN).
// Секреты в настройках Worker (Settings → Variables and Secrets):
//   TURN_KEY_ID          — Turn Token ID из Cloudflare Realtime → TURN
//   TURN_KEY_API_TOKEN   — API Token оттуда же
// Необязательно: ALLOWED_ORIGINS — доп. адреса сайтов через запятую (например, http://localhost:8080).
// Весь файл вставляется в редактор Worker целиком.

const SITE = 'https://anton-onskul.github.io';
const TTL = 12 * 3600; // пароль живёт 12 часов — хватает на длинную игру

function allowed(origin, env) {
  if (!origin) return false;
  const extra = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin === SITE || extra.includes(origin);
}

function json(body, status, origin) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) h['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers: h });
}

// Порт 53 браузеры блокируют — такие адреса только задерживают соединение.
const no53 = (urls) => [].concat(urls || []).filter((u) => !/:53(\?|$)/.test(u));

export default {
  async fetch(request, env, ctx, fetchImpl) {
    const doFetch = fetchImpl || fetch;
    const origin = request.headers.get('Origin');
    if (!allowed(origin, env)) return json({ error: 'forbidden' }, 403);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400', Vary: 'Origin',
      } });
    }
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'Worker не настроен: нет секретов TURN_KEY_ID / TURN_KEY_API_TOKEN' }, 500, origin);
    const r = await doFetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
    });
    if (!r.ok) return json({ error: `Cloudflare ответил ${r.status}` }, 502, origin);
    const data = await r.json();
    const list = [].concat((data && data.iceServers) || []);
    const iceServers = list.map((s) => Object.assign({}, s, { urls: no53(s.urls) })).filter((s) => s.urls.length);
    return json({ iceServers }, 200, origin);
  },
};
