// Доработки стола: эффекты в бою, правка своих хитов игроком, туман по обзору героев.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/table.js');

const GM = { role: 'gm', id: 'gm' };
const P1 = { role: 'player', id: 'p1' };
const P2 = { role: 'player', id: 'p2' };
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.state; };
const fail = (r, re) => { assert.equal(r.ok, false, 'должно быть отказано'); if (re) assert.match(r.error, re); };
const tok = (s, name) => T.activeScene(s).tokens.find((t) => t.name === name);

function table(sys = 'dnd2014') {
  let s = T.newState(sys);
  s = ok(T.apply(s, { type: 'scene.add', scene: { name: 'Поле', w: 1000, h: 500 } }, GM));   // клетка 50 px
  s = ok(T.apply(s, { type: 'player.join', name: 'Аня' }, P1));
  s = ok(T.apply(s, { type: 'player.join', name: 'Борис' }, P2));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Лира', kind: 'pc', owner: 'p1', hp: 20, hpMax: 20, ac: 15, level: 3, bonus: 2, x: 25, y: 25 } }, GM));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Гоблин', kind: 'npc', hp: 7, hpMax: 7, ac: 13, x: 125, y: 25 } }, GM));
  return s;
}

// ---------- Эффекты ----------
test('эффекты: готовые списки под каждую НРИ', () => {
  for (const id of Object.keys(T.SYSTEMS)) assert.ok(Array.isArray(T.EFFECTS[id]) && T.EFFECTS[id].length >= 4, id);
  assert.ok(T.EFFECTS.dnd2014.includes('Отравлен'));
  assert.ok(T.EFFECTS.dnd2024.includes('Ослеплён'));
  assert.ok(T.EFFECTS.gurps.includes('Шок'));
  assert.ok(T.EFFECTS.munchkin.includes('Проклятие'));
});

test('эффекты: добавляет и снимает только мастер, проверка ввода', () => {
  let s = table();
  const g = tok(s, 'Гоблин');
  fail(T.apply(s, { type: 'effect.add', tokenId: g.id, name: 'Отравлен', rounds: 2 }, P1), /мастер/i);
  fail(T.apply(s, { type: 'effect.add', tokenId: g.id, name: '  ', rounds: 2 }, GM));
  fail(T.apply(s, { type: 'effect.add', tokenId: 'нет', name: 'Отравлен' }, GM));
  s = ok(T.apply(s, { type: 'effect.add', tokenId: g.id, name: 'Отравлен', rounds: 2 }, GM));
  s = ok(T.apply(s, { type: 'effect.add', tokenId: g.id, name: 'Мой эффект', rounds: '' }, GM));
  const fx = tok(s, 'Гоблин').effects;
  assert.deepEqual(fx.map((e) => [e.name, e.rounds]), [['Отравлен', 2], ['Мой эффект', null]], 'без срока — null');
  assert.ok(fx.every((e) => e.id), 'у эффекта есть id');
  fail(T.apply(s, { type: 'effect.add', tokenId: g.id, name: 'X', rounds: -1 }, GM), /раунд/i);
  fail(T.apply(s, { type: 'effect.remove', tokenId: g.id, effectId: fx[0].id }, P1));
  s = ok(T.apply(s, { type: 'effect.remove', tokenId: g.id, effectId: fx[0].id }, GM));
  assert.deepEqual(tok(s, 'Гоблин').effects.map((e) => e.name), ['Мой эффект']);
});

test('эффекты: срок уменьшается с каждым новым раундом, на нуле снимается с записью в чат', () => {
  let s = table();
  const l = tok(s, 'Лира'), g = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'combat.start' }, GM));
  s = ok(T.apply(s, { type: 'combat.add', tokenId: l.id, init: 15 }, GM));
  s = ok(T.apply(s, { type: 'combat.add', tokenId: g.id, init: 10 }, GM));
  s = ok(T.apply(s, { type: 'effect.add', tokenId: g.id, name: 'Отравлен', rounds: 2 }, GM));
  s = ok(T.apply(s, { type: 'effect.add', tokenId: l.id, name: 'Благословение', rounds: null }, GM));
  s = ok(T.apply(s, { type: 'combat.next' }, GM));                     // ход гоблина, раунд 1
  assert.equal(tok(s, 'Гоблин').effects[0].rounds, 2, 'внутри раунда срок не меняется');
  s = ok(T.apply(s, { type: 'combat.next' }, GM));                     // раунд 2
  assert.equal(s.combat.round, 2);
  assert.equal(tok(s, 'Гоблин').effects[0].rounds, 1);
  s = ok(T.apply(s, { type: 'combat.next' }, GM));
  s = ok(T.apply(s, { type: 'combat.next' }, GM));                     // раунд 3
  assert.deepEqual(tok(s, 'Гоблин').effects, [], 'эффект снят');
  assert.equal(tok(s, 'Лира').effects[0].rounds, null, 'бессрочный остаётся');
  const msg = s.chat[s.chat.length - 1];
  assert.match(msg.text, /Отравлен/); assert.match(msg.text, /Гоблин/); assert.match(msg.text, /закончил/);
  assert.equal(msg.gmOnly, true, 'о монстре сообщается только мастеру');
});

test('эффекты видны игрокам на видимых существах, у скрытых — нет', () => {
  let s = table();
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Засада', kind: 'npc', hidden: true, x: 225, y: 25 } }, GM));
  s = ok(T.apply(s, { type: 'effect.add', tokenId: tok(s, 'Гоблин').id, name: 'Ослеплён', rounds: 1 }, GM));
  s = ok(T.apply(s, { type: 'effect.add', tokenId: tok(s, 'Засада').id, name: 'Невидим' }, GM));
  const v = T.viewFor(s, P1);
  assert.deepEqual(tok(v, 'Гоблин').effects.map((e) => e.name), ['Ослеплён']);
  assert.equal(JSON.stringify(v).includes('Невидим'), false, 'эффект скрытого не утекает');
});

// ---------- Свои хиты ----------
test('игрок меняет хиты своего героя, но не чужого и не другие поля', () => {
  let s = table();
  const l = tok(s, 'Лира'), g = tok(s, 'Гоблин');
  s = ok(T.apply(s, { type: 'token.self', tokenId: l.id, patch: { hp: 12 } }, P1));
  assert.equal(tok(s, 'Лира').hp, 12);
  fail(T.apply(s, { type: 'token.self', tokenId: l.id, patch: { hp: 5 } }, P2), /сво/i);
  fail(T.apply(s, { type: 'token.self', tokenId: g.id, patch: { hp: 0 } }, P1));
  s = ok(T.apply(s, { type: 'token.self', tokenId: l.id, patch: { hp: 10, ac: 30, name: 'Хакер', owner: 'p2' } }, P1));
  const l2 = tok(s, 'Лира');
  assert.deepEqual([l2.hp, l2.ac, l2.owner], [10, 15, 'p1'], 'остальные поля не меняются');
  s = ok(T.apply(s, { type: 'token.self', tokenId: l.id, patch: { hp: 999 } }, P1));
  assert.equal(tok(s, 'Лира').hp, 20, 'не больше максимума');
});

test('в Манчкине игрок меняет свой уровень и бонус', () => {
  let s = table('munchkin');
  const l = tok(s, 'Лира');
  s = ok(T.apply(s, { type: 'token.self', tokenId: l.id, patch: { level: 4, bonus: 5, hp: 1 } }, P1));
  const t = tok(s, 'Лира');
  assert.deepEqual([t.level, t.bonus, t.hp], [4, 5, 20], 'хитов в Манчкине нет — не меняются');
  s = ok(T.apply(s, { type: 'token.self', tokenId: l.id, patch: { level: 99 } }, P1));
  assert.equal(tok(s, 'Лира').level, 10, 'уровень 1–10');
});

// ---------- Туман по обзору ----------
function visionTable(sys = 'dnd2014', radius = 10) {
  let s = table(sys);
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Орк', kind: 'npc', x: 725, y: 25 } }, GM));
  s = ok(T.apply(s, { type: 'fog.set', enabled: true, mode: 'vision', radius }, GM));
  return s;
}

test('туман: режим «по обзору» и радиус ставит мастер, ввод проверяется', () => {
  let s = table();
  fail(T.apply(s, { type: 'fog.set', enabled: true, mode: 'vision', radius: 30 }, P1));
  fail(T.apply(s, { type: 'fog.set', enabled: true, mode: 'радар' }, GM), /режим/i);
  s = ok(T.apply(s, { type: 'fog.set', enabled: true, mode: 'vision', radius: 30 }, GM));
  const f = T.activeScene(s).fog;
  assert.deepEqual([f.enabled, f.mode, f.radius], [true, 'vision', 30]);
  s = ok(T.apply(s, { type: 'fog.set', radius: -5 }, GM));
  assert.equal(T.activeScene(s).fog.radius, 0, 'радиус не отрицательный');
  assert.equal(T.activeScene(s).fog.mode, 'vision', 'не переданный режим не сбрасывается');
  fail(T.apply(T.newState(), { type: 'fog.set', mode: 'vision' }, GM), /сцен/i);
});

test('туман: видимые клетки — круг радиуса вокруг героев, монстры не светят', () => {
  const s = visionTable('dnd2014', 10);            // 10 фт = 2 клетки
  const sc = T.activeScene(s);
  const vis = T.fog.visibleCells(sc, 'dnd2014');
  assert.ok(vis.has('0,0') && vis.has('2,0') && vis.has('0,2'));
  assert.ok(!vis.has('3,0'), 'дальше радиуса не видно');
  assert.ok(!vis.has('2,2'), 'круг, а не квадрат');
  assert.ok(!vis.has('14,0'), 'вокруг монстра не видно');
  assert.equal(T.fog.visibleCells(visionTable('gurps', 3).scenes[0], 'gurps').has('3,0'), true, 'GURPS: 3 ярда = 3 клетки');
  assert.equal(T.fog.visibleCells(visionTable('munchkin', 1).scenes[0], 'munchkin').has('2,0'), false, 'Манчкин: 1 клетка');
});

test('туман: свой радиус у фишки (тёмное зрение)', () => {
  let s = visionTable('dnd2014', 10);
  s = ok(T.apply(s, { type: 'token.update', tokenId: tok(s, 'Лира').id, patch: { vision: 30 } }, GM));
  const vis = T.fog.visibleCells(T.activeScene(s), 'dnd2014');
  assert.ok(vis.has('6,0') && !vis.has('7,0'), '30 фт = 6 клеток');
});

test('туман: игрок видит монстров только в зоне обзора; где был — исследовано, но монстров не видно', () => {
  let s = visionTable('dnd2014', 10);
  const names = (st) => T.activeScene(T.viewFor(st, P1)).tokens.map((t) => t.name).sort();
  assert.deepEqual(names(s), ['Гоблин', 'Лира'], 'гоблин в 2 клетках — виден, орк далеко — нет');
  const lira = tok(s, 'Лира');
  s = ok(T.apply(s, { type: 'token.move', tokenId: lira.id, x: 625, y: 25 }, P1));
  assert.deepEqual(names(s), ['Лира', 'Орк'], 'подошла к орку — виден; гоблин остался в исследованном');
  const sc = T.activeScene(s);
  assert.ok(sc.fog.explored.includes('0,0') && sc.fog.explored.includes('2,0'), 'пройденное запомнено');
  const vis = T.fog.visibleCells(sc, 'dnd2014');
  assert.equal(T.fog.cellState(sc, { c: 0, r: 0 }, vis), 'explored');
  assert.equal(T.fog.cellState(sc, { c: 12, r: 0 }, vis), 'visible');
  assert.equal(T.fog.cellState(sc, { c: 19, r: 9 }, vis), 'hidden');
  // монстр, двигаясь, ничего не открывает
  s = ok(T.apply(s, { type: 'token.move', tokenId: tok(s, 'Гоблин').id, x: 975, y: 475 }, GM));
  assert.equal(T.activeScene(s).fog.explored.includes('19,9'), false);
});

test('туман: ручное «Открыть» работает и в режиме обзора, «Скрыть» стирает исследованное', () => {
  let s = visionTable('dnd2014', 10);
  s = ok(T.apply(s, { type: 'fog.reveal', rect: { c0: 14, r0: 0, c1: 14, r1: 0 } }, GM));
  assert.ok(T.activeScene(T.viewFor(s, P1)).tokens.some((t) => t.name === 'Орк'), 'мастер открыл клетку орка');
  s = ok(T.apply(s, { type: 'fog.hide', rect: { c0: 0, r0: 0, c1: 2, r1: 2 } }, GM));
  const sc = T.activeScene(s);
  assert.equal(sc.fog.explored.includes('1,0'), false, 'исследованное стёрто');
  // но герой стоит там и видит снова при следующем движении
  s = ok(T.apply(s, { type: 'token.move', tokenId: tok(s, 'Лира').id, x: 75, y: 25 }, P1));
  assert.ok(T.activeScene(s).fog.explored.includes('1,0'));
});

test('туман: старые кампании без режима читаются как «вручную»', () => {
  const st = T.newState();
  st.scenes.push({ id: 'sc1', name: 'Старая', w: 500, h: 500, image: null, grid: { size: 50 }, fog: { enabled: true, revealed: [] }, tokens: [] });
  st.activeSceneId = 'sc1';
  const imp = T.importCampaign(JSON.stringify({ app: 'rpg-table', state: st }));
  const f = imp.state.scenes[0].fog;
  assert.deepEqual([f.mode, f.radius, f.explored], ['manual', 30, []]);
});
