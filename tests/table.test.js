// Стол мастера: кубики, сетка, туман войны, бой, права и то, что видит игрок.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/table.js');

// Предсказуемый «кубик»: отдаёт значения по очереди (1..sides).
const seq = (...vals) => { let i = 0; return (sides) => { const v = vals[i++ % vals.length]; return Math.min(v, sides); }; };
const GM = { role: 'gm', id: 'gm' };
const P1 = { role: 'player', id: 'p1' };
const P2 = { role: 'player', id: 'p2' };
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.state; };

// ---------- Кубики ----------
test('кубики: разбор записи', () => {
  assert.deepEqual(T.dice.parse('1к20+5'), { terms: [{ count: 1, sides: 20, sign: 1 }], mod: 5, mode: 'normal' });
  assert.deepEqual(T.dice.parse('2d6-1'), { terms: [{ count: 2, sides: 6, sign: 1 }], mod: -1, mode: 'normal' });
  assert.deepEqual(T.dice.parse('к20'), { terms: [{ count: 1, sides: 20, sign: 1 }], mod: 0, mode: 'normal' });
  assert.deepEqual(T.dice.parse('1d8 + 1d6 + 3'), { terms: [{ count: 1, sides: 8, sign: 1 }, { count: 1, sides: 6, sign: 1 }], mod: 3, mode: 'normal' });
  assert.equal(T.dice.parse('1к20+3 преим').mode, 'adv');
  assert.equal(T.dice.parse('d20 adv').mode, 'adv');
  assert.equal(T.dice.parse('1к20 помеха').mode, 'dis');
  assert.equal(T.dice.parse('3d6').terms[0].count, 3);
  for (const bad of ['', 'привет', '0d6', '1d1', '1000d6', '1d6+', 'd', '2к6 преим']) assert.equal(T.dice.parse(bad), null, `«${bad}»`);
});

test('кубики: бросок, преимущество и помеха', () => {
  const r = T.dice.roll('2к6+3', seq(4, 5));
  assert.equal(r.total, 12);
  assert.deepEqual(r.parts[0].rolls, [4, 5]);
  const adv = T.dice.roll('1к20+2 преим', seq(7, 15));
  assert.equal(adv.total, 17, 'берётся больший');
  assert.deepEqual(adv.parts[0].rolls, [7, 15]);
  const dis = T.dice.roll('1к20+2 помеха', seq(7, 15));
  assert.equal(dis.total, 9, 'берётся меньший');
  assert.equal(T.dice.roll('1к20', seq(20)).crit, 'hit');
  assert.equal(T.dice.roll('1к20', seq(1)).crit, 'miss');
  assert.equal(T.dice.roll('2к6', seq(1, 1)).crit, null, 'крит только у к20');
  assert.equal(T.dice.roll('ерунда', seq(1)), null);
  const real = T.dice.roll('3к6');
  assert.ok(real.total >= 3 && real.total <= 18);
});

// ---------- Сетка ----------
test('сетка: клетка, привязка и расстояние', () => {
  const grid = { size: 50, offsetX: 0, offsetY: 0 };
  assert.deepEqual(T.grid.cellOf(125, 49, grid), { c: 2, r: 0 });
  assert.deepEqual(T.grid.snap(130, 70, grid), { x: 125, y: 75 }, 'центр клетки');
  assert.equal(T.grid.distanceFeet({ c: 0, r: 0 }, { c: 3, r: 1 }), 15, 'D&D: диагональ как одна клетка, 5 фт');
  assert.equal(T.grid.distanceFeet({ c: 2, r: 2 }, { c: 2, r: 2 }), 0);
  assert.deepEqual(T.grid.cellOf(-10, 10, grid), { c: -1, r: 0 });
});

// ---------- Состояние и сцены ----------
test('сцены: создание, активная сцена, только мастер', () => {
  let s = T.newState('dnd5e');
  assert.equal(s.scenes.length, 0);
  s = ok(T.apply(s, { type: 'scene.add', scene: { name: 'Таверна', w: 1000, h: 800 } }, GM));
  assert.equal(s.scenes.length, 1);
  assert.equal(s.activeSceneId, s.scenes[0].id, 'первая сцена сразу активна');
  s = ok(T.apply(s, { type: 'scene.add', scene: { name: 'Подземелье' } }, GM));
  const dungeon = s.scenes[1];
  assert.equal(s.activeSceneId, s.scenes[0].id, 'вторая не переключает');
  s = ok(T.apply(s, { type: 'scene.activate', sceneId: dungeon.id }, GM));
  assert.equal(s.activeSceneId, dungeon.id);
  const r = T.apply(s, { type: 'scene.add', scene: { name: 'Хак' } }, P1);
  assert.equal(r.ok, false, 'игрок не создаёт сцены');
  assert.equal(T.apply(s, { type: 'nonsense' }, GM).ok, false);
});

test('apply не меняет исходное состояние', () => {
  const s0 = T.newState('dnd5e');
  const s1 = ok(T.apply(s0, { type: 'scene.add', scene: { name: 'A' } }, GM));
  assert.equal(s0.scenes.length, 0);
  assert.equal(s1.scenes.length, 1);
});

function table() {
  let s = T.newState('dnd5e');
  s = ok(T.apply(s, { type: 'scene.add', scene: { name: 'Пещера', w: 500, h: 500, grid: { size: 50 } } }, GM));
  s = ok(T.apply(s, { type: 'player.join', name: 'Аня' }, P1));
  s = ok(T.apply(s, { type: 'player.join', name: 'Борис' }, P2));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Торин', kind: 'pc', owner: 'p1', x: 25, y: 25, hp: 12, hpMax: 12, ac: 16 } }, GM));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Гоблин', kind: 'npc', x: 225, y: 225, hp: 7, hpMax: 7, ac: 15 } }, GM));
  return s;
}
const tok = (s, name) => T.activeScene(s).tokens.find((t) => t.name === name);

// ---------- Фишки и права ----------
test('фишки: игрок двигает только свою, мастер — любую', () => {
  let s = table();
  const torin = tok(s, 'Торин'), gob = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'token.move', tokenId: torin.id, x: 130, y: 70 }, P1));
  assert.deepEqual([tok(s, 'Торин').x, tok(s, 'Торин').y], [125, 75], 'привязка к центру клетки');
  assert.equal(T.apply(s, { type: 'token.move', tokenId: gob.id, x: 0, y: 0 }, P1).ok, false, 'чужую нельзя');
  assert.equal(T.apply(s, { type: 'token.move', tokenId: torin.id, x: 0, y: 0 }, P2).ok, false, 'фишку другого игрока нельзя');
  s = ok(T.apply(s, { type: 'token.move', tokenId: gob.id, x: 75, y: 75 }, GM));
  assert.equal(T.apply(s, { type: 'token.update', tokenId: gob.id, patch: { hp: 0 } }, P1).ok, false, 'игрок не меняет хиты монстра');
  s = ok(T.apply(s, { type: 'token.update', tokenId: gob.id, patch: { hp: 3 } }, GM));
  assert.equal(tok(s, 'Гоблин').hp, 3);
  assert.equal(T.apply(s, { type: 'token.move', tokenId: torin.id, x: 9999, y: 25 }, P1).ok, false, 'за край карты нельзя');
});

test('игрок видит: скрытые фишки и туман', () => {
  let s = table();
  const gob = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'token.update', tokenId: gob.id, patch: { hidden: true } }, GM));
  let v = T.viewFor(s, P1);
  assert.ok(!T.activeScene(v).tokens.some((t) => t.name === 'Гоблин'), 'скрытая фишка не видна игроку');
  assert.ok(T.activeScene(T.viewFor(s, GM)).tokens.some((t) => t.name === 'Гоблин'), 'мастер видит');
  s = ok(T.apply(s, { type: 'token.update', tokenId: gob.id, patch: { hidden: false } }, GM));
  // туман: гоблин в клетке (4,4) не открыт
  s = ok(T.apply(s, { type: 'fog.set', enabled: true }, GM));
  v = T.viewFor(s, P1);
  assert.ok(!T.activeScene(v).tokens.some((t) => t.name === 'Гоблин'), 'монстр в тумане не виден');
  assert.ok(T.activeScene(v).tokens.some((t) => t.name === 'Торин'), 'свои герои видны всегда');
  s = ok(T.apply(s, { type: 'fog.reveal', rect: { c0: 3, r0: 3, c1: 5, r1: 5 } }, GM));
  v = T.viewFor(s, P1);
  assert.ok(T.activeScene(v).tokens.some((t) => t.name === 'Гоблин'), 'после открытия виден');
  assert.equal(T.fog.isRevealed(T.activeScene(s), { c: 4, r: 4 }), true);
  assert.equal(T.fog.isRevealed(T.activeScene(s), { c: 0, r: 0 }), false);
  s = ok(T.apply(s, { type: 'fog.hide', rect: { c0: 4, r0: 4, c1: 4, r1: 4 } }, GM));
  assert.equal(T.fog.isRevealed(T.activeScene(s), { c: 4, r: 4 }), false);
  assert.equal(T.apply(s, { type: 'fog.reveal', rect: { c0: 0, r0: 0, c1: 9, r1: 9 } }, P1).ok, false, 'игрок не открывает туман');
});

test('игрок видит только активную сцену и не видит заметок мастера', () => {
  let s = table();
  s = ok(T.apply(s, { type: 'scene.add', scene: { name: 'Секретный склеп' } }, GM));
  s = ok(T.apply(s, { type: 'journal.add', entry: { title: 'Сюжет', text: 'Король — злодей' } }, GM));
  s = ok(T.apply(s, { type: 'journal.add', entry: { title: 'Письмо', text: 'Встречаемся в полночь', shared: true } }, GM));
  const v = T.viewFor(s, P1);
  assert.deepEqual(v.scenes.map((x) => x.name), ['Пещера']);
  assert.deepEqual(v.journal.map((j) => j.title), ['Письмо']);
  assert.equal(T.viewFor(s, GM).journal.length, 2);
  assert.equal(T.apply(s, { type: 'journal.add', entry: { title: 'x' } }, P1).ok, false);
});

// ---------- Бой ----------
test('бой: порядок по инициативе, ходы и раунды', () => {
  let s = table();
  const torin = tok(s, 'Торин'), gob = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'combat.start' }, GM));
  assert.equal(s.combat.active, true);
  assert.equal(s.combat.round, 1);
  s = ok(T.apply(s, { type: 'combat.add', tokenId: torin.id, init: 12 }, GM));
  s = ok(T.apply(s, { type: 'combat.add', tokenId: gob.id, init: 18 }, GM));
  assert.deepEqual(s.combat.order.map((o) => o.tokenId), [gob.id, torin.id], 'выше инициатива — раньше ход');
  assert.equal(T.combat.current(s).tokenId, gob.id);
  s = ok(T.apply(s, { type: 'combat.next' }, GM));
  assert.equal(T.combat.current(s).tokenId, torin.id);
  s = ok(T.apply(s, { type: 'combat.next' }, P1), 'игрок может завершить свой ход');
  assert.equal(s.combat.round, 2, 'новый раунд');
  assert.equal(T.combat.current(s).tokenId, gob.id);
  assert.equal(T.apply(s, { type: 'combat.next' }, P1).ok, false, 'не свой ход — нельзя');
  s = ok(T.apply(s, { type: 'combat.prev' }, GM));
  assert.equal(s.combat.round, 1);
  s = ok(T.apply(s, { type: 'combat.setInit', tokenId: torin.id, init: 20 }, GM));
  assert.equal(s.combat.order[0].tokenId, torin.id);
  s = ok(T.apply(s, { type: 'combat.remove', tokenId: gob.id }, GM));
  assert.equal(s.combat.order.length, 1);
  s = ok(T.apply(s, { type: 'combat.end' }, GM));
  assert.equal(s.combat.active, false);
  assert.equal(s.combat.order.length, 0);
});

test('бой: игрок бросает свою инициативу', () => {
  let s = table();
  const torin = tok(s, 'Торин');
  s = ok(T.apply(s, { type: 'combat.start' }, GM));
  s = ok(T.apply(s, { type: 'combat.add', tokenId: torin.id, init: 15 }, P1));
  assert.equal(s.combat.order[0].init, 15);
  assert.equal(T.apply(s, { type: 'combat.add', tokenId: tok(s, 'Гоблин').id, init: 1 }, P1).ok, false);
});

test('бой: скрытый монстр в очереди не виден игрокам', () => {
  let s = table();
  const gob = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'token.update', tokenId: gob.id, patch: { hidden: true } }, GM));
  s = ok(T.apply(s, { type: 'combat.start' }, GM));
  s = ok(T.apply(s, { type: 'combat.add', tokenId: gob.id, init: 10 }, GM));
  assert.equal(T.viewFor(s, P1).combat.order.length, 0);
  assert.equal(T.viewFor(s, GM).combat.order.length, 1);
});

test('игроку не видны хиты монстров, только состояние', () => {
  const s = table();
  const v = T.activeScene(T.viewFor(s, P1));
  const gob = v.tokens.find((t) => t.name === 'Гоблин');
  assert.equal(gob.hp, undefined);
  assert.equal(gob.ac, undefined);
  assert.equal(gob.health, 'цел');
  const torin = v.tokens.find((t) => t.name === 'Торин');
  assert.equal(torin.hp, 12, 'свои хиты видны');
  assert.equal(T.health(3, 7), 'ранен');
  assert.equal(T.health(1, 7), 'при смерти');
  assert.equal(T.health(0, 7), 'без сознания');
});

// ---------- Чат и кубики ----------
test('чат: сообщения, броски и скрытые броски мастера', () => {
  let s = table();
  s = ok(T.apply(s, { type: 'chat.say', text: 'Привет, таверна!' }, P1));
  s = ok(T.apply(s, { type: 'chat.roll', expr: '1к20+5', rng: seq(10) }, P1));
  s = ok(T.apply(s, { type: 'chat.roll', expr: '1к20', gmOnly: true, rng: seq(3) }, GM));
  assert.equal(s.chat.length, 3);
  assert.equal(s.chat[0].from, 'Аня');
  assert.equal(s.chat[1].roll.total, 15);
  assert.deepEqual(T.viewFor(s, P2).chat.map((m) => m.text || m.roll.expr), ['Привет, таверна!', '1к20+5']);
  assert.equal(T.viewFor(s, GM).chat.length, 3);
  assert.equal(T.apply(s, { type: 'chat.roll', expr: 'плохо' }, P1).ok, false);
  assert.equal(T.apply(s, { type: 'chat.say', text: '   ' }, P1).ok, false);
  const long = 'а'.repeat(3000);
  s = ok(T.apply(s, { type: 'chat.say', text: long }, P1));
  assert.ok(s.chat[s.chat.length - 1].text.length <= 1000, 'длинное сообщение обрезается');
  for (let i = 0; i < 250; i++) s = ok(T.apply(s, { type: 'chat.say', text: 'x' + i }, P1));
  assert.ok(s.chat.length <= 200, 'чат хранит последние 200 сообщений');
});

test('игрок: присоединение и сводка листа', () => {
  let s = table();
  assert.equal(s.players.p1.name, 'Аня');
  s = ok(T.apply(s, { type: 'player.sheet', sheet: { name: 'Торин', cls: 'Воин', level: 3, hp: 20, hpMax: 28, ac: 17 } }, P1));
  assert.equal(s.players.p1.sheet.ac, 17);
  assert.equal(T.viewFor(s, GM).players.p1.sheet.name, 'Торин');
  assert.equal(T.viewFor(s, P2).players.p1.sheet, undefined, 'чужие листы игроки не видят');
  assert.equal(T.apply(s, { type: 'player.join', name: '' }, P1).ok, false);
});

test('удаление фишки убирает её из боя', () => {
  let s = table();
  const gob = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'combat.start' }, GM));
  s = ok(T.apply(s, { type: 'combat.add', tokenId: gob.id, init: 5 }, GM));
  s = ok(T.apply(s, { type: 'token.remove', tokenId: gob.id }, GM));
  assert.equal(s.combat.order.length, 0);
  assert.equal(tok(s, 'Гоблин'), undefined);
});

// ---------- Сохранение кампании ----------
test('кампания: выгрузка и загрузка', () => {
  const s = table();
  const text = T.exportCampaign(s, { img1: 'data:image/png;base64,AAAA' });
  const r = T.importCampaign(text);
  assert.equal(r.ok, true);
  assert.equal(r.state.scenes[0].name, 'Пещера');
  assert.equal(r.assets.img1, 'data:image/png;base64,AAAA');
  assert.equal(T.importCampaign('мусор').ok, false);
  assert.equal(T.importCampaign(JSON.stringify({ app: 'rpg-sheets', characters: [] })).ok, false, 'файл персонажей — не кампания');
});
