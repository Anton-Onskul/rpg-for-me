// Связь мастер ↔ игроки: мастер хранит главное состояние, каждый игрок получает свой отфильтрованный вид.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/table.js');
const N = require('../src/net.js');

// Доставка в тестовой сети идёт через таймеры; 30 мс с запасом хватает на цепочку «запрос → ответ».
const tick = () => new Promise((r) => setTimeout(r, 30));

test('мастер и два игрока через тестовую сеть', async () => {
  const hub = N.memoryHub();
  const host = N.createHost(hub.endpoint('gm'), T.newState('dnd5e'));
  host.act({ type: 'scene.add', scene: { name: 'Пещера', w: 500, h: 500 } });
  const a = N.createClient(hub.endpoint('anya'), 'gm', { name: 'Аня' });
  const b = N.createClient(hub.endpoint('boris'), 'gm', { name: 'Борис' });
  await tick();
  assert.equal(host.state.players.anya.name, 'Аня');
  assert.equal(a.view.scenes[0].name, 'Пещера', 'игрок получил стол');

  host.act({ type: 'token.add', token: { name: 'Торин', kind: 'pc', owner: 'anya', x: 25, y: 25 } });
  host.act({ type: 'token.add', token: { name: 'Призрак', kind: 'npc', x: 75, y: 75, hidden: true } });
  await tick();
  const names = (v) => T.activeScene(v).tokens.map((t) => t.name);
  assert.deepEqual(names(a.view), ['Торин']);
  assert.deepEqual(names(b.view), ['Торин']);

  const torin = T.activeScene(host.state).tokens.find((t) => t.name === 'Торин');
  a.act({ type: 'token.move', tokenId: torin.id, x: 125, y: 25 });
  await tick();
  assert.equal(T.activeScene(host.state).tokens.find((t) => t.name === 'Торин').x, 125, 'мастер принял ход');
  assert.equal(T.activeScene(b.view).tokens.find((t) => t.name === 'Торин').x, 125, 'второй игрок увидел');

  const errors = [];
  b.onError = (e) => errors.push(e);
  b.act({ type: 'token.move', tokenId: torin.id, x: 25, y: 25 });
  await tick();
  assert.equal(T.activeScene(host.state).tokens.find((t) => t.name === 'Торин').x, 125, 'чужой ход отклонён');
  assert.equal(errors.length, 1, 'игрок узнал об отказе');

  // игрок не может выдать себя за мастера
  hub.endpoint('evil').send('gm', { t: 'action', action: { type: 'fog.set', enabled: false }, as: 'gm' });
  await tick();
  assert.equal(host.state.players.evil, undefined);
});

test('игрок переподключается и получает актуальное состояние', async () => {
  const hub = N.memoryHub();
  const host = N.createHost(hub.endpoint('gm'), T.newState('dnd5e'));
  host.act({ type: 'scene.add', scene: { name: 'Лес' } });
  const a = N.createClient(hub.endpoint('anya'), 'gm', { name: 'Аня' });
  await tick();
  a.close();
  host.act({ type: 'scene.add', scene: { name: 'Замок' } });
  host.act({ type: 'scene.activate', sceneId: host.state.scenes[1].id });
  const a2 = N.createClient(hub.endpoint('anya'), 'gm', { name: 'Аня' });
  await tick();
  assert.equal(T.activeScene(a2.view).name, 'Замок');
});

test('картинки карт передаются отдельно и один раз', async () => {
  const hub = N.memoryHub();
  const host = N.createHost(hub.endpoint('gm'), T.newState('dnd5e'));
  host.setAsset('map1', 'data:image/png;base64,QUJD');
  host.act({ type: 'scene.add', scene: { name: 'Карта', image: 'map1' } });
  const a = N.createClient(hub.endpoint('anya'), 'gm', { name: 'Аня' });
  await tick();
  assert.equal(a.assets.map1, 'data:image/png;base64,QUJD');
  const sentBefore = hub.count('gm', 'anya', 'asset');
  host.act({ type: 'chat.say', text: 'ещё одно действие' });
  await tick();
  assert.equal(hub.count('gm', 'anya', 'asset'), sentBefore, 'картинка не пересылается заново');
});

test('транспорт PeerJS: адаптер над Peer (на подделке)', async () => {
  // Подделка Peer с тем же интерфейсом, что у PeerJS: on('open'|'connection'), connect(id) -> conn с on('open'|'data'|'close'), send.
  const peers = {};
  class FakeConn {
    constructor(from, to) { this.peer = to; this.from = from; this.h = {}; this.open = false; }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, x) { (this.h[e] || []).forEach((f) => f(x)); }
    send(x) { setTimeout(() => this.other.emit('data', JSON.parse(JSON.stringify(x))), 0); }
  }
  class FakePeer {
    constructor(id) { this.id = id; this.h = {}; peers[id] = this; setTimeout(() => this.emit('open', id), 0); }
    on(e, f) { (this.h[e] = this.h[e] || []).push(f); }
    emit(e, x) { (this.h[e] || []).forEach((f) => f(x)); }
    connect(id) {
      const mine = new FakeConn(this.id, id), theirs = new FakeConn(id, this.id);
      mine.other = theirs; theirs.other = mine; theirs.peer = this.id;
      setTimeout(() => { peers[id].emit('connection', theirs); theirs.emit('open'); mine.emit('open'); }, 0);
      return mine;
    }
    destroy() {}
  }
  const gmT = await N.peerTransport(FakePeer, 'rpg-table-ABCD');
  const host = N.createHost(gmT, T.newState('dnd5e'));
  host.act({ type: 'scene.add', scene: { name: 'Сеть' } });
  const plT = await N.peerTransport(FakePeer, 'rpg-player-1', 'rpg-table-ABCD');
  const c = N.createClient(plT, 'rpg-table-ABCD', { name: 'Аня' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(c.view.scenes[0].name, 'Сеть');
  assert.equal(host.state.players['rpg-player-1'].name, 'Аня');
});

test('код комнаты: читаемый и без похожих символов', () => {
  const code = N.roomCode(() => 0.5);
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(N.normalizeCode(' ab-c d2 '), 'ABCD2');
});

test('игрок с постоянным ключом сохраняет свою фишку при переподключении через другой канал', async () => {
  const hub = N.memoryHub();
  const host = N.createHost(hub.endpoint('gm'), T.newState('dnd5e'));
  host.act({ type: 'scene.add', scene: { name: 'Лес' } });
  const a = N.createClient(hub.endpoint('conn-1'), 'gm', { name: 'Аня', key: 'anya-key' });
  await tick();
  assert.ok(host.state.players['anya-key'], 'игрок записан по ключу, а не по адресу соединения');
  host.act({ type: 'token.add', token: { name: 'Торин', kind: 'pc', owner: 'anya-key' } });
  a.close();
  const a2 = N.createClient(hub.endpoint('conn-2'), 'gm', { name: 'Аня', key: 'anya-key' });
  await tick();
  const torin = T.activeScene(host.state).tokens[0];
  a2.act({ type: 'token.move', tokenId: torin.id, x: 125, y: 25 });
  await tick();
  assert.equal(T.activeScene(host.state).tokens[0].x, 125, 'после переподключения фишка всё ещё её');
  assert.equal(a2.you, 'anya-key');
});

test('мастер принимает игроков сразу по двум каналам', async () => {
  const hub1 = N.memoryHub(), hub2 = N.memoryHub();
  const multi = N.multiTransport([hub1.endpoint('gm')]);
  const host = N.createHost(multi, T.newState('dnd5e'));
  host.act({ type: 'scene.add', scene: { name: 'Двор' } });
  multi.add(hub2.endpoint('gm'));
  const a = N.createClient(hub1.endpoint('a'), 'gm', { name: 'Аня' });
  const b = N.createClient(hub2.endpoint('b'), 'gm', { name: 'Борис' });
  await tick();
  assert.equal(a.view.scenes[0].name, 'Двор');
  assert.equal(b.view.scenes[0].name, 'Двор', 'ответ уходит по тому же каналу, откуда пришёл игрок');
});
