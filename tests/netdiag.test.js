// Диагностика связи по интернету: причины ошибок, журнал, проверка сети, итог и отчёт.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/net.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Подделки ----------
/** Подделка PeerJS: поведение задаётся сценарием. */
function fakePeerClass(script = {}) {
  const made = [];
  class FakeConn {
    constructor(peer) { this.peer = peer; this.h = {}; }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, x) { (this.h[e] || []).forEach((f) => f(x)); }
    send() {}
    close() {}
  }
  class FakePeer {
    constructor(id, options) {
      this.id = id; this.options = options; this.h = {}; this.destroyed = false; made.push(this);
      if (script.openError) setTimeout(() => this.emit('error', Object.assign(new Error('x'), { type: script.openError })), 0);
      else if (!script.neverOpen) setTimeout(() => this.emit('open', id), 0);
    }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, x) { (this.h[e] || []).forEach((f) => f(x)); }
    connect(id) { const c = new FakeConn(id); this.lastConn = c; return c; }
    destroy() { this.destroyed = true; }
  }
  FakePeer.made = made;
  return FakePeer;
}

/** Подделка RTCPeerConnection: выдаёт кандидатов заданных типов. */
function fakeRTC(types, opts = {}) {
  return class {
    constructor(cfg) { this.cfg = cfg; this.iceGatheringState = 'new'; if (opts.throws) throw new Error('blocked'); }
    createDataChannel() { return {}; }
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async setLocalDescription() {
      setTimeout(() => {
        types.forEach((t, i) => this.onicecandidate && this.onicecandidate({ candidate: { candidate: `candidate:${i} 1 udp 1 10.0.0.${i} 5000 typ ${t}` } }));
        if (!opts.noEnd) { this.iceGatheringState = 'complete'; if (this.onicecandidate) this.onicecandidate({ candidate: null }); }
      }, 0);
    }
    close() { this.closed = true; }
  };
}

// ---------- Причины ошибок ----------
test('explainError: понятное сообщение для каждой причины', () => {
  assert.match(N.explainError('peer-unavailable', 'ABC234'), /Стол с кодом ABC234 не найден/);
  assert.match(N.explainError('ice-failed'), /Мастер найден, но ваша сеть не пропускает соединение/);
  assert.match(N.explainError('ice-failed'), /Проверить связь/);
  for (const c of ['network', 'server-error', 'socket-error', 'socket-closed', 'load-failed', 'no-peer', 'unavailable-id-timeout']) {
    assert.match(N.explainError(c), /Не удалось связаться с сервером подключений/, c);
  }
  for (const c of ['no-webrtc', 'browser-incompatible']) assert.match(N.explainError(c), /не поддерживает подключение по интернету/, c);
  assert.match(N.explainError('timeout'), /Мастер не найден/);
  assert.match(N.explainError('inside-claude'), /на сайте/);
  assert.match(N.explainError('что-то новое'), /Мастер не найден/);
});

// ---------- Журнал ----------
test('журнал: записи со временем и уровнем, ограничение размера', () => {
  let t = Date.UTC(2026, 10, 19, 7, 5, 9);
  const log = N.createLog({ max: 3, now: () => t });
  const seen = [];
  log.onChange(() => seen.push(log.list().length));
  log.add('info', 'старт');
  t += 1000;
  log.add('error', 'сбой', { type: 'network' });
  log.add('warn', 'третья');
  log.add('error', 'четвёртая');
  const l = log.list();
  assert.equal(l.length, 3, 'старые записи вытесняются');
  assert.equal(l[0].text, 'сбой');
  assert.equal(l[0].level, 'error');
  assert.deepEqual(l[0].data, { type: 'network' });
  assert.equal(typeof l[0].time, 'number');
  assert.deepEqual(seen, [1, 2, 3, 3]);
  assert.equal(log.errors().length, 2, 'отдельно — только ошибки');
  const txt = log.text();
  assert.match(txt, /ОШИБКА сбой/);
  assert.match(txt, /"type":"network"/);
  assert.equal(txt.split('\n').length, 3);
  log.clear();
  assert.equal(log.list().length, 0);
});

test('журнал сохраняется в хранилище и восстанавливается после перезагрузки', () => {
  const store = {};
  const storage = { get: (k) => store[k] ?? null, set: (k, v) => { store[k] = v; } };
  const a = N.createLog({ storage });
  a.add('error', 'мастер не найден');
  const b = N.createLog({ storage });
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0].text, 'мастер не найден');
  // испорченные данные не ломают журнал
  store[Object.keys(store)[0]] = '{не json';
  assert.equal(N.createLog({ storage }).list().length, 0);
});

// ---------- Транспорт PeerJS: ошибки не теряются ----------
test('peerTransport: серверы ICE передаются в Peer', async () => {
  const P = fakePeerClass();
  await N.peerTransport(P, 'me');
  const ice = P.made[0].options.config.iceServers;
  assert.ok(ice.length >= 2, 'есть STUN и TURN');
  assert.deepEqual(ice, N.ICE_SERVERS);
});

test('peerTransport: ошибка после подключения к серверу доходит до onError и в журнал', async () => {
  const P = fakePeerClass();
  const log = N.createLog();
  const t = await N.peerTransport(P, 'pl', 'host', { log });
  const errs = [];
  t.onError((code) => errs.push(code));
  P.made[0].emit('error', Object.assign(new Error('Could not connect to peer host'), { type: 'peer-unavailable' }));
  assert.deepEqual(errs, ['peer-unavailable']);
  assert.ok(log.errors().some((e) => /peer-unavailable/.test(JSON.stringify(e))), 'ошибка записана в журнал');
});

test('peerTransport: обрыв ICE на соединении → ice-failed', async () => {
  const P = fakePeerClass();
  const log = N.createLog();
  const t = await N.peerTransport(P, 'pl', 'host', { log });
  const errs = [];
  t.onError((code) => errs.push(code));
  const conn = P.made[0].lastConn;
  conn.emit('iceStateChanged', 'checking');
  conn.emit('iceStateChanged', 'failed');
  assert.deepEqual(errs, ['ice-failed']);
  assert.ok(log.list().some((e) => /checking/.test(e.text)), 'смены состояния тоже в журнале');
  conn.emit('error', Object.assign(new Error('negotiation'), { type: 'negotiation-failed' }));
  assert.equal(errs[1], 'negotiation-failed');
});

test('peerTransport: ошибка до подключения к серверу отклоняет промис с кодом', async () => {
  const P = fakePeerClass({ openError: 'network' });
  await assert.rejects(N.peerTransport(P, 'pl'), (e) => e.type === 'network' || e.message === 'network');
});

// ---------- Проверка сети ----------
test('gatherCandidates: считает кандидатов по типам', async () => {
  const r = await N.gatherCandidates(fakeRTC(['host', 'srflx', 'srflx', 'relay']), N.ICE_SERVERS, 500);
  assert.deepEqual({ host: r.host, srflx: r.srflx, relay: r.relay }, { host: 1, srflx: 2, relay: 1 });
  assert.equal(r.error, undefined);
});

test('gatherCandidates: не зависает, если сбор не закончился', async () => {
  const t0 = Date.now();
  const r = await N.gatherCandidates(fakeRTC(['host'], { noEnd: true }), [], 60);
  assert.ok(Date.now() - t0 < 400);
  assert.equal(r.host, 1);
  assert.equal(r.timedOut, true);
});

test('gatherCandidates: браузер не дал создать соединение', async () => {
  const r = await N.gatherCandidates(fakeRTC([], { throws: true }), [], 100);
  assert.equal(r.error, 'blocked');
});

test('verdict: итог по результатам проверки', () => {
  assert.match(N.verdict({ webrtc: false }).text, /не поддерживает/);
  assert.match(N.verdict({ webrtc: true, peerLib: false }).text, /сервер подключений/);
  assert.match(N.verdict({ webrtc: true, peerLib: true, server: false }).text, /сервер подключений/);
  const noTurn = N.verdict({ webrtc: true, peerLib: true, server: true, srflx: true, relay: false });
  assert.equal(noTurn.ok, false);
  assert.match(noTurn.text, /ретранслятор/);
  assert.match(N.verdict({ webrtc: true, peerLib: true, server: true, srflx: false, relay: false }).text, /ретранслятор/);
  const ok = N.verdict({ webrtc: true, peerLib: true, server: true, srflx: true, relay: true });
  assert.equal(ok.ok, true);
  assert.match(ok.text, /в порядке/);
});

test('runDiagnostics: всё работает', async () => {
  const P = fakePeerClass();
  const log = N.createLog();
  const progress = [];
  const r = await N.runDiagnostics({ RTC: fakeRTC(['host', 'srflx', 'relay']), loadPeer: async () => P, timeout: 200, log, onStep: (s) => progress.push(s.id) });
  assert.deepEqual(r.steps.map((s) => s.id), ['webrtc', 'peerLib', 'server', 'stun', 'turn']);
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps));
  assert.equal(r.verdict.ok, true);
  assert.ok(P.made.every((p) => p.destroyed), 'проверочный Peer закрыт');
  assert.ok(progress.length >= 5, 'интерфейс получает шаги по ходу');
  assert.ok(log.list().length >= 1, 'итог пишется в журнал');
});

test('runDiagnostics: нет WebRTC — остальное не проверяется', async () => {
  const r = await N.runDiagnostics({ RTC: undefined, loadPeer: async () => fakePeerClass(), timeout: 100 });
  assert.equal(r.steps[0].ok, false);
  assert.ok(r.steps.slice(1).every((s) => s.ok === null), 'пропущены');
  assert.match(r.verdict.text, /не поддерживает/);
});

test('runDiagnostics: PeerJS не загрузился', async () => {
  const r = await N.runDiagnostics({ RTC: fakeRTC(['host', 'srflx']), loadPeer: async () => { throw new Error('load-failed'); }, timeout: 100 });
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.peerLib.ok, false);
  assert.match(s.peerLib.detail, /load-failed/);
  assert.equal(s.server.ok, null);
  assert.equal(s.stun.ok, true, 'STUN проверяется и без PeerJS');
  assert.match(r.verdict.text, /сервер подключений/);
});

test('runDiagnostics: сервер PeerJS молчит — шаг падает по таймауту', async () => {
  const t0 = Date.now();
  const r = await N.runDiagnostics({ RTC: fakeRTC(['host', 'srflx']), loadPeer: async () => fakePeerClass({ neverOpen: true }), timeout: 80 });
  const s = r.steps.find((x) => x.id === 'server');
  assert.equal(s.ok, false);
  assert.match(s.detail, /timeout/);
  assert.ok(Date.now() - t0 < 1000);
});

test('runDiagnostics: есть STUN, нет TURN — нужен ретранслятор', async () => {
  const r = await N.runDiagnostics({ RTC: fakeRTC(['host', 'srflx']), loadPeer: async () => fakePeerClass(), timeout: 100 });
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.stun.ok, true);
  assert.equal(s.turn.ok, false);
  assert.match(r.verdict.text, /ретранслятор/);
});

test('report: текст отчёта для пересылки', async () => {
  const log = N.createLog();
  log.add('error', 'peer-unavailable');
  const r = await N.runDiagnostics({ RTC: fakeRTC(['host', 'srflx']), loadPeer: async () => fakePeerClass(), timeout: 100 });
  const txt = N.report(r, { ua: 'TestBrowser/1.0', log, now: Date.UTC(2026, 10, 19) });
  assert.match(txt, /TestBrowser\/1\.0/);
  assert.match(txt, /2026-11-19/);
  assert.match(txt, /✓ .*WebRTC/);
  assert.match(txt, /✗ .*ретранслятор/i);
  assert.ok(txt.includes("Итог: " + r.verdict.text), "итог в отчёте");
  assert.match(txt, /peer-unavailable/, 'журнал попадает в отчёт');
});
