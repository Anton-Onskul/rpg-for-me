// Тесты справки: у каждого поля листа есть пояснение, у каждой игры — ссылки и шаги создания.
const test = require('node:test');
const assert = require('node:assert/strict');
const HELP = require('../src/help.js');
const RPG = require('../src/core.js');

// Поля, которые видит игрок на листе: на каждое должна быть подсказка.
const FIELDS = {
  dnd5e: ['name', 'cls', 'level', 'race', 'background', 'alignment', 'xp',
    'str', 'dex', 'con', 'int', 'wis', 'cha', 'prof', 'saves', 'skills', 'passive', 'inspiration',
    'ac', 'initiative', 'speed', 'hp', 'hitDice', 'death',
    'attacks', 'equipment', 'proficiencies', 'features', 'personality', 'notes',
    ...RPG.store.DND_SKILLS.map((s) => 'skill_' + s)],
  gurps4e: ['name', 'points', 'tl', 'sm', 'ST', 'DX', 'IQ', 'HT', 'HP', 'Will', 'Per', 'FP',
    'BasicSpeed', 'BasicMove', 'Dodge', 'BasicLift', 'advantages', 'disadvantages', 'skills',
    'equipment', 'notes', 'unspent'],
  munchkin: ['name', 'level', 'gear', 'bonus', 'combat', 'race', 'cls', 'sex', 'notes'],
};

for (const sys of Object.keys(FIELDS)) {
  test(`справка ${sys}: есть название, ссылки и шаги создания персонажа`, () => {
    const h = HELP[sys];
    assert.ok(h, 'раздел справки есть');
    assert.ok(h.title && h.title.length > 2);
    assert.ok(Array.isArray(h.links) && h.links.length >= 1, 'хотя бы одна ссылка на правила');
    for (const l of h.links) {
      assert.match(l.url, /^https:\/\//, `ссылка ${l.title} — https`);
      assert.ok(l.title && l.title.length > 2);
    }
    assert.ok(Array.isArray(h.creation) && h.creation.length >= 4, 'не меньше 4 шагов создания');
  });

  test(`справка ${sys}: пояснение к каждому полю листа`, () => {
    const missing = FIELDS[sys].filter((k) => !HELP[sys] || !HELP[sys].fields || !HELP[sys].fields[k]);
    assert.deepEqual(missing, [], 'поля без подсказки');
    for (const k of FIELDS[sys]) {
      const f = HELP[sys].fields[k];
      assert.ok(f.title && f.text && f.text.length >= 20, `подсказка ${k} содержательная`);
    }
  });
}

test('справка dnd5e: общее пояснение «Характеристики» кратко описывает все шесть', () => {
  const f = HELP.dnd5e.fields.abilities;
  assert.ok(f, 'есть поле abilities');
  for (const name of ['Сила', 'Ловкость', 'Телосложение', 'Интеллект', 'Мудрость', 'Харизма']) {
    assert.ok(f.text.includes(name), `упомянута ${name}`);
  }
});

test('справка dnd5e: шаг про характеристики — 27 очков, без «покупки» и без стандартного набора', () => {
  const step = HELP.dnd5e.creation.find((s) => /характеристик/i.test(s) && /27/.test(s));
  assert.ok(step, 'есть шаг с 27 очками');
  assert.doesNotMatch(step, /покупк/i);
  assert.doesNotMatch(step, /15, 14, 13/);
  assert.doesNotMatch(HELP.dnd5e.creation.join(' '), /стандартный набор 15/i);
});

test('справка dnd5e: есть подсказки к редакции, книгам и подклассу', () => {
  for (const k of ['edition', 'books', 'subclass']) assert.ok(HELP.dnd5e.fields[k], k);
});
