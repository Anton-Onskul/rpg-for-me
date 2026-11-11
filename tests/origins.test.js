// Происхождение (раса/вид), разновидность и предыстория: фильтр по книгам, источник и страница.
const test = require('node:test');
const assert = require('node:assert/strict');
const RPG = require('../src/core.js');
const D = RPG.dnd5eData;
const HELP = require('../src/help.js');

test('данные происхождений: у каждого книги той же редакции', () => {
  for (const ed of ['2014', '2024']) {
    const races = D.races.filter((r) => r.edition === ed);
    assert.ok(races.length >= 9, ed);
    for (const r of races) {
      const own = r.books.concat(...r.subs.map((s) => s.books));
      assert.ok(own.length >= 1, r.name);
      for (const b of own) { assert.ok(D.books[b], `${r.name}: книга ${b}`); assert.equal(D.books[b].edition, ed, `${r.name}: ${b}`); }
    }
  }
});

test('происхождения: только Книга игрока 2014', () => {
  const list = RPG.dnd.availableRaces('2014', ['PHB14']);
  assert.deepEqual(list.map((r) => r.name).sort(), ['Гном', 'Дварф', 'Драконорождённый', 'Полуорк', 'Полурослик', 'Полуэльф', 'Тифлинг', 'Человек', 'Эльф'].sort());
  const elf = list.find((r) => r.name === 'Эльф');
  assert.deepEqual(elf.subs.map((s) => s.name), ['Высший эльф', 'Лесной эльф', 'Тёмный эльф (дроу)']);
  assert.equal(elf.page, 21);
  assert.equal(elf.subs[2].page, 24);
});

test('происхождения: книги добавляют расы и разновидности', () => {
  const withVgm = RPG.dnd.availableRaces('2014', ['PHB14', 'VGM']).map((r) => r.name);
  assert.ok(withVgm.includes('Табакси'));
  assert.ok(!RPG.dnd.availableRaces('2014', ['PHB14']).map((r) => r.name).includes('Табакси'));
  const elfMtf = RPG.dnd.availableRaces('2014', ['PHB14', 'MTF']).find((r) => r.name === 'Эльф');
  assert.ok(elfMtf.subs.some((s) => s.name === 'Морской эльф'));
  // раса только из дополнения доступна, даже если Книги игрока нет среди её книг
  assert.ok(RPG.dnd.availableRaces('2014', ['PHB14', 'ERLW']).some((r) => r.name === 'Кованый'));
  const p24 = RPG.dnd.availableRaces('2024', ['PHB24']).map((r) => r.name);
  assert.ok(p24.includes('Голиаф') && p24.includes('Орк') && p24.includes('Аасимар'));
  assert.ok(!p24.includes('Полуэльф'), 'в 2024 полуэльфа нет');
});

test('предыстории: фильтр по книгам и страницы', () => {
  const p14 = RPG.dnd.availableBackgrounds('2014', ['PHB14']);
  assert.equal(p14.length, 13);
  assert.equal(p14.find((b) => b.name === 'Мудрец').page, 137);
  assert.ok(RPG.dnd.availableBackgrounds('2014', ['PHB14', 'SCAG']).length > 13);
  const p24 = RPG.dnd.availableBackgrounds('2024', ['PHB24']);
  assert.equal(p24.length, 16);
  assert.ok(p24.some((b) => b.name === 'Фермер'));
});

test('поиск происхождения и предыстории по названию', () => {
  assert.equal(RPG.dnd.findRace('2014', 'Эльф').page, 21);
  assert.equal(RPG.dnd.findRace('2014', 'Нет такой'), null);
  assert.equal(RPG.dnd.findBackground('2014', 'Солдат').page, 140);
});

test('старые персонажи: текст происхождения и предыстории разбирается', () => {
  const n = (data) => RPG.store.normalize({ id: 'org12345', system: 'dnd5e', data: Object.assign({ edition: '2014' }, data) }).data;
  assert.deepEqual([n({ race: 'Эльф' }).race, n({ race: 'Эльф' }).raceSub], ['Эльф', '']);
  assert.deepEqual([n({ race: 'горный дварф' }).race, n({ race: 'горный дварф' }).raceSub], ['Дварф', 'Горный дварф']);
  const c = n({ race: 'Кот-воин' });
  assert.deepEqual([c.race, c.customRace], ['custom', 'Кот-воин']);
  assert.equal(n({ background: 'мудрец' }).background, 'Мудрец');
  const b = n({ background: 'Пекарь' });
  assert.deepEqual([b.background, b.customBackground], ['custom', 'Пекарь']);
  assert.equal(n({ race: '' }).race, '');
});

test('справка: у поля «Игрок» своё описание, есть разновидность', () => {
  const f = HELP.dnd5e.fields;
  assert.ok(f.player && f.player.text !== f.name.text);
  assert.ok(f.raceSub);
  assert.ok(HELP.gurps4e.fields.player && HELP.gurps4e.fields.player.text !== HELP.gurps4e.fields.name.text);
});

test('книги: стандартный и расширенный режим', () => {
  const d = RPG.store.newCharacter('dnd5e').data;
  assert.equal(d.extended, false);
  d.books = ['PHB14', 'VGM'];
  assert.deepEqual(RPG.dnd.effectiveBooks(d), ['PHB14'], 'стандартный — только Книга игрока');
  d.extended = true;
  assert.deepEqual(RPG.dnd.effectiveBooks(d), ['PHB14', 'VGM']);
  assert.deepEqual(RPG.dnd.effectiveBooks({ edition: '2024', books: ['PHB24'], extended: false }), ['PHB24']);
  const old = RPG.store.normalize({ id: 'ext12345', system: 'dnd5e', data: { edition: '2014', books: ['PHB14', 'TCE'] } }).data;
  assert.equal(old.extended, true, 'у старых персонажей с дополнениями включается расширенный режим');
  const plain = RPG.store.normalize({ id: 'ext12346', system: 'dnd5e', data: { edition: '2014', books: ['PHB14'] } }).data;
  assert.equal(plain.extended, false);
});
