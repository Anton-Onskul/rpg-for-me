// Сквозные тесты режима мастера: стартовый экран, стол мастера, подключение игрока во втором окне.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  + '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + PAGE + '</body></html>';

/** Однотонная PNG-картинка w×h — «карта» для загрузки. */
function png(w, h, rgb = [90, 120, 80]) {
  const crc = (buf) => { let c, crcT = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = crcT[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); });
test.after(async () => { await browser.close(); });

async function newPage(context, hash = '') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (r) => (r.request().url().startsWith('http://app.test') ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort()));
  await page.goto('http://app.test/' + hash);
  return { page, errors };
}

async function gmWithScene(page) {
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  await page.click('[data-tab="scenes"]');
  await page.fill('#sceneName', 'Таверна');
  await page.setInputFiles('#sceneImage', { name: 'map.png', mimeType: 'image/png', buffer: png(500, 400) });
  await page.click('#sceneAdd');
  await page.waitForSelector('.map-bg');
}
async function addToken(page, name, kind, extra = {}) {
  await page.click('[data-tab="tokens"]');
  await page.fill('#tokName', name);
  await page.selectOption('#tokKind', kind);
  if (extra.hp) await page.fill('#tokHp', String(extra.hp));
  await page.click('#tokAdd');
  await page.waitForSelector(`.token[data-name="${name}"]`);
}
const tokenNames = (page) => page.$$eval('.token', (ts) => ts.map((t) => t.dataset.name).sort());

test('стартовый экран: игрок или мастер', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const { page, errors } = await newPage(context);
  assert.equal(await page.locator('[data-role]').count(), 2);
  await page.click('[data-role="player"]');
  await page.waitForSelector('.game[data-game]');
  assert.equal(await page.locator('.game[data-game]').count(), 3, 'игрок попадает к выбору игры');
  assert.equal(await page.locator('[data-act="join"]').count(), 1, 'есть подключение к столу мастера');
  await page.goto('http://app.test/');
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'на телефоне без прокрутки вбок');
  assert.deepEqual(errors, []);
  await context.close();
});

test('мастер: сцена с картой, фишки, кубики и бой', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await gmWithScene(page);
  assert.match(await page.textContent('#sceneList'), /Таверна/);
  await addToken(page, 'Гоблин', 'npc', { hp: 7 });
  await addToken(page, 'Торин', 'pc', { hp: 12 });
  assert.deepEqual(await tokenNames(page), ['Гоблин', 'Торин']);
  // кубики
  await page.click('[data-tab="chat"]').catch(() => {});
  await page.fill('#diceExpr', '2к6+3');
  await page.click('#diceRoll');
  await page.waitForSelector('#chatLog .msg');
  assert.match(await page.textContent('#chatLog'), /2к6\+3/);
  assert.match(await page.textContent('#chatLog'), /= \d+/);
  await page.fill('#diceExpr', 'ерунда');
  await page.click('#diceRoll');
  assert.match(await page.textContent('#diceMsg'), /Не понял/);
  // бой
  await page.click('[data-tab="combat"]');
  await page.click('#combatStart');
  await page.click('#combatAddAll');
  assert.equal(await page.locator('#combatList .cb').count(), 2);
  assert.match(await page.textContent('#combatRound'), /Раунд 1/);
  await page.click('#combatNext');
  await page.click('#combatNext');
  assert.match(await page.textContent('#combatRound'), /Раунд 2/);
  // сохранение кампании между перезагрузками
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.token[data-name="Торин"]');
  assert.deepEqual(await tokenNames(page), ['Гоблин', 'Торин'], 'кампания сохранилась');
  assert.deepEqual(errors, []);
  await context.close();
});

test('мастер и игрок: подключение, видимость, ход фишкой, туман, чат', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const gm = await newPage(context);
  await gmWithScene(gm.page);
  await addToken(gm.page, 'Торин', 'pc', { hp: 12 });
  await addToken(gm.page, 'Гоблин', 'npc', { hp: 7 });
  await addToken(gm.page, 'Призрак', 'npc');
  // скрыть призрака
  await gm.page.click('.token[data-name="Призрак"]');
  await gm.page.check('#tokEditHidden');
  const code = (await gm.page.textContent('#roomCode')).trim();
  assert.match(code, /^[A-Z2-9]{6}$/);

  const pl = await newPage(context);
  await pl.page.click('[data-role="player"]');
  await pl.page.click('[data-act="join"]');
  await pl.page.waitForSelector('#joinName');
  await pl.page.fill('#joinName', 'Аня');
  await pl.page.fill('#joinCode', code.toLowerCase());
  await pl.page.click('#joinGo');
  await pl.page.waitForSelector('.token[data-name="Торин"]', { timeout: 8000 });
  assert.deepEqual(await tokenNames(pl.page), ['Гоблин', 'Торин'], 'скрытого призрака игрок не видит');
  assert.match(await gm.page.textContent('#playerList'), /Аня/);

  // мастер отдаёт Торина Ане
  await gm.page.click('.token[data-name="Торин"]');
  await gm.page.selectOption('#tokEditOwner', { label: 'Аня' });
  await pl.page.waitForSelector('.token.mine[data-name="Торин"]');
  // Аня двигает Торина на 3 клетки вправо
  const box = await pl.page.locator('.token[data-name="Торин"]').boundingBox();
  const cell = await pl.page.evaluate(() => document.querySelector('.token[data-name="Торин"]').getBoundingClientRect().width);
  await pl.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pl.page.mouse.down();
  await pl.page.mouse.move(box.x + box.width / 2 + cell * 3, box.y + box.height / 2, { steps: 6 });
  await pl.page.mouse.up();
  await gm.page.waitForFunction(() => {
    const t = document.querySelector('.token[data-name="Торин"]');
    return t && Number(t.dataset.x) === 175;
  }, null, { timeout: 5000 });
  // на гоблина Аня не может повлиять
  assert.equal(await pl.page.locator('.token.mine[data-name="Гоблин"]').count(), 0);

  // туман: гоблин скрывается от игрока
  await gm.page.click('[data-tab="scenes"]');
  await gm.page.check('#fogEnabled');
  await pl.page.waitForFunction(() => !document.querySelector('.token[data-name="Гоблин"]'), null, { timeout: 5000 });
  assert.deepEqual(await tokenNames(pl.page), ['Торин']);

  // чат: игрок пишет, мастер видит; скрытый бросок мастера игрок не видит
  await pl.page.fill('#chatText', 'Открываю дверь');
  await pl.page.click('#chatSend');
  await gm.page.waitForFunction(() => /Аня/.test(document.querySelector('#chatLog').textContent) && /Открываю дверь/.test(document.querySelector('#chatLog').textContent), null, { timeout: 5000 });
  await gm.page.check('#diceSecret');
  await gm.page.fill('#diceExpr', '1к20+7');
  await gm.page.click('#diceRoll');
  await gm.page.waitForTimeout(400);
  assert.doesNotMatch(await pl.page.textContent('#chatLog'), /1к20\+7/);
  assert.deepEqual(gm.errors, []);
  assert.deepEqual(pl.errors, []);
  await context.close();
});

test('мастер выбирает НРИ прямо на столе: поля фишек, кубики, листы игроков', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const gm = await newPage(context);
  await gmWithScene(gm.page);
  const page = gm.page;
  assert.deepEqual(await page.$$eval('#tableSystem option', (o) => o.map((x) => x.value)), ['dnd2014', 'dnd2024', 'gurps', 'munchkin']);
  assert.equal(await page.inputValue('#tableSystem'), 'dnd2014');
  await page.click('[data-tab="tokens"]');
  assert.equal(await page.locator('#tokAc').count(), 1, 'D&D: КД у фишки');

  // GURPS
  await page.selectOption('#tableSystem', 'gurps');
  await page.click('[data-tab="tokens"]');
  for (const id of ['#tokHp', '#tokDr', '#tokDodge', '#tokMove']) assert.equal(await page.locator(id).count(), 1, id);
  assert.equal(await page.locator('#tokAc').count(), 0, 'в GURPS нет КД');
  await page.fill('#tokName', 'Орк');
  await page.fill('#tokDr', '2');
  await page.click('#tokAdd');
  await page.click('.token[data-name="Орк"]');
  assert.equal(await page.inputValue('#tokEditDr'), '2', 'поле GURPS сохранилось у фишки');
  assert.equal(await page.locator('[data-die]').count(), 1, 'в GURPS кубик один — к6');
  assert.equal(await page.locator('#diceMode').count(), 0, 'нет преимущества/помехи');
  await page.fill('#diceExpr', '3к6');
  await page.fill('#diceSkill', '12');
  await page.click('#diceRoll');
  await page.waitForFunction(() => /навык 12/.test(document.querySelector('#chatLog').textContent));
  assert.match(await page.textContent('#chatLog'), /(успех|провал)/i);

  // Манчкин и игрок
  await page.selectOption('#tableSystem', 'munchkin');
  await page.click('[data-tab="tokens"]');
  assert.equal(await page.locator('#tokLevel').count(), 1);
  assert.equal(await page.locator('#tokHp').count(), 0, 'в Манчкине нет хитов');
  const code = (await page.textContent('#roomCode')).trim();

  const pl = await newPage(context);
  await pl.page.evaluate(() => localStorage.setItem('rpg-sheets.v1', JSON.stringify({ app: 'rpg-sheets', version: 1, characters: [
    { id: 'c1', system: 'dnd5e', created: 1, data: { name: 'Лира', edition: '2014' } },
    { id: 'c2', system: 'munchkin', created: 2, data: { name: 'Гном Вася', level: 3, gear: 4 } },
  ] })));
  await pl.page.reload();
  await pl.page.click('[data-role="player"]');
  await pl.page.click('[data-act="join"]');
  await pl.page.waitForSelector('#joinName');
  await pl.page.fill('#joinName', 'Аня');
  await pl.page.fill('#joinCode', code);
  await pl.page.click('#joinGo');
  await pl.page.waitForSelector('#tableSystemName', { timeout: 8000 });
  assert.match(await pl.page.textContent('#tableSystemName'), /Манчкин/);
  assert.equal(await pl.page.locator('[data-die]').count(), 1);
  await pl.page.click('[data-tab="hero"]');
  const opts = await pl.page.$$eval('#heroPick option', (o) => o.map((x) => x.textContent));
  assert.equal(opts.length, 1, 'игрок видит только персонажей НРИ стола');
  assert.match(opts[0], /Гном Вася/);
  await pl.page.click('#sheetSend');
  await page.click('[data-tab="players"]');
  await page.waitForFunction(() => /Гном Вася/.test(document.querySelector('#playerList').textContent), null, { timeout: 5000 });
  assert.match(await page.textContent('#playerList'), /Уровень/);

  // смена НРИ у мастера доходит до игрока
  await page.selectOption('#tableSystem', 'dnd2024');
  await pl.page.waitForFunction(() => /2024/.test(document.querySelector('#tableSystemName').textContent), null, { timeout: 5000 });
  assert.doesNotMatch(await page.textContent('#playerList'), /Гном Вася/, 'лист другой НРИ убран');
  assert.deepEqual(gm.errors, []);
  assert.deepEqual(pl.errors, []);
  await context.close();
});
