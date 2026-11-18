// Сквозные тесты доработок стола: «Свернуть», подсказки по вкладкам, «Двигать» у игрока, карточка героя,
// полоса очереди, сворачивание характеристик, туман по обзору, полоски и эффекты в бою.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + PAGE + '</body></html>';

function png(w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let x = 0xffffffff; for (const b of buf) x = crcT[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); });
test.after(async () => { await browser.close(); });

/** tips: false — подсказки выключены заранее, чтобы проверять остальное без них. */
async function newPage(context, { tips = false } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (!tips) await page.addInitScript(() => { try { if (!localStorage.getItem('rpg-table.tips')) localStorage.setItem('rpg-table.tips', JSON.stringify({ enabled: false, seen: ['checklist-shown'] })); } catch (e) { /* */ } });
  await page.route('**/*', (r) => (r.request().url().startsWith('http://app.test') ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort()));
  await page.goto('http://app.test/');
  return { page, errors };
}
async function gmWithScene(page, w = 1000, h = 500) {
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  await page.click('[data-tab="scenes"]');
  await page.fill('#sceneName', 'Поле');
  await page.setInputFiles('#sceneImage', { name: 'map.png', mimeType: 'image/png', buffer: png(w, h) });
  await page.click('#sceneAdd');
  await page.waitForSelector('.map-bg');
}
async function addToken(page, name, kind, hp) {
  await page.click('[data-tab="tokens"]');
  await page.fill('#tokName', name);
  await page.selectOption('#tokKind', kind);
  if (hp != null) await page.fill('#tokHp', String(hp));
  await page.click('#tokAdd');
  await page.waitForSelector(`.token[data-name="${name}"]`);
}
async function joinPlayer(context, gmPage, name = 'Аня') {
  const code = (await gmPage.textContent('#roomCode')).trim();
  const pl = await newPage(context);
  await pl.page.click('[data-role="player"]');
  await pl.page.click('[data-act="join"]');
  await pl.page.waitForSelector('#joinName');
  await pl.page.fill('#joinName', name);
  await pl.page.fill('#joinCode', code);
  await pl.page.click('#joinGo');
  await pl.page.waitForSelector('#tbl', { timeout: 8000 });
  return pl;
}
/** Мастер: выбрать фишку и отдать игроку. */
async function giveTo(gmPage, token, playerName) {
  await gmPage.click(`.token[data-name="${token}"]`);
  await gmPage.waitForSelector('#tokEditOwner');
  await gmPage.waitForFunction((n) => [...document.querySelectorAll('#tokEditOwner option')].some((o) => o.textContent === n), playerName);
  await gmPage.selectOption('#tokEditOwner', { label: playerName });
}
async function dragToken(page, name, dx, dy) {
  const b = await page.locator(`.token[data-name="${name}"]`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}

// ---------- 1. Ошибки ----------
test('«Свернуть» закрывает «С чего начать» — мышью и касанием', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  await page.click('#checklistBtn');
  await page.waitForSelector('#checklistPanel:not([hidden])');
  const b = await page.locator('#checklistClose').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);   // настоящий щелчок по координатам
  await page.waitForTimeout(200);
  assert.equal(await page.isVisible('#checklistPanel'), false, 'мышь: свернулось');
  assert.equal(await page.getAttribute('#checklistBtn', 'aria-expanded'), 'false');
  assert.deepEqual(errors, []);
  await context.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const p2 = await newPage(phone);
  await p2.page.click('[data-role="gm"]');
  await p2.page.waitForSelector('#tbl');
  await p2.page.tap('#checklistBtn');
  await p2.page.waitForSelector('#checklistPanel:not([hidden])');
  await p2.page.tap('#checklistClose');
  await p2.page.waitForTimeout(200);
  assert.equal(await p2.page.isVisible('#checklistPanel'), false, 'палец: свернулось');
  assert.deepEqual(p2.errors, []);
  await phone.close();
});

test('подсказка вкладки — при каждом заходе, пока не нажали «Понятно»; «Показать заново» — только текущая', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context, { tips: true });
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
  const tip = () => page.$eval('.tip:not([hidden])', (t) => t.dataset.tip).catch(() => null);
  const waitTip = (id) => page.waitForFunction((x) => { const t = document.querySelector('.tip:not([hidden])'); return t && t.dataset.tip === x; }, id, { timeout: 6000 });
  await page.click('[data-tab="scenes"]'); await waitTip('gm-scenes');
  await page.click('[data-tab="tokens"]'); await waitTip('gm-tokens');
  await page.click('[data-tab="combat"]'); await waitTip('gm-combat');
  await page.click('[data-tab="scenes"]'); await waitTip('gm-scenes');            // снова — не нажимали «Понятно»
  await page.click('[data-tab="tokens"]'); await waitTip('gm-tokens');
  await page.click('.tip [data-tip-ok]');
  await page.waitForTimeout(300);
  assert.equal(await tip(), null, 'после «Понятно» на этой вкладке ничего не всплывает следом');
  await page.click('[data-tab="scenes"]'); await waitTip('gm-scenes');
  await page.click('[data-tab="tokens"]');
  await page.waitForTimeout(400);
  assert.equal(await tip(), null, 'подсказка «Фишки» больше не показывается');
  await page.click('[data-tab="journal"]'); await waitTip('gm-journal');

  // «Показать заново» на вкладке «Бой»
  await page.click('.tip [data-tip-ok]');
  await page.click('[data-tab="combat"]'); await waitTip('gm-combat');
  await page.click('.tip [data-tip-ok]');
  if (!(await page.isVisible('#checklistPanel'))) await page.click('#checklistBtn');   // мог остаться открытым с первого входа
  await page.click('#tipsReset');
  await waitTip('gm-combat');
  await page.click('.tip [data-tip-ok]');
  await page.waitForTimeout(400);
  assert.equal(await tip(), null, 'после «Понятно» не идёт цепочка по другим вкладкам');
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------- 2–4. Игрок ----------
test('игрок: «Двигать» рядом с линейкой, карточка героя справа снизу, свои хиты, полоса очереди, «Завершить ход»', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const gm = await newPage(context);
  await gmWithScene(gm.page);
  await addToken(gm.page, 'Лира', 'pc', 20);
  await addToken(gm.page, 'Гоблин', 'npc', 7);
  const pl = await joinPlayer(context, gm.page);
  await giveTo(gm.page, 'Лира', 'Аня');
  const p = pl.page;
  await p.waitForSelector('.token.mine[data-name="Лира"]');

  // «Двигать» рядом с «Линейкой»
  const tools = await p.$$eval('.map-tools [data-tool]', (bs) => bs.map((b) => b.dataset.tool));
  assert.deepEqual(tools, ['move', 'measure'], 'у игрока: Двигать и Линейка рядом');
  await p.click('[data-tool="measure"]');
  await p.click('[data-tool="move"]');
  const x0 = Number(await gm.page.getAttribute('.token[data-name="Лира"]', 'data-x'));
  await dragToken(p, 'Лира', 160, 0);
  await gm.page.waitForFunction((x) => Number(document.querySelector('.token[data-name="Лира"]').dataset.x) > x, x0, { timeout: 4000 });

  // Карточка героя
  await p.waitForSelector('#heroCard');
  const box = await p.locator('#heroCard').boundingBox();
  const vp = p.viewportSize();
  assert.ok(box.x > vp.width / 2 && box.y > vp.height / 3, 'карточка справа снизу');
  assert.match(await p.textContent('#heroCard'), /Лира/);
  assert.match(await p.textContent('#heroCard'), /20/);
  await p.fill('#heroHp', '13');
  await p.press('#heroHp', 'Enter');
  await gm.page.click('.token[data-name="Лира"]');
  await gm.page.waitForFunction(() => document.querySelector('#tokEditHp') && document.querySelector('#tokEditHp').value === '13', null, { timeout: 4000 });

  // Бой: полоса очереди и «Завершить ход» на карточке
  await gm.page.click('[data-tab="combat"]');
  await gm.page.click('#combatStart');
  await gm.page.click('#combatAddAll');
  await gm.page.waitForSelector('#combatList .cb');
  for (const [name, v] of [['Лира', 30], ['Гоблин', 1]]) {
    const id = await gm.page.getAttribute(`.token[data-name="${name}"]`, 'data-id');
    await gm.page.fill(`[data-init="${id}"]`, String(v));
    await gm.page.press(`[data-init="${id}"]`, 'Enter');
  }
  await p.waitForSelector('#turnStrip');
  await p.waitForFunction(() => /Лира/.test((document.querySelector('#turnStrip .cur') || {}).textContent || ''), null, { timeout: 4000 });
  assert.match(await p.textContent('#turnStrip'), /Раунд 1/);
  assert.equal(await gm.page.locator('#turnStrip').count(), 1, 'полоса очереди есть и у мастера');
  await p.waitForSelector('#heroCard #heroEndTurn');
  await p.click('#heroEndTurn');
  await p.waitForFunction(() => /Гоблин/.test((document.querySelector('#turnStrip .cur') || {}).textContent || ''), null, { timeout: 4000 });
  assert.equal(await p.locator('#heroEndTurn').count(), 0, 'не мой ход — кнопки нет');
  assert.deepEqual(gm.errors, []);
  assert.deepEqual(pl.errors, []);
  await context.close();
});

// ---------- 5. Сворачивание характеристик ----------
test('фишки: характеристики выбранного существа сворачиваются и остаются свёрнутыми', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await gmWithScene(page);
  await addToken(page, 'Гоблин', 'npc', 7);
  await addToken(page, 'Волк', 'npc', 11);
  await page.click('.token[data-name="Гоблин"]');
  await page.waitForSelector('#tokStats');
  assert.equal(await page.getAttribute('#tokStats', 'open'), '', 'сначала раскрыто');
  assert.equal(await page.isVisible('#tokEditHp'), true);
  await page.click('#tokStats > summary');
  assert.equal(await page.isVisible('#tokEditHp'), false, 'свернулось');
  await page.click('.token[data-name="Волк"]');
  await page.waitForFunction(() => document.querySelector('#tokEditName').value === 'Волк');
  assert.equal(await page.getAttribute('#tokStats', 'open'), null, 'у другой фишки тоже свёрнуто');
  assert.deepEqual(errors, []);
  await context.close();
});

// ---------- 6. Туман по обзору ----------
test('туман по обзору: радиус на сцену и у фишки, исследованное — без монстров', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const gm = await newPage(context);
  await gmWithScene(gm.page, 1000, 500);            // 20×10 клеток по 50 px
  await addToken(gm.page, 'Лира', 'pc', 20);        // клетка 0,0
  await addToken(gm.page, 'Гоблин', 'npc', 7);      // клетка 1,0
  await gm.page.click('[data-tab="scenes"]');
  await gm.page.check('#fogEnabled');
  await gm.page.selectOption('#fogMode', 'vision');
  await gm.page.fill('#fogRadius', '10');
  await gm.page.press('#fogRadius', 'Enter');
  assert.match(await gm.page.textContent('[for="fogRadius"]'), /фут/, 'единицы по НРИ');
  const pl = await joinPlayer(context, gm.page);
  await giveTo(gm.page, 'Лира', 'Аня');
  const p = pl.page;
  await p.waitForSelector('.token[data-name="Лира"]');
  await p.waitForSelector('.token[data-name="Гоблин"]', { timeout: 4000 });   // в 1 клетке — видно

  // Лира уходит вправо на 8 клеток: гоблин остаётся в исследованном — не виден
  const lira = await gm.page.getAttribute('.token[data-name="Лира"]', 'data-id');
  const b = await p.locator('.token[data-name="Лира"]').boundingBox();
  const g = await p.locator('.token[data-name="Гоблин"]').boundingBox();
  const cell = g.x - b.x;                              // ширина клетки на экране
  await dragToken(p, 'Лира', cell * 8, 0);
  await p.waitForFunction(() => !document.querySelector('.token[data-name="Гоблин"]'), null, { timeout: 4000 });
  assert.ok(lira);

  // тёмное зрение: у фишки свой радиус 60 фт — гоблин снова в обзоре
  await gm.page.click('.token[data-name="Лира"]');
  await gm.page.fill('#tokEditVision', '60');
  await gm.page.press('#tokEditVision', 'Enter');
  await p.waitForSelector('.token[data-name="Гоблин"]', { timeout: 4000 });

  // туман у игрока: в обзоре чисто, неисследованное — плотно
  const shade = await p.evaluate(() => {
    const cv = document.querySelector('#mapFog'); const c = cv.getContext('2d');
    const a = (x, y) => c.getImageData(x, y, 1, 1).data[3];
    return { visible: a(425, 25), far: a(975, 475) };
  });
  assert.ok(shade.visible < 40, 'в обзоре тумана нет');
  assert.ok(shade.far > 200, 'неисследованное — плотный туман');
  assert.deepEqual(gm.errors, []);
  assert.deepEqual(pl.errors, []);
  await context.close();
});

// ---------- 7. Бой у мастера ----------
test('бой у мастера: полоски хитов, поля, эффекты с раундами; игрок видит эффект на карточке', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const gm = await newPage(context);
  const page = gm.page;
  await gmWithScene(page);
  await addToken(page, 'Лира', 'pc', 20);
  await addToken(page, 'Гоблин', 'npc', 8);
  const pl = await joinPlayer(context, page);
  await giveTo(page, 'Лира', 'Аня');
  await page.click('.token[data-name="Гоблин"]');
  await page.fill('#tokEditHp', '2');
  await page.press('#tokEditHp', 'Enter');
  await page.click('[data-tab="combat"]');
  await page.click('#combatStart');
  await page.click('#combatAddAll');
  await page.waitForSelector('#combatList .cb[data-cb]');
  const row = (name) => page.locator('#combatList .cb', { hasText: name });
  const width = await row('Гоблин').locator('.cb-hp i').evaluate((i) => i.style.width);
  assert.equal(width, '25%', 'полоска хитов 2/8');
  assert.match(await row('Гоблин').textContent(), /КД/, 'поля системы в строке');

  await row('Гоблин').locator('.fx-pick').selectOption('Отравлен');
  await row('Гоблин').locator('.fx-rounds').fill('2');
  await row('Гоблин').locator('.fx-add').click();
  await page.waitForFunction(() => /Отравлен\s*2/.test(document.querySelector('#combatList').textContent));
  await row('Лира').locator('.fx-pick').selectOption('Ослеплён');
  await row('Лира').locator('.fx-rounds').fill('');
  await row('Лира').locator('.fx-add').click();
  await pl.page.waitForFunction(() => document.querySelector('#heroCard') && /Ослеплён/.test(document.querySelector('#heroCard').textContent), null, { timeout: 4000 });

  const n = await page.locator('#combatList .cb').count();
  for (let i = 0; i < n; i++) await page.click('#combatNext');          // новый раунд
  await page.waitForFunction(() => /Отравлен\s*1/.test(document.querySelector('#combatList').textContent));
  for (let i = 0; i < n; i++) await page.click('#combatNext');
  await page.waitForFunction(() => !/Отравлен/.test(document.querySelector('#combatList').textContent));
  assert.match(await page.textContent('#chatLog'), /Отравлен.*закончил/);
  // снять эффект вручную
  await row('Лира').locator('.fx [data-fxdel]').click();
  await pl.page.waitForFunction(() => !/Ослеплён/.test(document.querySelector('#heroCard').textContent), null, { timeout: 4000 });
  assert.deepEqual(gm.errors, []);
  assert.deepEqual(pl.errors, []);
  await context.close();
});
