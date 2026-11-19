// Связь мастер ↔ игроки. Мастер хранит главное состояние и рассылает каждому игроку его вид.
// Транспорты: memoryHub (тесты), channelTransport (окна одного браузера, например экран на ТВ),
// peerTransport (интернет, WebRTC через PeerJS). Интерфейс: { id, send(to, msg), onMessage(fn), onClose(fn), close() }.
(function (root) {
  'use strict';
  const T = (typeof module !== 'undefined' && module.exports) ? require('./table.js') : root.RPG_TABLE;
  const later = (f) => setTimeout(f, 0);

  // ---------- Транспорты ----------
  function memoryHub() {
    const handlers = {};
    const counts = {};
    return {
      endpoint(id) {
        const ep = {
          id,
          send(to, msg) {
            const key = id + '>' + to + '>' + msg.t;
            counts[key] = (counts[key] || 0) + 1;
            const copy = JSON.parse(JSON.stringify(msg));
            later(() => { const h = handlers[to]; if (h) h(id, copy); });
          },
          onMessage(fn) { handlers[id] = fn; },
          onClose() {},
          close() { if (handlers[id]) delete handlers[id]; },
        };
        return ep;
      },
      count(from, to, t) { return counts[from + '>' + to + '>' + t] || 0; },
    };
  }

  /** Окна одного браузера (второй экран, тесты интерфейса). */
  function channelTransport(room, id) {
    const ch = new BroadcastChannel('rpg-table-' + room);
    let handler = null;
    ch.onmessage = (e) => { const m = e.data; if (m && m.to === id && handler) handler(m.from, m.msg); };
    return {
      id,
      send(to, msg) { ch.postMessage({ from: id, to, msg }); },
      onMessage(fn) { handler = fn; },
      onClose() {},
      close() { ch.close(); },
    };
  }

  /** Интернет: PeerJS (WebRTC). PeerClass — конструктор Peer. hostId — к кому подключиться (для игрока). */
  // STUN — узнать свой внешний адрес; TURN — ретранслятор, когда напрямую соединиться нельзя (мобильные сети, NAT оператора).
  // Сейчас — серверы PeerJS по умолчанию, заданные явно, чтобы диагностика проверяла те же, что и подключение.
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ];
  const errType = (e) => (e && (e.type || e.message)) || 'unknown';

  function peerTransport(PeerClass, myId, hostId, options) {
    const o = options || {};
    const log = o.log || null;
    const note = (level, text, data) => { if (log) log.add(level, text, data); };
    return new Promise((resolve, reject) => {
      const peer = new PeerClass(myId, Object.assign({ config: { iceServers: o.iceServers || ICE_SERVERS } }, o.peer || {}));
      let closed = false;
      const conns = {};
      const queues = {};
      let handler = null;
      let closeHandler = null;
      let errorHandler = null;
      let opened = false;
      let reconnectTimer = null;
      const fail = (code) => { if (errorHandler) errorHandler(code); };
      const wire = (conn) => {
        conns[conn.peer] = conn;
        conn.on('open', () => {
          conn.isOpen = true;
          note('info', 'Соединение открыто: ' + conn.peer);
          (queues[conn.peer] || []).forEach((m) => conn.send(m));
          queues[conn.peer] = [];
        });
        conn.on('data', (m) => { if (handler) handler(conn.peer, m); });
        conn.on('close', () => { note('warn', 'Соединение закрыто: ' + conn.peer); delete conns[conn.peer]; if (closeHandler) closeHandler(conn.peer); });
        conn.on('iceStateChanged', (st) => {
          note(st === 'failed' ? 'error' : 'info', 'ICE ' + conn.peer + ': ' + st);
          if (st === 'failed') fail('ice-failed');
        });
        conn.on('error', (e) => { note('error', 'Ошибка соединения ' + conn.peer + ': ' + errType(e), { type: errType(e), message: e && e.message }); fail(errType(e)); });
      };
      const t = {
        id: myId,
        peer,
        send(to, msg) {
          const c = conns[to];
          if (c && c.isOpen) c.send(msg);
          else (queues[to] = queues[to] || []).push(msg);
        },
        onMessage(fn) { handler = fn; },
        onClose(fn) { closeHandler = fn; },
        onError(fn) { errorHandler = fn; },
        close() { closed = true; clearTimeout(reconnectTimer); try { peer.destroy(); } catch (e) { /* уже закрыт */ } },
      };
      peer.on('connection', (c) => { note('info', 'Входящее подключение: ' + c.peer); wire(c); });
      peer.on('error', (e) => {
        const code = errType(e);
        note('error', 'Ошибка PeerJS: ' + code, { type: code, message: e && e.message });
        if (!opened) { const err = new Error(code); err.type = code; reject(err); } else fail(code);
      });
      // Мобильный интернет рвёт связь с сервером подключений — без переподключения новые игроки не найдут стол.
      peer.on('disconnected', () => {
        note('warn', 'Отключение от сервера подключений');
        if (!opened || closed) return;
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (closed || peer.destroyed || !peer.disconnected) return;
          note('info', 'Переподключаюсь к серверу подключений');
          try { peer.reconnect(); } catch (e) { note('error', 'Не удалось переподключиться: ' + errType(e)); }
        }, o.reconnectDelay != null ? o.reconnectDelay : 2000);
      });
      peer.on('open', () => {
        if (closed) return;
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        const firstOpen = !opened;
        opened = true;
        note('info', 'Сервер подключений: на связи как ' + myId);
        if (firstOpen && hostId) { note('info', 'Подключаюсь к ' + hostId); wire(peer.connect(hostId, { reliable: true })); }
        resolve(t);
      });
    });
  }

  /** Повтор открытия, пока сервер держит код стола за прошлым подключением (после перезагрузки — до минуты). */
  async function openWithRetry(open, opts) {
    const o = opts || {};
    const tries = o.tries || 12;
    for (let i = 1; ; i++) {
      try { return await open(); } catch (e) {
        if (errType(e) !== 'unavailable-id' || i >= tries) throw e;
        if (o.onRetry) o.onRetry(i);
        await new Promise((r) => setTimeout(r, o.delay != null ? o.delay : 5000));
      }
    }
  }

  // ---------- Свой ретранслятор: временные пароли от Worker ----------
  const no53 = (urls) => [].concat(urls || []).filter((u) => typeof u === 'string' && !/:53(\?|$)/.test(u));
  /** fetchFn(url) → Response; при любой беде — запасные серверы и причина в error. */
  function fetchIceServers(fetchFn, url, timeoutMs) {
    const fallback = (error) => ({ source: 'default', iceServers: ICE_SERVERS, error });
    if (!url) return Promise.resolve(fallback());
    return new Promise((resolve) => {
      const tm = setTimeout(() => resolve(fallback('timeout')), timeoutMs || 5000);
      const done = (r) => { clearTimeout(tm); resolve(r); };
      Promise.resolve().then(() => fetchFn(url)).then(async (res) => {
        if (!res.ok) return done(fallback('worker ' + res.status));
        const d = await res.json();
        if (!d || !Array.isArray(d.iceServers)) return done(fallback('bad-answer'));
        const list = d.iceServers.map((x) => Object.assign({}, x, { urls: no53(x.urls) })).filter((x) => x.urls.length);
        if (!list.length) return done(fallback('bad-answer'));
        done({ source: 'worker', iceServers: list });
      }).catch((e) => done(fallback((e && e.message) || 'fetch-failed')));
    });
  }

  // ---------- Понятные причины ошибок ----------
  const SERVER_ERR = ['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed', 'load-failed', 'no-peer', 'unavailable-id-timeout', 'disconnected'];
  function explainError(code, room) {
    if (code === 'peer-unavailable') return `Стол с кодом ${room || ''} не найден. Проверьте код и что у мастера открыт стол.`.replace('  ', ' ');
    if (code === 'ice-failed' || code === 'negotiation-failed') return 'Мастер найден, но ваша сеть не пропускает соединение. Нажмите «Проверить связь».';
    if (SERVER_ERR.includes(code)) return 'Не удалось связаться с сервером подключений. Проверьте интернет и нажмите «Проверить связь».';
    if (code === 'no-webrtc' || code === 'browser-incompatible') return 'Этот браузер не поддерживает подключение по интернету. Попробуйте Chrome.';
    if (code === 'inside-claude') return 'Подключение по интернету работает только в версии приложения на сайте.';
    return 'Мастер не найден. Проверьте код и что у мастера открыт стол.';
  }

  // ---------- Журнал связи ----------
  const LOG_KEY = 'netlog';
  function createLog(opts) {
    const o = opts || {};
    const max = o.max || 200;
    const now = o.now || Date.now;
    const storage = o.storage || null;
    let items = [];
    const subs = [];
    if (storage) {
      try { const x = JSON.parse(storage.get(LOG_KEY) || '[]'); if (Array.isArray(x)) items = x.slice(-max); } catch (e) { items = []; }
    }
    const persist = () => { if (storage) { try { storage.set(LOG_KEY, JSON.stringify(items)); } catch (e) { /* нет места */ } } };
    const changed = () => { persist(); subs.forEach((f) => f()); };
    const LV = { info: 'инфо', warn: 'ВНИМАНИЕ', error: 'ОШИБКА' };
    const line = (x) => new Date(x.time).toISOString().replace('T', ' ').slice(0, 19) + ' ' + (LV[x.level] || x.level) + ' ' + x.text
      + (x.data !== undefined ? ' ' + JSON.stringify(x.data) : '');
    return {
      add(level, text, data) {
        const e = { time: now(), level, text: String(text) };
        if (data !== undefined) e.data = data;
        items.push(e);
        if (items.length > max) items = items.slice(-max);
        changed();
        return e;
      },
      list() { return items.slice(); },
      errors() { return items.filter((x) => x.level === 'error'); },
      text() { return items.map(line).join('\n'); },
      line,
      clear() { items = []; changed(); },
      onChange(fn) { subs.push(fn); },
    };
  }

  // ---------- Проверка сети ----------
  /** Собирает ICE-кандидатов: host — локальный адрес, srflx — внешний (STUN), relay — через ретранслятор (TURN). */
  function gatherCandidates(RTC, iceServers, timeoutMs) {
    return new Promise((resolve) => {
      const r = { host: 0, srflx: 0, prflx: 0, relay: 0 };
      let pc;
      let done = false;
      const finish = (extra) => {
        if (done) return; done = true; clearTimeout(timer);
        try { if (pc) pc.close(); } catch (e) { /* уже закрыт */ }
        resolve(Object.assign(r, extra || {}));
      };
      const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
      try {
        pc = new RTC({ iceServers });
        pc.onicecandidate = (e) => {
          if (!e.candidate) { finish(); return; }
          const m = / typ (\w+)/.exec(e.candidate.candidate || '');
          if (m && r[m[1]] !== undefined) r[m[1]]++;
        };
        pc.createDataChannel('probe');
        pc.createOffer().then((d) => pc.setLocalDescription(d)).catch((e) => finish({ error: (e && e.message) || 'offer' }));
      } catch (e) { finish({ error: (e && e.message) || 'rtc' }); }
    });
  }

  function verdict(r) {
    if (!r.webrtc) return { ok: false, text: 'Браузер не поддерживает подключение по интернету (WebRTC). Попробуйте Chrome.' };
    if (!r.peerLib || !r.server) return { ok: false, text: 'Недоступен сервер подключений: его блокирует сеть, провайдер или блокировщик рекламы в браузере.' };
    if (!r.relay) return { ok: true, warning: true, text: 'TURN не подтверждён: прямое соединение может работать, но через некоторые мобильные сети и NAT потребуется ретранслятор. Проверка не устанавливает соединение между игроком и мастером.' };
    return { ok: true, text: 'Связь в порядке: браузер, сервер подключений и ретранслятор работают.' };
  }

  const STEPS = [
    ['webrtc', 'WebRTC в браузере'],
    ['peerLib', 'Библиотека PeerJS загрузилась'],
    ['server', 'Сервер подключений PeerJS отвечает'],
    ['stun', 'Внешний адрес получен (STUN)'],
    ['turn', 'Ретранслятор доступен (TURN)'],
  ];

  /** env: { RTC, loadPeer() → Promise<Peer>, iceServers, timeout, log, onStep(step) } */
  async function runDiagnostics(env) {
    const e = env || {};
    const timeout = e.timeout || 5000;
    const ice = e.iceServers || ICE_SERVERS;
    const steps = STEPS.map(([id, title]) => ({ id, title, ok: null, detail: '' }));
    const S = Object.fromEntries(steps.map((s) => [s.id, s]));
    const set = (id, ok, detail) => { S[id].ok = ok; S[id].detail = detail || ''; if (e.onStep) e.onStep(S[id]); };
    const res = { webrtc: false, peerLib: false, server: false, srflx: false, relay: false };
    if (e.log) e.log.add('info', 'Проверка связи: начало');

    res.webrtc = typeof e.RTC === 'function';
    set('webrtc', res.webrtc, res.webrtc ? '' : 'нет RTCPeerConnection');
    if (res.webrtc) {
      const net = gatherCandidates(e.RTC, ice, timeout);
      let Peer = null;
      try { Peer = await e.loadPeer(); res.peerLib = true; set('peerLib', true); } catch (err) { set('peerLib', false, errType(err)); }
      if (Peer) {
        const r = await new Promise((resolve) => {
          let p;
          const end = (ok, d) => { clearTimeout(tm); try { p.destroy(); } catch (x) { /* уже закрыт */ } resolve({ ok, d }); };
          const tm = setTimeout(() => end(false, 'timeout'), timeout);
          try {
            p = new Peer('rpg-for-me-check-' + Math.random().toString(36).slice(2, 10), { config: { iceServers: ice } });
            p.on('open', () => end(true));
            p.on('error', (x) => end(false, errType(x)));
          } catch (x) { end(false, errType(x)); }
        });
        res.server = r.ok;
        set('server', r.ok, r.d);
      }
      const c = await net;
      res.srflx = c.srflx + c.prflx > 0;
      res.relay = c.relay > 0;
      const d = `host ${c.host}, srflx ${c.srflx}, relay ${c.relay}${c.timedOut ? ', не дождался конца' : ''}${c.error ? ', ' + c.error : ''}`;
      set('stun', res.srflx, d);
      set('turn', res.relay, d);
    }
    const v = verdict(res);
    if (e.log) e.log.add(!v.ok ? 'error' : v.warning ? 'warn' : 'info', 'Проверка связи: ' + v.text, { steps: steps.map((s) => s.id + ':' + s.ok + (s.detail ? ' (' + s.detail + ')' : '')) });
    return { steps, verdict: v, result: res };
  }

  function report(r, opts) {
    const o = opts || {};
    const mark = (ok) => (ok === true ? '✓' : ok === false ? '✗' : '–');
    const lines = [
      'Проверка связи «Лист героя»',
      'Время: ' + new Date(o.now || Date.now()).toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      'Браузер: ' + (o.ua || ''),
      '',
      ...r.steps.map((s) => `${mark(s.ok)} ${s.title}${s.detail ? ' — ' + s.detail : ''}`),
      '',
      'Итог: ' + r.verdict.text,
    ];
    if (o.log && o.log.list().length) lines.push('', 'Журнал:', o.log.text());
    return lines.join('\n');
  }

  /** Несколько каналов сразу (окна этого браузера + интернет): ответ уходит туда, откуда пришёл игрок. */
  function multiTransport(list) {
    const origin = {};
    let handler = null;
    let closeHandler = null;
    const all = [];
    const t = {
      id: 'gm',
      add(tr) {
        all.push(tr);
        tr.onMessage((from, msg) => { origin[from] = tr; if (handler) handler(from, msg); });
        tr.onClose((pid) => { if (origin[pid] === tr) { delete origin[pid]; if (closeHandler) closeHandler(pid); } });
      },
      send(to, msg) { const tr = origin[to]; if (tr) tr.send(to, msg); },
      onMessage(fn) { handler = fn; },
      onClose(fn) { closeHandler = fn; },
      close() { all.forEach((tr) => tr.close()); },
    };
    (list || []).forEach((tr) => t.add(tr));
    return t;
  }

  // ---------- Мастер ----------
  function createHost(transport, state) {
    const host = {
      state,
      assets: {},
      peers: {},          // адрес соединения -> { actor: id игрока, sent: Set(id картинок) }
      onChange: null,
      act(action) {
        const r = T.apply(host.state, action, { role: 'gm', id: 'gm' });
        if (r.ok) { host.state = r.state; broadcast(); }
        return r;
      },
      setAsset(id, data) { host.assets[id] = data; },
      replace(state, assets) { host.state = state; if (assets) host.assets = assets; Object.values(host.peers).forEach((p) => { p.sent = new Set(); }); broadcast(); },
      close() { transport.close(); },
    };
    function neededAssets(view) {
      const ids = new Set();
      view.scenes.forEach((sc) => { if (sc.image) ids.add(sc.image); sc.tokens.forEach((t) => { if (t.img) ids.add(t.img); }); });
      return Array.from(ids).filter((id) => host.assets[id]);
    }
    function sendTo(pid) {
      const p = host.peers[pid];
      if (!p) return;
      const view = T.viewFor(host.state, { role: 'player', id: p.actor });
      for (const id of neededAssets(view)) {
        if (!p.sent.has(id)) { transport.send(pid, { t: 'asset', id, data: host.assets[id] }); p.sent.add(id); }
      }
      transport.send(pid, { t: 'state', view, you: p.actor });
    }
    function broadcast() {
      Object.keys(host.peers).forEach(sendTo);
      if (host.onChange) host.onChange(host.state);
    }
    transport.onMessage((from, msg) => {
      if (!msg || typeof msg !== 'object' || from === 'gm' && transport.id === 'gm') return;
      // Кем бы ни назвался отправитель, он — игрок. Постоянный ключ устройства сохраняет его фишки при переподключении.
      if (msg.t === 'hello') {
        const key = typeof msg.key === 'string' && /^[\w-]{4,64}$/.test(msg.key) ? msg.key : from;
        const actor = { role: 'player', id: key };
        const r = T.apply(host.state, { type: 'player.join', name: msg.name }, actor);
        if (!r.ok) { transport.send(from, { t: 'error', error: r.error }); return; }
        host.state = r.state;
        host.peers[from] = { actor: key, sent: new Set() };
        broadcast();
      } else if (msg.t === 'action') {
        if (!host.peers[from]) { transport.send(from, { t: 'error', error: 'Сначала присоединитесь к столу' }); return; }
        const action = Object.assign({}, msg.action);
        delete action.rng;
        const r = T.apply(host.state, action, { role: 'player', id: host.peers[from].actor });
        if (!r.ok) { transport.send(from, { t: 'error', error: r.error }); return; }
        host.state = r.state;
        broadcast();
      }
    });
    transport.onClose((pid) => { delete host.peers[pid]; if (host.onChange) host.onChange(host.state); });
    return host;
  }

  // ---------- Игрок ----------
  function createClient(transport, hostId, me) {
    const c = {
      view: null,
      you: transport.id,
      assets: {},
      onChange: null,
      onError: null,
      act(action) { transport.send(hostId, { t: 'action', action }); },
      close() { transport.close(); },
    };
    transport.onMessage((from, msg) => {
      if (from !== hostId || !msg) return;
      if (msg.t === 'asset') c.assets[msg.id] = msg.data;
      else if (msg.t === 'state') { c.view = msg.view; c.you = msg.you || c.you; if (c.onChange) c.onChange(c.view); }
      else if (msg.t === 'error' && c.onError) c.onError(msg.error);
    });
    transport.onClose(() => { if (c.onError) c.onError('Связь с мастером потеряна'); });
    transport.send(hostId, { t: 'hello', name: me && me.name, key: me && me.key });
    return c;
  }

  // ---------- Код комнаты ----------
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function roomCode(rng) {
    const r = rng || Math.random;
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPHA[Math.floor(r() * ALPHA.length) % ALPHA.length];
    return s;
  }
  const normalizeCode = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const API = { memoryHub, channelTransport, peerTransport, multiTransport, createHost, createClient, roomCode, normalizeCode,
    ICE_SERVERS, explainError, openWithRetry, fetchIceServers, createLog, gatherCandidates, verdict, runDiagnostics, report };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RPG_NET = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
