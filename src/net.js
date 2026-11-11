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
  function peerTransport(PeerClass, myId, hostId, options) {
    return new Promise((resolve, reject) => {
      const peer = new PeerClass(myId, options);
      const conns = {};
      const queues = {};
      let handler = null;
      let closeHandler = null;
      const wire = (conn) => {
        conns[conn.peer] = conn;
        conn.on('open', () => {
          conn.isOpen = true;
          (queues[conn.peer] || []).forEach((m) => conn.send(m));
          queues[conn.peer] = [];
        });
        conn.on('data', (m) => { if (handler) handler(conn.peer, m); });
        conn.on('close', () => { delete conns[conn.peer]; if (closeHandler) closeHandler(conn.peer); });
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
        close() { try { peer.destroy(); } catch (e) { /* уже закрыт */ } },
      };
      peer.on('connection', wire);
      peer.on('error', (e) => reject(e));
      peer.on('open', () => {
        if (hostId) wire(peer.connect(hostId, { reliable: true }));
        resolve(t);
      });
    });
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

  const API = { memoryHub, channelTransport, peerTransport, multiTransport, createHost, createClient, roomCode, normalizeCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RPG_NET = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
