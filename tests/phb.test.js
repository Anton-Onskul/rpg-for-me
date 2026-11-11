// Книга игрока D&D 2014 (русский перевод): страницы классов, подклассов, рас и предысторий.
const test = require('node:test');
const assert = require('node:assert/strict');
const RPG = require('../src/core.js');
const D = RPG.dnd5eData;

test('PHB 2014: страницы классов', () => {
  const exp = { barbarian: 46, bard: 51, cleric: 56, druid: 64, fighter: 70, monk: 76, paladin: 82, ranger: 89,
    rogue: 94, sorcerer: 99, warlock: 105, wizard: 112 };
  for (const [id, page] of Object.entries(exp)) assert.equal(RPG.dnd.findClass('2014', id).page, page, id);
  assert.equal(RPG.dnd.findClass('2014', 'artificer').page, undefined, 'изобретателя в Книге игрока нет');
});

test('PHB 2014: подклассы названы как в переводе и со страницами', () => {
  for (const c of D.classes.filter((x) => x.edition === '2014')) {
    for (const s of c.subclasses) {
      if (s.books.includes('PHB14')) assert.ok(Number.isInteger(s.page) && s.page >= 46 && s.page <= 120, `${c.id}/${s.name}`);
      else assert.equal(s.page, undefined, `${s.name}: страницы только у подклассов Книги игрока`);
    }
  }
  const sub = (cls, name) => RPG.dnd.findClass('2014', cls).subclasses.find((s) => s.name === name);
  assert.equal(sub('barbarian', 'Путь берсерка').page, 49);
  assert.equal(sub('cleric', 'Домен знания').page, 61);
  assert.equal(sub('cleric', 'Домен знаний'), undefined, 'название как в книге');
  assert.equal(sub('warlock', 'Великий Древний').page, 109);
  assert.equal(sub('wizard', 'Школа прорицания').page, 119);
  assert.equal(sub('rogue', 'Мистический ловкач').page, 97);
});

test('PHB 2014: расы и предыстории', () => {
  const R = D.phb14;
  assert.equal(R.races.length, 9);
  assert.equal(R.backgrounds.length, 13);
  const race = (n) => R.races.find((r) => r.ru === n);
  assert.equal(race('Тифлинг').page, 42);
  assert.equal(race('Дварф').page, 18);
  assert.deepEqual(race('Эльф').sub.map((s) => [s.ru, s.page]), [['Высший эльф', 23], ['Лесной эльф', 24], ['Тёмный эльф (дроу)', 24]]);
  assert.equal(R.backgrounds.find((b) => b.ru === 'Мудрец').page, 137);
  for (const r of R.races) assert.ok(Number.isInteger(r.page) && r.page >= 18 && r.page <= 44, r.ru);
  for (const b of R.backgrounds) assert.ok(Number.isInteger(b.page) && b.page >= 125 && b.page <= 142, b.ru);
});

test('PHB 2014: страница книги -> страница PDF', () => {
  assert.equal(RPG.dnd.pdfPage(46), 47);
  assert.equal(RPG.dnd.pdfPage('137'), 138);
});

test('PHB 2014: старое название «Домен знаний» переводится в «Домен знания»', () => {
  const c = RPG.store.normalize({ id: 'oldphb01', system: 'dnd5e', data: { edition: '2014', cls: 'cleric', subclass: 'Домен знаний' } });
  assert.equal(c.data.subclass, 'Домен знания');
});

test('поиск по справочнику без английского названия', () => {
  const list = [{ ru: 'Тёмный эльф (дроу)', page: 24 }];
  assert.equal(RPG.gurps.searchRefs(list, 'undefined').length, 0, 'пустое en не превращается в слово «undefined»');
  assert.equal(RPG.gurps.searchRefs(list, 'дроу').length, 1);
});
