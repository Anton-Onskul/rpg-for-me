// Справочник GURPS: данные извлечены из «Trait Lists» Basic Set (стр. 297–306).
const test = require('node:test');
const assert = require('node:assert/strict');
const RPG = require('../src/core.js');
const G = require('../src/gurps-data.js');

test('GURPS справочник: полнота и формат', () => {
  assert.ok(G.advantages.length >= 250, 'преимуществ ' + G.advantages.length);
  assert.ok(G.disadvantages.length >= 220, 'недостатков ' + G.disadvantages.length);
  assert.ok(G.skills.length >= 270, 'навыков ' + G.skills.length);
  for (const list of [G.advantages, G.disadvantages]) {
    for (const t of list) {
      assert.ok(t.en && t.ru && t.cost, JSON.stringify(t));
      assert.ok(t.pages.length >= 1 && t.pages.every((p) => Number.isInteger(p) && p >= 1 && p <= 336), t.en);
    }
  }
  for (const s of G.skills) {
    assert.ok(s.en && s.ru && ['IQ', 'DX', 'HT', 'ST', 'Will', 'Per', 'DX or IQ', 'IQ or DX'].includes(s.attr), JSON.stringify(s));
    assert.ok(['E', 'A', 'H', 'VH', 'Varies'].includes(s.diff), s.en);
    assert.ok(Number.isInteger(s.page) && s.page >= 167 && s.page <= 236, s.en + ' ' + s.page);
  }
});

test('GURPS справочник: сверка с книгой', () => {
  const adv = (n) => G.advantages.find((t) => t.en === n);
  const dis = (n) => G.disadvantages.find((t) => t.en === n);
  const sk = (n) => G.skills.find((t) => t.en === n);
  assert.deepEqual([adv('Combat Reflexes').cost, adv('Combat Reflexes').pages], ['15', [43]]);
  assert.deepEqual([adv('Legal Enforcement Powers').cost, adv('Legal Enforcement Powers').pages], ['5, 10, or 15', [65]]);
  assert.deepEqual([adv('Magery').cost, adv('Magery').pages], ['5 + 10/level', [66]]);
  assert.deepEqual([dis('Code of Honor').cost, dis('Code of Honor').pages], ['-1 or -5 to -15', [127, 163]]);
  assert.deepEqual(dis('Addiction').pages, [122, 164, 165]);
  assert.equal(dis('Bad Temper').cost, '-10*');
  assert.deepEqual([sk('Broadsword').attr, sk('Broadsword').diff, sk('Broadsword').page], ['DX', 'A', 208]);
  assert.deepEqual([sk('Computer Operation/TL').diff, sk('Computer Programming/TL').diff], ['E', 'H']);
  assert.equal(sk('Animal Handling').spec, true, '† — нужна специализация');
  assert.ok(sk('Two-Handed Axe/Mace') && sk('Parry Missile Weapons') && sk('Combat Art or Sport'), 'строки с переносом не потерялись');
  assert.equal(new Set(G.skills.map((s) => s.en)).size, G.skills.length, 'без дублей');
});

test('GURPS: страница книги -> страница PDF', () => {
  assert.equal(RPG.gurps.pdfPage(43), 45);
  assert.equal(RPG.gurps.pdfPage(297), 299);
  assert.equal(RPG.gurps.pdfPage('208'), 210);
});

test('GURPS: поиск по справочнику на русском и английском', () => {
  const f = (q) => RPG.gurps.searchRefs(G.advantages, q).map((t) => t.en);
  assert.ok(f('рефлекс').includes('Combat Reflexes'));
  assert.ok(f('COMBAT ref').includes('Combat Reflexes'));
  assert.ok(f('ё').length >= 0);
  assert.equal(RPG.gurps.searchRefs(G.advantages, '').length, G.advantages.length);
  assert.ok(RPG.gurps.searchRefs(G.skills, 'меч').some((s) => s.en === 'Broadsword'));
});

test('D&D: старый текст класса превращается в выбор из списка', () => {
  const c = RPG.store.normalize({ id: 'old12345', system: 'dnd5e', data: { cls: 'Воин' } });
  assert.equal(c.data.cls, 'fighter');
  assert.equal(RPG.store.normalize({ id: 'old12346', system: 'dnd5e', data: { cls: ' волшебник ' } }).data.cls, 'wizard');
  const hb = RPG.store.normalize({ id: 'old12347', system: 'dnd5e', data: { cls: 'Кровавый охотник' } }).data;
  assert.equal(hb.cls, 'custom', 'неизвестный класс становится своим вариантом');
  assert.equal(hb.customCls, 'Кровавый охотник');
  assert.equal(RPG.store.normalize({ id: 'old12348', system: 'dnd5e', data: { cls: 'rogue' } }).data.cls, 'rogue');
});
