// Сквозные тесты интерфейса в настоящем браузере (Chromium через Playwright).
// Запуск: node build.js && node --test tests/e2e.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
// Внешние запросы (шрифты Google) в тестах блокируются, поэтому ошибки их загрузки не считаются.
// Тот же каркас, в который страницу оборачивает публикация.
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + PAGE + '</body></html>';

let browser;
test.before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
});
test.after(async () => { await browser.close(); });

async function open(width, height, { touch = false, ctx } = {}) {
  const context = ctx || await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (r) => (r.request().url().startsWith('http://app.test') ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort()));
  await page.goto('http://app.test/');
  return { page, context, errors };
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('выбор игры: три системы, без ошибок и горизонтальной прокрутки', async () => {
  const { page, errors, context } = await open(390, 800, { touch: true });
  assert.equal(await page.locator('.game[data-game]').count(), 3);
  assert.equal(await noHScroll(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: новый персонаж, модификаторы, навыки, сохранение после перезагрузки', async () => {
  const { page, errors, context } = await open(1280, 900);
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.fill('#f_name', 'Торин');
  await page.fill('#f_str', '16');
  assert.equal(await page.textContent('[data-calc="mod:str"]'), '+3');
  assert.equal(await page.textContent('[data-calc="prof"]'), '+2');
  await page.fill('#f_level', '5');
  assert.equal(await page.textContent('[data-calc="prof"]'), '+3');
  await page.click('[data-skill="athletics"]');
  assert.equal(await page.textContent('[data-calc="skill:athletics"]'), '+6', 'Сил +3, владение +3');
  await page.click('[data-skill="athletics"]');
  assert.equal(await page.textContent('[data-calc="skill:athletics"]'), '+9', 'компетентность');
  await page.click('[data-save="con"]');
  assert.equal(await page.textContent('[data-calc="save:con"]'), '+3');
  assert.equal(await page.textContent('.crumbs .here'), 'Торин');
  await page.waitForTimeout(500); // сохранение с задержкой 300 мс
  await page.reload();
  await page.waitForSelector('#f_str');
  assert.equal(await page.inputValue('#f_str'), '16', 'значение пережило перезагрузку');
  assert.equal(await page.textContent('[data-calc="skill:athletics"]'), '+9');
  assert.deepEqual(errors, []);
  await context.close();
});

test('GURPS: стоимость характеристик и остаток очков', async () => {
  const { page, errors, context } = await open(1280, 900);
  await page.click('[data-game="gurps4e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.fill('#f_DX', '12');
  assert.equal(await page.textContent('[data-calc="cost:DX"]'), '[40]');
  await page.fill('#f_ST', '13');
  assert.equal(await page.textContent('[data-calc="g:HP"] >> nth=0'), '13');
  await page.fill('#f_disadvPoints', '-20');
  const unspent = await page.textContent('[data-calc="budget"] b');
  assert.equal(unspent, String(150 - 40 - 30 + 20));
  assert.equal(await page.textContent('[data-calc="g:BasicSpeed"]'), '5,5');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Манчкин: кнопки уровня и боевая сила, уровень не выше 10', async () => {
  const { page, errors, context } = await open(390, 800, { touch: true });
  await page.click('[data-game="munchkin"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  for (let i = 0; i < 12; i++) await page.click('[data-step="level"][data-d="1"]');
  assert.equal(await page.textContent('[data-calc="mk:level"]'), '10');
  await page.click('[data-step="gear"][data-d="1"]');
  await page.click('[data-step="bonus"][data-d="1"]');
  assert.equal(await page.textContent('[data-calc="mk:combat"]'), '12');
  assert.match(await page.textContent('[data-calc="mk:win"]'), /Победа/);
  assert.equal(await noHScroll(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('телефон: свайп вправо открывает справку, влево закрывает; «?» показывает пояснение', async () => {
  const { page, errors, context } = await open(390, 800, { touch: true });
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  const isOpen = () => page.evaluate(() => document.body.classList.contains('help-open'));
  assert.equal(await isOpen(), false, 'на телефоне справка сначала закрыта');

  const swipe = (x1, x2) => page.evaluate(([a, b]) => {
    const el = document.querySelector('.hero, .block h2') || document.body;
    const mk = (type, x) => new TouchEvent(type, { bubbles: true, touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })] });
    el.dispatchEvent(mk('touchstart', a));
    el.dispatchEvent(mk('touchend', b));
  }, [x1, x2]);

  await swipe(40, 260);
  assert.equal(await isOpen(), true, 'свайп вправо открыл');
  await swipe(300, 60);
  assert.equal(await isOpen(), false, 'свайп влево закрыл');

  await page.click('#view [data-help="ac"]'); // такая же кнопка есть в списке полей справки
  assert.equal(await isOpen(), true, '«?» открыл панель');
  assert.match(await page.textContent('#fieldCard'), /Класс доспеха/);
  await page.waitForTimeout(300);
  await page.click('#scrim', { position: { x: 380, y: 400 } });
  assert.equal(await isOpen(), false, 'тап по затемнению закрыл');
  assert.equal(await noHScroll(page), true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('компьютер: справка закреплена сбоку, кнопка её скрывает; поиск по полям', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="gurps4e"]');
  assert.equal(await page.isVisible('#help'), true, 'панель видна сразу');
  const mainX = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().left);
  assert.ok(mainX >= 300, 'лист не перекрыт панелью');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса // поиск по полям есть только внутри листа
  await page.fill('#helpSearch', 'уклон');
  assert.equal(await page.locator('#glossary button').count(), 1);
  await page.click('#glossary button');
  assert.match(await page.textContent('#fieldCard'), /Уклонение/);
  await page.click('#helpBtn');
  assert.equal(await page.isVisible('#help'), false, 'кнопка скрыла панель');
  assert.deepEqual(errors, []);
  await context.close();
});

test('выгрузка и загрузка файла', async () => {
  const { page, errors, context } = await open(1280, 900);
  await page.click('[data-game="munchkin"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.fill('#f_name', 'Вася');
  await page.goto('http://app.test/#list-munchkin');
  // Страница открыта как обычный файл (вне Claude): выгрузка должна сразу скачать .json
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('[data-act="export"]')]);
  assert.match(dl.suggestedFilename(), /\.json$/);
  const json = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.equal(await page.locator('#exportText').count(), 0, 'окно «скачать не получилось» не появляется');
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = (await open(0, 0, { ctx: ctx2 })).page;
  await p2.click('[data-game="munchkin"]');
  await p2.setInputFiles('#importFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await p2.waitForSelector('.char');
  assert.match(await p2.textContent('.chars'), /Вася/);
  assert.deepEqual(errors, []);
  await ctx2.close();
  await context.close();
});

test('справка показывает только нужное на текущем экране', async () => {
  const { page, errors, context } = await open(1366, 900);
  const helpText = () => page.textContent('#help');
  // Выбор игры: нет списка полей и пояснений к полям
  assert.equal(await page.locator('#glossary').count(), 0);
  // Список персонажей: шаги создания и ссылки, но не список полей
  await page.click('[data-game="dnd5e"]');
  assert.match(await helpText(), /Как создать персонажа/);
  assert.match(await helpText(), /Где читать правила/);
  assert.equal(await page.locator('#glossary').count(), 0, 'на списке персонажей нет списка полей');
  assert.equal(await page.locator('#helpSearch').count(), 0, 'и нет поиска по полям');
  // Открыли лист: список полей появился
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  assert.equal(await page.locator('#glossary').count(), 1, 'в листе список полей есть');
  // Заголовка «Это поле» нет нигде
  assert.doesNotMatch(await helpText(), /Это поле/i);
  await page.click('#view [data-help="ac"]');
  assert.doesNotMatch(await helpText(), /Это поле/i);
  assert.match(await page.textContent('#fieldCard'), /Класс доспеха/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: «?» у заголовка «Характеристики» объясняет все шесть, а не только Силу', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.click('#view h2:has-text("Характеристики") .q');
  const card = await page.textContent('#fieldCard');
  for (const n of ['Сила', 'Ловкость', 'Телосложение', 'Интеллект', 'Мудрость', 'Харизма']) assert.ok(card.includes(n), n);
  assert.deepEqual(errors, []);
  await context.close();
});

async function newDnd(page) {
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
}

test('D&D: книги фильтруют классы и подклассы, источник подписан', async () => {
  const { page, errors, context } = await open(1366, 900);
  await newDnd(page);
  const classOpts = () => page.$$eval('#f_cls option', (os) => os.map((o) => o.value).filter((v) => v && v !== 'custom')); // без «Свой вариант…»
  assert.equal((await classOpts()).length, 12, 'только Книга игрока 2014');
  assert.ok(!(await classOpts()).includes('artificer'));
  await page.check('#f_extended'); // дополнительные книги видны в расширенном наборе
  await page.check('[data-book="TCE"]');
  assert.ok((await classOpts()).includes('artificer'), 'Таша добавила изобретателя');
  await page.selectOption('#f_cls', 'fighter');
  assert.match(await page.textContent('[data-calc="source:cls"]'), /Книга игрока \(2014\)/);
  const subs = () => page.$$eval('#f_subclass option', (os) => os.map((o) => o.textContent));
  assert.ok((await subs()).some((t) => /Рунный рыцарь/.test(t) && /Котёл Таши/.test(t)), 'подкласс подписан книгой');
  assert.ok(!(await subs()).some((t) => /Самурай/.test(t)), 'Занатар не отмечен — самурая нет');
  await page.selectOption('#f_subclass', { label: (await subs()).find((t) => /Рунный/.test(t)) });
  assert.match(await page.textContent('[data-calc="source:subclass"]'), /Котёл Таши/);
  // 2024: другие книги и подклассы
  await page.selectOption('#f_edition', '2024');
  assert.equal(await page.isChecked('[data-book="PHB24"]'), true, 'для 2024 отмечена Книга игрока 2024');
  assert.equal(await page.locator('[data-book="TCE"]').count(), 0, 'книг 2014 в списке нет');
  assert.equal(await page.inputValue('#f_cls'), 'fighter', 'класс сохранился — он есть и в 2024');
  assert.ok((await subs()).some((t) => /Пси-воин/.test(t)));
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: кость хитов меняется по классу и уровню, хиты объясняются под класс', async () => {
  const { page, errors, context } = await open(1366, 900);
  await newDnd(page);
  await page.selectOption('#f_cls', 'wizard');
  assert.equal(await page.textContent('[data-calc="hitDice"]'), '1к6');
  await page.selectOption('#f_cls', 'barbarian');
  assert.equal(await page.textContent('[data-calc="hitDice"]'), '1к12');
  await page.fill('#f_level', '4');
  assert.equal(await page.textContent('[data-calc="hitDice"]'), '4к12');
  await page.fill('#f_con', '14');
  await page.click('#view [data-help="hp"] >> nth=0');
  const card = await page.textContent('#fieldCard');
  assert.match(card, /Варвар/);
  assert.match(card, /к12/);
  assert.match(card, /= 41/, '14 + 3 × (7 + 2) по среднему');
  const title = await page.getAttribute('[data-hp-tip]', 'title');
  assert.match(title, /Варвар/, 'подсказка при наведении на хиты');
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: стандартный набор под класс в справке и кнопка «Расставить»', async () => {
  const { page, errors, context } = await open(1366, 900);
  await newDnd(page);
  assert.equal(await page.locator('#stdArray').count(), 0, 'до выбора класса набора нет');
  await page.selectOption('#f_cls', 'wizard');
  assert.match(await page.textContent('#stdArray'), /Волшебник/);
  await page.click('#applyArray');
  assert.equal(await page.inputValue('#f_int'), '15');
  assert.equal(await page.inputValue('#f_str'), '8');
  assert.equal(await page.textContent('[data-calc="mod:int"]'), '+2');
  // второй раз значения уже не 10 — нужно подтверждение
  await page.selectOption('#f_cls', 'barbarian');
  await page.click('#applyArray');
  assert.equal(await page.inputValue('#f_str'), '8', 'без подтверждения не заменяет');
  await page.click('#applyArrayYes');
  assert.equal(await page.inputValue('#f_str'), '15');
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: у класса нет «свой вариант», старый «Воин» выбран из списка', async () => {
  const { page, errors, context } = await open(1366, 900);
  const old = { app: 'rpg-sheets', version: 1, characters: [{ id: 'oldchar01', system: 'dnd5e', data: { name: 'Старый', cls: 'Воин' } }] };
  await page.evaluate((v) => localStorage.setItem('rpg-sheets.v1', JSON.stringify(v)), old);
  await page.goto('http://app.test/#sheet-oldchar01');
  await page.reload();
  await page.waitForSelector('#f_cls');
  assert.equal(await page.inputValue('#f_cls'), 'fighter');
  assert.doesNotMatch(await page.textContent('#f_cls'), /свой вариант/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('GURPS: справочник со страницами и поиском, выбор PDF книги', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="gurps4e"]');
  assert.equal(await page.locator('#bookFile').count(), 1, 'выбор PDF есть уже на списке персонажей');
  assert.equal(await page.locator('#refList').count(), 0, 'справочника на списке нет');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.click('[data-reftab="advantages"]');
  await page.fill('#refSearch', 'рефлекс');
  const row = page.locator('#refList [data-ref="Combat Reflexes"]');
  assert.match(await row.textContent(), /Боевые рефлексы/);
  assert.match(await row.textContent(), /Combat Reflexes/);
  assert.match(await row.textContent(), /стр\. 43/);
  await page.click('[data-reftab="skills"]');
  await page.fill('#refSearch', 'палаш');
  assert.match(await page.textContent('#refList'), /DX\/A/);
  assert.match(await page.textContent('#refList'), /стр\. 208/);
  // без файла книги кнопка страницы просит выбрать PDF
  await page.click('#refList [data-page="208"]');
  assert.match(await page.textContent('#help'), /чтобы открыть стр\. 208/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: свой класс и подкласс', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  const last = await page.$eval('#f_cls option:last-child', (o) => [o.value, o.textContent]);
  assert.deepEqual(last, ['custom', 'Свой вариант…'], 'пункт в конце списка');
  await page.selectOption('#f_cls', 'custom');
  await page.fill('#f_customCls', 'Кровавый охотник');
  await page.selectOption('#f_customHitDie', '12');
  assert.equal(await page.textContent('[data-calc="hitDice"]'), '1к12');
  assert.match(await page.textContent('[data-calc="source:cls"]'), /Домашнее правило/);
  assert.doesNotMatch(await page.textContent('#f_cls'), /Воин \(/, 'у обычных классов пометок нет');
  await page.selectOption('#f_subclass', 'custom');
  await page.fill('#f_customSubclass', 'Орден Мутантов');
  // ждём, пока сохранение (с задержкой) действительно запишет данные, а не фиксированные 500 мс
  await page.waitForFunction(() => (localStorage.getItem('rpg-sheets.v1') || '').includes('Орден Мутантов'));
  await page.reload();
  await page.waitForSelector('#f_customCls');
  assert.equal(await page.inputValue('#f_customCls'), 'Кровавый охотник');
  assert.equal(await page.inputValue('#f_customSubclass'), 'Орден Мутантов');
  assert.equal(await page.textContent('[data-calc="hitDice"]'), '1к12');
  assert.deepEqual(errors, []);
  await context.close();
});

test('GURPS: своё преимущество в справочнике', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="gurps4e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.click('[data-reftab="advantages"]');
  await page.click('#refAddBtn');
  await page.fill('#refAddName', 'Чутьё на золото');
  await page.fill('#refAddCost', '5');
  await page.fill('#refAddNote', 'Чует золото в 10 м');
  await page.click('#refAddSave');
  await page.fill('#refSearch', 'золото');
  const row = await page.textContent('#refList');
  assert.match(row, /Чутьё на золото/);
  assert.match(row, /своё/);
  assert.match(row, /Чует золото/);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('#refSearch');
  await page.click('[data-reftab="advantages"]');
  await page.fill('#refSearch', 'золото');
  assert.match(await page.textContent('#refList'), /Чутьё на золото/, 'сохранилось');
  await page.click('#refList [data-delref]');
  assert.doesNotMatch(await page.textContent('#refList'), /Чутьё на золото/, 'удалилось');
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: страницы Книги игрока у класса и справочник рас и предысторий', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="dnd5e"]');
  assert.equal(await page.locator('#bookFile').count(), 1, 'выбор PDF Книги игрока на списке персонажей');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.selectOption('#f_cls', 'fighter');
  assert.match(await page.textContent('[data-calc="source:cls"]'), /стр\. 70/);
  await page.click('#view [data-calc="source:cls"] [data-page="70"]');
  assert.match(await page.textContent('#help'), /чтобы открыть стр\. 70/);
  await page.click('[data-reftab="races"]');
  await page.fill('#refSearch', 'дроу');
  assert.match(await page.textContent('#refList'), /Тёмный эльф \(дроу\)/);
  assert.match(await page.textContent('#refList'), /стр\. 24/);
  await page.click('[data-reftab="backgrounds"]');
  await page.fill('#refSearch', 'мудрец');
  assert.match(await page.textContent('#refList'), /стр\. 137/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: происхождение и предыстория из книг, источник и страница', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  const opts = (sel) => page.$$eval(sel + ' option', (os) => os.map((o) => o.textContent));
  assert.ok(!(await opts('#f_race')).some((t) => /Табакси/.test(t)));
  assert.equal((await opts('#f_race')).slice(-1)[0], 'Свой вариант…');
  await page.selectOption('#f_race', 'Эльф');
  assert.match(await page.textContent('[data-calc="source:race"]'), /Книга игрока \(2014\), стр\. 21/);
  await page.selectOption('#f_raceSub', 'Тёмный эльф (дроу)');
  assert.match(await page.textContent('[data-calc="source:raceSub"]'), /стр\. 24/);
  await page.selectOption('#f_background', 'Мудрец');
  assert.match(await page.textContent('[data-calc="source:background"]'), /стр\. 137/);
  await page.check('#f_extended');
  await page.check('[data-book="VGM"]');
  assert.ok((await opts('#f_race')).some((t) => /Табакси/.test(t)), 'книга Воло добавила табакси');
  assert.equal(await page.inputValue('#f_race'), 'Эльф', 'выбор сохранился');
  await page.selectOption('#f_race', 'custom');
  await page.fill('#f_customRace', 'Кот-воин');
  assert.match(await page.textContent('[data-calc="source:race"]'), /Домашнее правило/);
  // справка у «Игрок» отличается от «Имя»
  await page.click('#view label[for="f_player"] .q');
  assert.match(await page.textContent('#fieldCard'), /Игрок/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('выгрузка внутри Claude без разрешения на файлы — окно с текстом', async () => {
  const { page, errors, context } = await open(1280, 900);
  await page.evaluate(() => { window.claude = { use: async () => null }; });
  await page.click('[data-game="munchkin"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  await page.goto('http://app.test/#list-munchkin');
  await page.evaluate(() => { window.claude = { use: async () => null }; });
  await page.click('[data-act="export"]');
  assert.match(await page.inputValue('#exportText'), /rpg-sheets/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('D&D: стандартный режим — только Книга игрока, расширенный открывает остальные книги', async () => {
  const { page, errors, context } = await open(1366, 900);
  await page.click('[data-game="dnd5e"]');
  await page.click('[data-act="new"]'); await page.waitForSelector('#sheet'); // лист открывается после смены адреса
  assert.equal(await page.isChecked('#f_extended'), false, 'по умолчанию стандартный');
  assert.equal(await page.locator('[data-book="VGM"]').count(), 0, 'дополнения скрыты');
  await page.check('#f_extended');
  await page.check('[data-book="VGM"]');
  const races = () => page.$$eval('#f_race option', (os) => os.map((o) => o.textContent));
  assert.ok((await races()).includes('Табакси'));
  await page.uncheck('#f_extended');
  assert.equal(await page.locator('[data-book="VGM"]').count(), 0);
  assert.ok(!(await races()).includes('Табакси'), 'в стандартном режиме дополнения не учитываются');
  await page.check('#f_extended');
  assert.equal(await page.isChecked('[data-book="VGM"]'), true, 'отметка запомнилась');
  assert.ok((await races()).includes('Табакси'));
  assert.deepEqual(errors, []);
  await context.close();
});
