// Тесты логики листов. Запуск: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const RPG = require('../src/core.js');

test('D&D: модификатор характеристики', () => {
  const cases = [[1, -5], [3, -4], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [18, 4], [20, 5], [30, 10]];
  for (const [score, mod] of cases) assert.equal(RPG.dnd.mod(score), mod, `значение ${score}`);
});

test('D&D: модификатор от строки и мусора', () => {
  assert.equal(RPG.dnd.mod('14'), 2);
  assert.equal(RPG.dnd.mod(''), 0);
  assert.equal(RPG.dnd.mod('abc'), 0);
  assert.equal(RPG.dnd.mod(undefined), 0);
});

test('D&D: бонус мастерства по уровню', () => {
  const cases = [[1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4], [13, 5], [16, 5], [17, 6], [20, 6]];
  for (const [lvl, pb] of cases) assert.equal(RPG.dnd.profBonus(lvl), pb, `уровень ${lvl}`);
  assert.equal(RPG.dnd.profBonus(0), 2, 'уровень ниже 1 считается 1');
  assert.equal(RPG.dnd.profBonus(99), 6, 'уровень выше 20 считается 20');
  assert.equal(RPG.dnd.profBonus(''), 2);
});

test('D&D: бонус навыка/спасброска', () => {
  assert.equal(RPG.dnd.skillBonus(14, false, 1), 2, 'без владения = модификатор');
  assert.equal(RPG.dnd.skillBonus(14, true, 1), 4, 'с владением + бонус мастерства');
  assert.equal(RPG.dnd.skillBonus(14, true, 5, true), 8, 'экспертиза удваивает бонус мастерства');
  assert.equal(RPG.dnd.skillBonus(8, false, 20), -1);
});

test('D&D: пассивная внимательность', () => {
  assert.equal(RPG.dnd.passive(12, false, 1), 11);
  assert.equal(RPG.dnd.passive(12, true, 1), 13);
});

test('GURPS: стоимость характеристик в очках', () => {
  assert.equal(RPG.gurps.attrCost({ ST: 10, DX: 10, IQ: 10, HT: 10 }), 0);
  assert.equal(RPG.gurps.attrCost({ ST: 11, DX: 10, IQ: 10, HT: 10 }), 10, 'ST — 10 очков за уровень');
  assert.equal(RPG.gurps.attrCost({ ST: 10, DX: 11, IQ: 10, HT: 10 }), 20, 'DX — 20 очков за уровень');
  assert.equal(RPG.gurps.attrCost({ ST: 10, DX: 10, IQ: 12, HT: 10 }), 40, 'IQ — 20 очков за уровень');
  assert.equal(RPG.gurps.attrCost({ ST: 10, DX: 10, IQ: 10, HT: 9 }), -10, 'HT ниже 10 возвращает очки');
  assert.equal(RPG.gurps.attrCost({ ST: 12, DX: 13, IQ: 11, HT: 12 }), 20 + 60 + 20 + 20);
});

test('GURPS: производные параметры', () => {
  const d = RPG.gurps.derived({ ST: 10, DX: 10, IQ: 10, HT: 10 });
  assert.equal(d.HP, 10);
  assert.equal(d.Will, 10);
  assert.equal(d.Per, 10);
  assert.equal(d.FP, 10);
  assert.equal(d.BasicSpeed, 5);
  assert.equal(d.BasicMove, 5);
  assert.equal(d.Dodge, 8);
  assert.equal(d.BasicLift, 20);

  const e = RPG.gurps.derived({ ST: 13, DX: 12, IQ: 11, HT: 11 });
  assert.equal(e.HP, 13);
  assert.equal(e.Will, 11);
  assert.equal(e.BasicSpeed, 5.75, '(HT+DX)/4, без округления');
  assert.equal(e.BasicMove, 5, 'Basic Move = Basic Speed с отбрасыванием дробной части');
  assert.equal(e.Dodge, 8);
  assert.equal(e.BasicLift, 34, 'ST²/5 = 33.8, от 10 и выше округляется до целого');

  const w = RPG.gurps.derived({ ST: 5, DX: 10, IQ: 10, HT: 10 });
  assert.equal(w.BasicLift, 5, '5²/5 = 5');
  const v = RPG.gurps.derived({ ST: 6, DX: 10, IQ: 10, HT: 10 });
  assert.equal(v.BasicLift, 7.2, 'меньше 10 — без округления до целого');
});

test('GURPS: доп. уровни производных учитываются', () => {
  const d = RPG.gurps.derived({ ST: 10, DX: 10, IQ: 10, HT: 10, hpMod: 2, willMod: -1, perMod: 3, fpMod: 1, speedMod: 0.25, moveMod: 1 });
  assert.equal(d.HP, 12);
  assert.equal(d.Will, 9);
  assert.equal(d.Per, 13);
  assert.equal(d.FP, 11);
  assert.equal(d.BasicSpeed, 5.25);
  assert.equal(d.BasicMove, 6, 'floor(5.25) + 1');
  assert.equal(d.Dodge, 8);
});

test('Манчкин: боевая сила и уровень', () => {
  assert.equal(RPG.munchkin.combatStrength(1, 0), 1);
  assert.equal(RPG.munchkin.combatStrength(5, 7), 12);
  assert.equal(RPG.munchkin.combatStrength('3', '4'), 7);
  assert.equal(RPG.munchkin.clampLevel(0), 1, 'уровень не ниже 1');
  assert.equal(RPG.munchkin.clampLevel(11), 10, 'уровень не выше 10');
  assert.equal(RPG.munchkin.clampLevel(4), 4);
});

test('Хранилище: новый персонаж', () => {
  for (const sys of ['dnd5e', 'gurps4e', 'munchkin']) {
    const c = RPG.store.newCharacter(sys);
    assert.equal(c.system, sys);
    assert.equal(typeof c.id, 'string');
    assert.ok(c.id.length >= 8);
    assert.equal(typeof c.data, 'object');
  }
  assert.equal(RPG.store.newCharacter('dnd5e').data.str, 10);
  assert.equal(RPG.store.newCharacter('gurps4e').data.ST, 10);
  assert.equal(RPG.store.newCharacter('gurps4e').data.points, 150);
  assert.equal(RPG.store.newCharacter('munchkin').data.level, 1);
  assert.notEqual(RPG.store.newCharacter('dnd5e').id, RPG.store.newCharacter('dnd5e').id, 'id уникальные');
  assert.throws(() => RPG.store.newCharacter('chess'));
});

test('Хранилище: импорт файла', () => {
  const good = [RPG.store.newCharacter('dnd5e'), RPG.store.newCharacter('munchkin')];
  const r = RPG.store.parseImport(JSON.stringify({ app: 'rpg-sheets', version: 1, characters: good }));
  assert.equal(r.ok, true);
  assert.equal(r.characters.length, 2);

  assert.equal(RPG.store.parseImport('не json').ok, false);
  assert.equal(RPG.store.parseImport('{}').ok, false);
  assert.equal(RPG.store.parseImport(JSON.stringify({ app: 'other', characters: [] })).ok, false);

  const mixed = RPG.store.parseImport(JSON.stringify({ app: 'rpg-sheets', version: 1,
    characters: [good[0], { system: 'chess', id: 'x', data: {} }, null, { system: 'dnd5e' }] }));
  assert.equal(mixed.ok, true);
  assert.equal(mixed.characters.length, 1, 'битые записи отбрасываются');
  assert.equal(mixed.skipped, 3);
});

test('Хранилище: старое сохранение дополняется полями по умолчанию', () => {
  const old = { id: 'abc12345', system: 'dnd5e', data: { name: 'Торин', str: 16, skills: { athletics: 1 } } };
  const n = RPG.store.normalize(old);
  assert.equal(n.data.name, 'Торин');
  assert.equal(n.data.str, 16);
  assert.equal(n.data.dex, 10, 'отсутствующее поле получает значение по умолчанию');
  assert.equal(n.data.skills.athletics, 1, 'сохранённое владение не теряется');
  assert.equal(n.data.skills.stealth, 0, 'остальные навыки появляются');
  assert.equal(n.data.saves.con, false);
});

test('GURPS: полная стоимость персонажа и остаток очков', () => {
  const base = RPG.store.newCharacter('gurps4e').data;
  let s = RPG.gurps.summary(base);
  assert.equal(s.attributes, 0);
  assert.equal(s.secondary, 0);
  assert.equal(s.spent, 0);
  assert.equal(s.unspent, 150);

  const d = Object.assign({}, base, {
    ST: 11, DX: 12, // 10 + 40
    hpMod: 2,       // 2 очка за уровень = 4
    willMod: 1,     // 5
    perMod: -1,     // -5
    fpMod: 1,       // 3
    speedMod: 0.5,  // 5 очков за 0.25 = 10
    moveMod: 1,     // 5
    advPoints: 25, disadvPoints: -40, skillPoints: 30,
  });
  s = RPG.gurps.summary(d);
  assert.equal(s.attributes, 50);
  assert.equal(s.secondary, 4 + 5 - 5 + 3 + 10 + 5);
  assert.equal(s.spent, 50 + 22 + 25 - 40 + 30);
  assert.equal(s.unspent, 150 - s.spent);
});

test('GURPS: недостатки можно вводить и с плюсом — всё равно вычитаются', () => {
  const d = Object.assign(RPG.store.newCharacter('gurps4e').data, { disadvPoints: 20 });
  assert.equal(RPG.gurps.summary(d).spent, -20);
});

test('Манчкин: разовый бонус к боевой силе', () => {
  assert.equal(RPG.munchkin.combatStrength(3, 4, 5), 12);
  assert.equal(RPG.munchkin.combatStrength(3, 4, -2), 5);
  assert.equal(RPG.munchkin.isWinner(9), false);
  assert.equal(RPG.munchkin.isWinner(10), true);
});

// ---------- Классы, книги, хиты (D&D 5e) ----------
const D = RPG.dnd5eData;

test('D&D данные: 13 классов в каждой редакции, у каждого кость хитов и книги', () => {
  for (const ed of ['2014', '2024']) {
    const cls = D.classes.filter((c) => c.edition === ed);
    assert.equal(cls.length, 13, `редакция ${ed}`);
    for (const c of cls) {
      assert.ok([6, 8, 10, 12].includes(c.hitDie), `${c.id}: кость хитов`);
      assert.ok(c.books.length >= 1, `${c.id}: есть книга`);
      for (const b of c.books) assert.ok(D.books[b], `${c.id}: книга ${b} описана`);
      assert.ok(c.subclasses.length >= 4, `${c.id}: есть подклассы`);
      for (const s of c.subclasses) {
        assert.ok(s.name && s.books.length >= 1, `${c.id}/${s.name}: книга`);
        for (const b of s.books) {
          assert.ok(D.books[b], `${c.id}/${s.name}: книга ${b} описана`);
          assert.equal(D.books[b].edition, ed, `${c.id}/${s.name}: книга ${b} из той же редакции`);
        }
      }
    }
  }
});

test('D&D: кость хитов по классу', () => {
  const cases = { barbarian: 12, fighter: 10, paladin: 10, ranger: 10, bard: 8, cleric: 8, druid: 8, monk: 8,
    rogue: 8, warlock: 8, artificer: 8, sorcerer: 6, wizard: 6 };
  for (const ed of ['2014', '2024']) {
    for (const [id, die] of Object.entries(cases)) assert.equal(RPG.dnd.hitDie(ed, id), die, `${ed} ${id}`);
  }
  assert.equal(RPG.dnd.hitDie('2014', 'nope'), null);
  assert.equal(RPG.dnd.hitDiceText('2014', 'fighter', 5), '5к10');
  assert.equal(RPG.dnd.hitDiceText('2024', 'wizard', 1), '1к6');
  assert.equal(RPG.dnd.hitDiceText('2014', 'fighter', 0), '1к10', 'уровень не ниже 1');
  assert.equal(RPG.dnd.hitDiceText('2014', 'nope', 3), '');
});

test('D&D: формула хитов по классу, уровню и Телосложению', () => {
  const w1 = RPG.dnd.hpFormula('2014', 'wizard', 1, 14); // к6, Тел +2
  assert.equal(w1.total, 8);
  const f5 = RPG.dnd.hpFormula('2014', 'fighter', 5, 14); // 10+2 + 4*(6+2)
  assert.equal(f5.total, 44);
  assert.equal(f5.first, 12);
  assert.equal(f5.perLevel, 8);
  assert.match(f5.text, /к10/);
  assert.match(f5.text, /44/);
  const b3 = RPG.dnd.hpFormula('2024', 'barbarian', 3, 8); // 12-1 + 2*(7-1)
  assert.equal(b3.total, 23);
  const low = RPG.dnd.hpFormula('2014', 'wizard', 2, 3); // 6-4=2, затем 4-4=0 -> минимум 1 за уровень
  assert.equal(low.total, 3, 'за уровень не меньше 1 хита');
  assert.equal(RPG.dnd.hpFormula('2014', 'nope', 1, 10), null);
});

test('D&D: фильтр по книгам', () => {
  const only = RPG.dnd.availableClasses('2014', ['PHB14']).map((c) => c.id);
  assert.equal(only.length, 12, 'в Книге игрока 2014 12 классов');
  assert.ok(!only.includes('artificer'));
  const withTasha = RPG.dnd.availableClasses('2014', ['PHB14', 'TCE']).map((c) => c.id);
  assert.ok(withTasha.includes('artificer'), 'изобретатель есть у Таши');

  const fPHB = RPG.dnd.availableSubclasses('2014', 'fighter', ['PHB14']).map((s) => s.name);
  assert.deepEqual(fPHB.sort(), ['Мастер боевых искусств', 'Мистический рыцарь', 'Чемпион'].sort());
  const fAll = RPG.dnd.availableSubclasses('2014', 'fighter', ['PHB14', 'XGE']);
  assert.ok(fAll.some((s) => s.name === 'Самурай'));
  assert.equal(RPG.dnd.availableSubclasses('2014', 'nope', ['PHB14']).length, 0);

  const ph24 = RPG.dnd.availableClasses('2024', ['PHB24']).map((c) => c.id);
  assert.equal(ph24.length, 12);
  assert.equal(RPG.dnd.availableClasses('2024', ['PHB14']).length, 0, 'книги другой редакции не подходят');
});

test('D&D: подпись источника', () => {
  assert.equal(RPG.dnd.sourceLabel(['PHB14']), 'Книга игрока (2014)');
  assert.equal(RPG.dnd.sourceLabel(['ERLW', 'TCE']), 'Эберрон: Восход после Последней войны, Котёл Таши со всякой всячиной');
});

test('D&D: стандартный набор под класс', () => {
  for (const ed of ['2014', '2024']) {
    for (const c of D.classes.filter((x) => x.edition === ed)) {
      const a = RPG.dnd.standardArray(ed, c.id);
      const vals = ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => a[k]).sort((x, y) => y - x);
      assert.deepEqual(vals, [15, 14, 13, 12, 10, 8], `${ed} ${c.id}: это перестановка набора`);
    }
  }
  assert.equal(RPG.dnd.standardArray('2014', 'wizard').int, 15);
  assert.equal(RPG.dnd.standardArray('2014', 'barbarian').str, 15);
  assert.equal(RPG.dnd.standardArray('2014', 'bard').cha, 15);
  assert.equal(RPG.dnd.standardArray('2014', 'nope'), null);
});

test('D&D: новый персонаж — редакция 2014 и только Книга игрока', () => {
  const c = RPG.store.newCharacter('dnd5e');
  assert.equal(c.data.edition, '2014');
  assert.deepEqual(c.data.books, ['PHB14']);
  assert.equal(c.data.subclass, '');
});

// ---------- Свой вариант ----------
test('D&D: свой класс со своей костью хитов', () => {
  const d = { edition: '2014', cls: 'custom', customCls: 'Кровавый охотник', customHitDie: 10, level: 3, con: 14 };
  const c = RPG.dnd.resolveClass(d);
  assert.equal(c.custom, true);
  assert.equal(c.name, 'Кровавый охотник');
  assert.equal(c.hitDie, 10);
  assert.equal(RPG.dnd.hitDiceText('2014', c, 3), '3к10');
  const hp = RPG.dnd.hpFormula('2014', c, 3, 14); // 10+2 + 2*(6+2)
  assert.equal(hp.total, 28);
  assert.match(hp.text, /Кровавый охотник/);
  assert.equal(RPG.dnd.resolveClass({ edition: '2014', cls: 'custom', customCls: '', customHitDie: 7 }).hitDie, 8, 'неверная кость -> к8');
  assert.equal(RPG.dnd.resolveClass({ edition: '2014', cls: 'custom', customCls: '  ' }).name, 'Свой класс');
  assert.equal(RPG.dnd.resolveClass({ edition: '2014', cls: 'fighter' }).hitDie, 10, 'обычный класс тоже разрешается');
  assert.equal(RPG.dnd.resolveClass({ edition: '2014', cls: '' }), null);
  assert.equal(RPG.dnd.standardArray('2014', 'custom'), null, 'для своего класса рекомендации нет');
});

test('D&D: новый персонаж — поля своего варианта', () => {
  const d = RPG.store.newCharacter('dnd5e').data;
  assert.equal(d.customCls, '');
  assert.equal(d.customHitDie, 8);
  assert.equal(d.customSubclass, '');
});

test('GURPS: свои преимущества, недостатки и навыки', () => {
  const d = RPG.store.newCharacter('gurps4e').data;
  assert.deepEqual(d.custom, { advantages: [], disadvantages: [], skills: [] });
  const a = RPG.gurps.addCustomRef(d, 'advantages', { ru: '  Чутьё на золото ', cost: '5', note: 'Чует золото в 10 м' });
  assert.equal(a.ru, 'Чутьё на золото');
  assert.equal(a.custom, true);
  assert.ok(a.id);
  assert.equal(d.custom.advantages.length, 1);
  assert.equal(RPG.gurps.addCustomRef(d, 'advantages', { ru: '   ' }), null, 'без названия не добавляется');
  assert.equal(RPG.gurps.addCustomRef(d, 'nonsense', { ru: 'X' }), null);
  const s = RPG.gurps.addCustomRef(d, 'skills', { ru: 'Варка зелий', attr: 'IQ', diff: 'H' });
  assert.equal(s.attr, 'IQ');
  assert.equal(s.diff, 'H');
  const bad = RPG.gurps.addCustomRef(d, 'skills', { ru: 'Странный', attr: 'XX', diff: 'Q' });
  assert.equal(bad.attr, 'IQ', 'неизвестная характеристика -> IQ');
  assert.equal(bad.diff, 'A', 'неизвестная сложность -> A');
  const G = { advantages: [{ en: 'Combat Reflexes', ru: 'Боевые рефлексы', cost: '15', pages: [43] }], disadvantages: [], skills: [] };
  const merged = RPG.gurps.refList(G, d, 'advantages');
  assert.equal(merged.length, 2);
  assert.equal(merged[0].ru, 'Чутьё на золото', 'своё — сверху');
  assert.deepEqual(RPG.gurps.searchRefs(merged, 'золото').map((t) => t.ru), ['Чутьё на золото']);
  assert.equal(RPG.gurps.removeCustomRef(d, 'advantages', a.id), true);
  assert.equal(d.custom.advantages.length, 0);
  const old = RPG.store.normalize({ id: 'g1234567', system: 'gurps4e', data: { name: 'Старый' } });
  assert.deepEqual(old.data.custom, { advantages: [], disadvantages: [], skills: [] }, 'старые персонажи получают пустые списки');
});
