// Подсказки за столом: список, выбор следующей, тексты под НРИ, чек-лист мастера, хранение.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/table.js');
const H = require('../src/tips.js');

const GM = { role: 'gm', id: 'gm' };
const SYS = ['dnd2014', 'dnd2024', 'gurps', 'munchkin'];
const prefs = (seen = []) => ({ enabled: true, seen });
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.state; };

test('подсказки: у каждой уникальный id, роль, событие, элемент и текст для всех НРИ', () => {
  const ids = new Set();
  for (const tip of H.TIPS) {
    assert.ok(!ids.has(tip.id), 'повтор id ' + tip.id); ids.add(tip.id);
    assert.ok(['gm', 'player'].includes(tip.role), tip.id + ': роль');
    assert.ok(H.TRIGGERS.includes(tip.on), tip.id + ': неизвестное событие ' + tip.on);
    assert.ok(typeof tip.target === 'string' && tip.target, tip.id + ': к чему указывает');
    assert.ok(tip.title && tip.title.length <= 40, tip.id + ': заголовок короткий');
    for (const s of SYS) {
      const t = H.textFor(tip, s);
      assert.ok(t && t.length >= 20 && t.length <= 320, `${tip.id}/${s}: текст 20–320 символов, а не ${t && t.length}`);
    }
  }
});

test('подсказки: покрыты все места стола мастера и игрока', () => {
  const on = (role) => new Set(H.TIPS.filter((t) => t.role === role).map((t) => t.on));
  for (const ev of ['open', 'tab:scenes', 'tab:tokens', 'tab:combat', 'tab:journal', 'tab:players',
    'tool:reveal', 'tool:hide', 'tool:measure', 'select:token', 'focus:dice', 'combat:start', 'player:first']) {
    assert.ok(on('gm').has(ev), 'мастер: нет подсказки на ' + ev);
  }
  for (const ev of ['open', 'tab:combat', 'tab:journal', 'tab:hero', 'tool:measure', 'focus:dice', 'turn:mine']) {
    assert.ok(on('player').has(ev), 'игрок: нет подсказки на ' + ev);
  }
});

test('подсказки: тексты учитывают НРИ', () => {
  const tip = (role, on) => H.TIPS.find((t) => t.role === role && t.on === on);
  const dice = tip('gm', 'focus:dice');
  assert.match(H.textFor(dice, 'dnd2014'), /преимущ/i);
  assert.match(H.textFor(dice, 'gurps'), /3к6/);
  assert.match(H.textFor(dice, 'gurps'), /навык/i);
  assert.match(H.textFor(dice, 'munchkin'), /к6/);
  const tokens = tip('gm', 'tab:tokens');
  assert.match(H.textFor(tokens, 'dnd2024'), /КД/);
  assert.match(H.textFor(tokens, 'gurps'), /СП/);
  assert.match(H.textFor(tokens, 'munchkin'), /[Уу]ровень/);
  const ruler = tip('player', 'tool:measure');
  assert.match(H.textFor(ruler, 'dnd2014'), /фут/);
  assert.match(H.textFor(ruler, 'gurps'), /ярд/);
  assert.match(H.textFor(ruler, 'munchkin'), /клет/);
  assert.match(H.textFor(tip('player', 'tab:combat'), 'gurps'), /Базов[а-яё]* скорост/i);
});

test('следующая подсказка: по событию и роли, один раз, выключается', () => {
  const a = H.next('open', { role: 'gm', sys: 'dnd2014', prefs: prefs() });
  assert.ok(a && a.role === 'gm' && a.on === 'open');
  const p = H.next('open', { role: 'player', sys: 'dnd2014', prefs: prefs() });
  assert.ok(p && p.role === 'player', 'игроку — игроцкая');
  assert.notEqual(a.id, p.id);
  const seenAll = H.TIPS.filter((t) => t.on === 'open' && t.role === 'gm').map((t) => t.id);
  assert.equal(H.next('open', { role: 'gm', sys: 'dnd2014', prefs: prefs(seenAll) }), null, 'увиденная не повторяется');
  assert.equal(H.next('open', { role: 'gm', sys: 'dnd2014', prefs: { enabled: false, seen: [] } }), null, 'выключено');
  assert.equal(H.next('нет-такого', { role: 'gm', sys: 'dnd2014', prefs: prefs() }), null);
  assert.equal(H.next('open', { role: 'gm', sys: 'dnd2014', prefs: null }).on, 'open', 'без настроек — включено');
});

test('чек-лист мастера: 7 шагов, галочки по состоянию стола', () => {
  const ids = (st) => H.checklist(st).filter((x) => x.done).map((x) => x.id);
  let s = T.newState('dnd2014');
  const list = H.checklist(s);
  assert.deepEqual(list.map((x) => x.id), ['scene', 'map', 'tokens', 'fog', 'players', 'owner', 'combat']);
  assert.ok(list.every((x) => x.title && x.tab), 'у шага есть название и вкладка');
  assert.deepEqual(ids(s), []);
  s = ok(T.apply(s, { type: 'scene.add', scene: { name: 'Лес' } }, GM));
  assert.deepEqual(ids(s), ['scene']);
  s = ok(T.apply(s, { type: 'scene.update', sceneId: s.scenes[0].id, patch: { image: 'img1' } }, GM));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Гоблин', kind: 'npc' } }, GM));
  s = ok(T.apply(s, { type: 'fog.reveal', rect: { c0: 0, r0: 0, c1: 1, r1: 1 } }, GM));
  assert.deepEqual(ids(s), ['scene', 'map', 'tokens', 'fog']);
  s = ok(T.apply(s, { type: 'player.join', name: 'Аня' }, { role: 'player', id: 'p1' }));
  s = ok(T.apply(s, { type: 'token.add', token: { name: 'Лира', kind: 'pc', owner: 'p1' } }, GM));
  s = ok(T.apply(s, { type: 'combat.start' }, GM));
  assert.equal(H.checklist(s).filter((x) => x.done).length, 7);
  assert.equal(H.progress(s), '7/7');
  assert.equal(H.progress(T.newState()), '0/7');
});

test('хранение: запоминает «видел» и «выкл», не падает без хранилища', () => {
  const mem = {};
  const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const st = H.store(ls);
  assert.deepEqual(st.load(), { enabled: true, seen: [] }, 'по умолчанию включено');
  st.save({ enabled: false, seen: ['a', 'b'] });
  assert.deepEqual(H.store(ls).load(), { enabled: false, seen: ['a', 'b'] });
  mem[H.KEY] = '{битый json';
  assert.deepEqual(H.store(ls).load(), { enabled: true, seen: [] });
  const broken = { getItem() { throw new Error('нет доступа'); }, setItem() { throw new Error('нет доступа'); } };
  const sb = H.store(broken);
  assert.doesNotThrow(() => sb.save({ enabled: true, seen: ['x'] }));
  assert.deepEqual(sb.load(), { enabled: true, seen: ['x'] }, 'без хранилища — в памяти');
  assert.deepEqual(H.store(null).load(), { enabled: true, seen: [] });
});

test('отметить и сбросить', () => {
  let p = H.markSeen(prefs(), 'gm-open');
  p = H.markSeen(p, 'gm-open');
  assert.deepEqual(p.seen, ['gm-open'], 'без повторов');
  assert.deepEqual(H.reset({ enabled: false, seen: ['a'] }), { enabled: true, seen: [] });
});

test('новые подсказки: как отдать героя игроку, туман по обзору, эффекты, «Двигать» и карточка у игрока', () => {
  const by = (id) => H.TIPS.find((t) => t.id === id);
  const give = by('gm-give-hero');
  assert.ok(give, 'есть подсказка «как отдать героя игроку»');
  assert.match(H.textFor(give, 'dnd2014'), /«Управляет»/);
  assert.match(give.title, /игрок/i);
  for (const [id, on, role] of [['gm-vision', 'fog:vision', 'gm'], ['gm-effects', 'combat:effects', 'gm'], ['pl-move', 'tool:move', 'player'], ['pl-card', 'card:show', 'player']]) {
    const t = by(id);
    assert.ok(t, 'нет подсказки ' + id);
    assert.equal(t.on, on); assert.equal(t.role, role);
  }
  assert.match(H.textFor(by('gm-vision'), 'dnd2014'), /фут/);
  assert.match(H.textFor(by('gm-vision'), 'gurps'), /ярд/);
  assert.match(H.textFor(by('pl-card'), 'dnd2014'), /хит/i);
  assert.match(H.textFor(by('pl-card'), 'munchkin'), /уровень/i);
});
