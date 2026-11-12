// Выбор НРИ на столе мастера: системы, поля фишек, кубики, масштаб сетки, листы игроков.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/table.js');

const GM = { role: 'gm', id: 'gm' };
const P1 = { role: 'player', id: 'p1' };
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.state; };
const fixed = (...vals) => { let i = 0; return (sides) => Math.min(vals[i++ % vals.length], sides); };

test('системы: четыре НРИ с названиями', () => {
  assert.deepEqual(Object.keys(T.SYSTEMS), ['dnd2014', 'dnd2024', 'gurps', 'munchkin']);
  for (const s of Object.values(T.SYSTEMS)) {
    assert.ok(s.name && s.cell && s.fields && s.dice, s.name);
  }
  assert.equal(T.SYSTEMS.gurps.name, 'GURPS 4e');
});

test('системы: новый стол по умолчанию D&D 2014, старое «dnd5e» читается как D&D 2014', () => {
  assert.equal(T.systemOf(T.newState()), 'dnd2014');
  assert.equal(T.systemOf({ system: 'dnd5e' }), 'dnd2014');
  assert.equal(T.systemOf({ system: 'нечто' }), 'dnd2014');
  assert.equal(T.systemOf(T.newState('gurps')), 'gurps');
  const imp = T.importCampaign(JSON.stringify({ app: 'rpg-table', state: Object.assign(T.newState(), { system: 'dnd5e' }) }));
  assert.equal(imp.state.system, 'dnd2014', 'старые файлы кампаний переводятся');
});

test('системы: менять НРИ может только мастер и только на известную', () => {
  let s = T.newState();
  assert.equal(T.apply(s, { type: 'system.set', system: 'gurps' }, P1).ok, false);
  assert.equal(T.apply(s, { type: 'system.set', system: 'pathfinder' }, GM).ok, false);
  s = ok(T.apply(s, { type: 'system.set', system: 'gurps' }, GM));
  assert.equal(s.system, 'gurps');
  assert.equal(T.viewFor(s, P1).system, 'gurps', 'игрок видит, во что играем');
});

test('масштаб сетки: D&D — 5 футов, GURPS — 1 ярд, Манчкин — клетки', () => {
  const a = { c: 0, r: 0 }, b = { c: 3, r: 1 };
  assert.deepEqual(T.grid.distance(a, b, 'dnd2014'), { n: 15, unit: 'фт', text: '15 фт' });
  assert.deepEqual(T.grid.distance(a, b, 'dnd2024'), { n: 15, unit: 'фт', text: '15 фт' });
  assert.deepEqual(T.grid.distance(a, b, 'gurps'), { n: 3, unit: 'ярд', text: '3 ярд.' });
  assert.deepEqual(T.grid.distance(a, b, 'munchkin'), { n: 3, unit: 'кл.', text: '3 кл.' });
});

test('поля фишек под систему', () => {
  const keys = (id) => T.SYSTEMS[id].fields.map((f) => f.key);
  assert.deepEqual(keys('dnd2014'), ['hp', 'hpMax', 'ac']);
  assert.deepEqual(keys('gurps'), ['hp', 'hpMax', 'dr', 'dodge', 'move']);
  assert.deepEqual(keys('munchkin'), ['level', 'bonus']);
  assert.equal(T.SYSTEMS.gurps.fields.find((f) => f.key === 'dr').label, 'СП');
});

test('фишки GURPS и Манчкина хранят свои поля, секретное прячется от игроков', () => {
  let s = ok(T.apply(T.newState('gurps'), { type: 'scene.add', scene: { name: 'Арена' } }, GM));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Орк', kind: 'npc', hp: 12, hpMax: 12, dr: 2, dodge: 8, move: 5 } }, GM));
  const orc = T.activeScene(s).tokens[0];
  assert.deepEqual([orc.dr, orc.dodge, orc.move], [2, 8, 5]);
  const seen = T.activeScene(T.viewFor(s, P1)).tokens[0];
  assert.equal(seen.dr, undefined); assert.equal(seen.dodge, undefined); assert.equal(seen.hp, undefined);
  assert.equal(seen.health, 'цел');

  let m = ok(T.apply(T.newState('munchkin'), { type: 'scene.add', scene: { name: 'Подземелье' } }, GM));
  m = ok(T.apply(m, { type: 'token.add', token: { name: 'Слизень', kind: 'npc', level: 4, bonus: 3 } }, GM));
  const slime = T.activeScene(T.viewFor(m, P1)).tokens[0];
  assert.equal(slime.level, 4, 'уровень монстра в Манчкине виден всем');
  assert.equal(slime.bonus, undefined, 'бонус монстра — секрет мастера');
});

test('кубики под систему', () => {
  assert.deepEqual(T.SYSTEMS.dnd2014.dice.quick, [4, 6, 8, 10, 12, 20, 100]);
  assert.equal(T.SYSTEMS.dnd2014.dice.advantage, true);
  assert.equal(T.SYSTEMS.gurps.dice.advantage, false);
  assert.equal(T.SYSTEMS.gurps.dice.skill, true);
  assert.deepEqual(T.SYSTEMS.munchkin.dice.quick, [6]);
  assert.match(T.SYSTEMS.gurps.dice.placeholder, /3к6/);
});

test('GURPS: проверка навыка 3к6 «под» навык и критические', () => {
  let r = T.dice.gurpsCheck(12, fixed(3, 4, 4));   // 11
  assert.deepEqual([r.total, r.success, r.margin, r.crit], [11, true, 1, null]);
  r = T.dice.gurpsCheck(12, fixed(5, 5, 3));       // 13
  assert.deepEqual([r.success, r.margin, r.crit], [false, -1, null]);
  assert.equal(T.dice.gurpsCheck(10, fixed(1, 1, 2)).crit, 'success');   // 4
  assert.equal(T.dice.gurpsCheck(15, fixed(1, 2, 2)).crit, 'success');   // 5 при навыке 15
  assert.equal(T.dice.gurpsCheck(14, fixed(1, 2, 2)).crit, null);        // 5 при навыке 14 — обычный успех
  assert.equal(T.dice.gurpsCheck(16, fixed(2, 2, 2)).crit, 'success');   // 6 при навыке 16
  assert.equal(T.dice.gurpsCheck(20, fixed(6, 6, 6)).crit, 'fail');      // 18 — всегда провал
  assert.equal(T.dice.gurpsCheck(15, fixed(6, 6, 5)).crit, 'fail');      // 17 при навыке ≤15
  assert.equal(T.dice.gurpsCheck(16, fixed(6, 6, 5)).success, false);    // 17 при 16 — просто провал
  assert.equal(T.dice.gurpsCheck(16, fixed(6, 6, 5)).crit, null);
  assert.equal(T.dice.gurpsCheck(3, fixed(5, 4, 4)).crit, 'fail');       // 13 ≥ навык+10
  assert.equal(T.dice.gurpsCheck(1, fixed(1, 1, 1)).success, true, '3 — всегда успех');
});

test('GURPS: бросок навыка попадает в чат', () => {
  const s = ok(T.apply(T.newState('gurps'), { type: 'chat.roll', expr: '3к6', skill: 12, label: 'Меч', rng: fixed(3, 4, 4) }, GM));
  const m = s.chat[0];
  assert.equal(m.roll.total, 11);
  assert.deepEqual([m.check.skill, m.check.success, m.check.margin], [12, true, 1]);
});

test('листы игроков: только выбранной НРИ', () => {
  let s = ok(T.apply(T.newState('dnd2024'), { type: 'player.join', name: 'Аня' }, P1));
  const bad = T.apply(s, { type: 'player.sheet', sheet: { name: 'Торин', tsys: 'dnd2014' } }, P1);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /D&D 5e \(2024\)/, 'ошибка называет нужную НРИ');
  s = ok(T.apply(s, { type: 'player.sheet', sheet: { name: 'Лира', tsys: 'dnd2024', ac: 15 } }, P1));
  assert.equal(s.players.p1.sheet.name, 'Лира');
  s = ok(T.apply(s, { type: 'system.set', system: 'gurps' }, GM));
  assert.equal(s.players.p1.sheet, undefined, 'при смене НРИ лист другой системы убирается');
  assert.equal(s.players.p1.name, 'Аня', 'сам игрок остаётся');
});

test('сопоставление персонажа и НРИ стола', () => {
  assert.equal(T.sheetSystem({ system: 'dnd5e', data: { edition: '2014' } }), 'dnd2014');
  assert.equal(T.sheetSystem({ system: 'dnd5e', data: { edition: '2024' } }), 'dnd2024');
  assert.equal(T.sheetSystem({ system: 'dnd5e', data: {} }), 'dnd2014');
  assert.equal(T.sheetSystem({ system: 'gurps4e', data: {} }), 'gurps');
  assert.equal(T.sheetSystem({ system: 'munchkin', data: {} }), 'munchkin');
});
