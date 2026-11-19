// Cloudflare Worker: выдаёт сайту временные пароли ретранслятора (TURN). Ключ Cloudflare остаётся в секретах Worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'worker', 'turn.mjs')).href).then((m) => m.default);
const SITE = 'https://anton-onskul.github.io';
const ENV = { TURN_KEY_ID: 'key123', TURN_KEY_API_TOKEN: 'secret456' };
const CF_ANSWER = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u1', credential: 'c1' },
  ],
};

function mockFetch(answer, status = 200) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } }); };
  f.calls = calls;
  return f;
}
const req = (method, origin) => new Request('https://turn.example.workers.dev/', { method, headers: origin ? { Origin: origin } : {} });

test('worker: сайт получает серверы ICE, порт 53 убран, ключ не утекает', async () => {
  const w = await load();
  const f = mockFetch(CF_ANSWER);
  const res = await w.fetch(req('GET', SITE), ENV, {}, f);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
  const body = await res.json();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer secret456');
  assert.ok(JSON.parse(f.calls[0].init.body).ttl >= 3600, 'пароль живёт не меньше часа');
  const urls = body.iceServers.flatMap((s) => [].concat(s.urls));
  assert.ok(urls.length >= 3);
  assert.ok(urls.every((u) => !/:53(\?|$)/.test(u)), 'порт 53 браузеры блокируют');
  const turn = body.iceServers.find((s) => [].concat(s.urls).some((u) => u.startsWith('turn')));
  assert.equal(turn.username, 'u1');
  assert.equal(turn.credential, 'c1');
  assert.ok(!JSON.stringify(body).includes('secret456'));
});

test('worker: предварительный запрос CORS', async () => {
  const w = await load();
  const f = mockFetch(CF_ANSWER);
  const res = await w.fetch(req('OPTIONS', SITE), ENV, {}, f);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), SITE);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /GET/);
  assert.equal(f.calls.length, 0);
});

test('worker: чужие сайты и запросы без Origin получают отказ', async () => {
  const w = await load();
  const f = mockFetch(CF_ANSWER);
  for (const o of ['https://evil.example', 'https://anton-onskul.github.io.evil.example', null]) {
    const res = await w.fetch(req('GET', o), ENV, {}, f);
    assert.equal(res.status, 403, String(o));
  }
  assert.equal(f.calls.length, 0, 'Cloudflare не вызывается');
});

test('worker: дополнительные разрешённые адреса из настроек', async () => {
  const w = await load();
  const res = await w.fetch(req('GET', 'http://localhost:8080'), Object.assign({ ALLOWED_ORIGINS: 'http://localhost:8080, https://x.test' }, ENV), {}, mockFetch(CF_ANSWER));
  assert.equal(res.status, 200);
});

test('worker: старый формат ответа Cloudflare (один объект) тоже понимается', async () => {
  const w = await load();
  const res = await w.fetch(req('GET', SITE), ENV, {}, mockFetch({ iceServers: { urls: ['turn:turn.cloudflare.com:3478', 'turn:turn.cloudflare.com:53'], username: 'u', credential: 'c' } }));
  const body = await res.json();
  assert.ok(Array.isArray(body.iceServers));
  assert.deepEqual(body.iceServers[0].urls, ['turn:turn.cloudflare.com:3478']);
});

test('worker: ошибка Cloudflare → 502, секреты не заданы → 500', async () => {
  const w = await load();
  const bad = await w.fetch(req('GET', SITE), ENV, {}, mockFetch({ errors: ['x'] }, 401));
  assert.equal(bad.status, 502);
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), SITE, 'сайт видит причину');
  assert.match((await bad.json()).error, /401/);
  const none = await w.fetch(req('GET', SITE), {}, {}, mockFetch(CF_ANSWER));
  assert.equal(none.status, 500);
  assert.match((await none.json()).error, /TURN_KEY_ID/);
});
