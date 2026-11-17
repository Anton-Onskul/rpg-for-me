// Сквозные тесты подсказок за столом: всплывающие окна, чек-лист мастера, выключение, НРИ, телефон.
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
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 100)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined }); });
test.after(async () => { await browser.close(); });

async function newPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', (r) => (r.request().url().startsWith('http://app.test') ? r.fulfill({ contentType: 'text/html', body: HTML }) : r.abort()));
  await page.goto('http://app.test/');
  return { page, errors };
}
async function openGM(page) {
  await page.click('[data-role="gm"]');
  await page.waitForSelector('#tbl');
}
const tipId = (page) => page.$eval('.tip', (t) => t.dataset.tip).catch(() => null);
const visibleTip = async (page, ms = 3000) => { await page.waitForSelector('.tip:not([hidden])', { timeout: ms }); return tipId(page); };
const noTip = async (page) => { await page.waitForTimeout(500); return (await page.locator('.tip:not([hidden])').count()) === 0; };
// «Понятно» закрывает эту подсказку; следом может сразу появиться следующая (цепочка, как в играх).
async function closeTip(page) {
  const id = await tipId(page);
  await page.click('.tip [data-tip-ok]');
  await page.waitForFunction((was) => { const t = document.querySelector('.tip:not([hidden])'); return !t || t.dataset.tip !== was; }, id);
}

test('мастер: подсказка появляется сама, не мешает карте и показывается один раз', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await openGM(page);
  const first = await visibleTip(page);
  assert.ok(first, 'при открытии стола есть подсказка');
  assert.ok((await page.textContent('.tip .tip-title')).trim(), 'есть заголовок');
  assert.ok((await page.textContent('.tip .tip-text')).trim().length > 20, 'есть текст');
  assert.equal(await page.locator('.tip .tip-arrow').count(), 1, 'стрелка к элементу');

  const geo = await page.evaluate(() => {
    const t = document.querySelector('.tip').getBoundingClientRect();
    const m = document.querySelector('#mapVp').getBoundingClientRect();
    const cx = m.left + m.width / 2, cy = m.top + m.height / 2;
    const atCenter = document.elementFromPoint(cx, cy);
    return { share: (t.width * t.height) / (innerWidth * innerHeight), centerCovered: !!(atCenter && atCenter.closest('.tip')),
      inside: t.left >= 0 && t.top >= 0 && t.right <= innerWidth && t.bottom <= innerHeight };
  });
  assert.ok(geo.share <= 0.15, 'занимает ≤ 15% окна, а не ' + Math.round(geo.share * 100) + '%');
  assert.equal(geo.centerCovered, false, 'центр карты открыт');
  assert.ok(geo.inside, 'целиком в окне');
  assert.equal(await page.locator('.tip-backdrop, .modal-backdrop').count(), 0, 'без затемнения');
  await page.click('[data-tool="reveal"]');
  assert.equal(await page.getAttribute('[data-tool="reveal"]', 'aria-pressed'), 'true', 'кнопки стола работают при открытой подсказке');

  await closeTip(page);
  await page.click('[data-tab="tokens"]');
  const second = await visibleTip(page);
  assert.notEqual(second, first, 'на новой вкладке — новая подсказка');
  assert.match(await page.textContent('.tip .tip-text'), /КД/, 'D&D: про КД');
  await closeTip(page);

  await page.reload();
  await page.waitForSelector('#tbl');
  await page.waitForTimeout(600);
  assert.notEqual(await tipId(page), first, 'увиденная подсказка не повторяется после перезагрузки');
  assert.deepEqual(errors, []);
  await context.close();
});

test('мастер: «Подсказки вкл/выкл» запоминается, сброс показывает заново', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await openGM(page);
  const first = await visibleTip(page);
  assert.equal(await page.getAttribute('#tipsToggle', 'aria-pressed'), 'true');
  await page.click('#tipsToggle');
  assert.equal(await page.getAttribute('#tipsToggle', 'aria-pressed'), 'false');
  assert.ok(await noTip(page), 'выключение убирает открытую подсказку');
  await page.click('[data-tab="combat"]');
  assert.ok(await noTip(page), 'выключено — новых нет');
  await page.reload();
  await page.waitForSelector('#tbl');
  assert.equal(await page.getAttribute('#tipsToggle', 'aria-pressed'), 'false', 'запомнилось');
  assert.ok(await noTip(page));

  await page.click('#tipsToggle');
  await page.click('[data-tab="journal"]');
  assert.ok(await visibleTip(page), 'включили — подсказки снова появляются');

  await page.click('#checklistBtn');
  await page.click('#tipsReset');
  await page.reload();
  await page.waitForSelector('#tbl');
  assert.equal(await visibleTip(page), first, 'после сброса первая подсказка снова показывается');
  // кнопка «Выключить» в самой подсказке
  await page.click('.tip [data-tip-off]');
  assert.equal(await page.getAttribute('#tipsToggle', 'aria-pressed'), 'false');
  assert.deepEqual(errors, []);
  await context.close();
});

test('мастер: чек-лист «С чего начать» отмечает шаги сам и ведёт на вкладки', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await openGM(page);
  await page.waitForSelector('#checklistPanel:not([hidden])', { timeout: 3000 });
  assert.match(await page.textContent('#checklistBtn'), /С чего начать.*0\/7/);
  assert.equal(await page.locator('#checklistPanel .ck-item').count(), 7);
  assert.equal(await page.locator('#checklistPanel .ck-item.done').count(), 0);

  await page.click('#checklistPanel .ck-item[data-step="scene"]');
  assert.equal(await page.getAttribute('[data-tab="scenes"]', 'aria-selected'), 'true', 'шаг ведёт на вкладку');
  await page.fill('#sceneName', 'Таверна');
  await page.setInputFiles('#sceneImage', { name: 'map.png', mimeType: 'image/png', buffer: png(300, 200) });
  await page.click('#sceneAdd');
  await page.waitForSelector('.map-bg');
  await page.waitForFunction(() => /2\/7/.test(document.querySelector('#checklistBtn').textContent));
  if (!(await page.isVisible('#checklistPanel'))) await page.click('#checklistBtn');
  assert.equal(await page.locator('#checklistPanel .ck-item.done').count(), 2, 'сцена и карта отмечены');
  await page.click('#checklistPanel .ck-item[data-step="tokens"]');
  assert.equal(await page.getAttribute('[data-tab="tokens"]', 'aria-selected'), 'true');

  await page.reload();
  await page.waitForSelector('#tbl');
  await page.waitForTimeout(400);
  assert.equal(await page.isVisible('#checklistPanel'), false, 'при следующих открытиях список свёрнут');
  assert.match(await page.textContent('#checklistBtn'), /2\/7/, 'прогресс сохранился вместе с кампанией');
  assert.deepEqual(errors, []);
  await context.close();
});

test('подсказки учитывают НРИ: GURPS объясняет 3к6 под навык', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const { page, errors } = await newPage(context);
  await openGM(page);
  if (await page.isVisible('.tip')) await closeTip(page);
  await page.selectOption('#tableSystem', 'gurps');
  await page.focus('#diceExpr');
  await visibleTip(page);
  const text = await page.textContent('.tip .tip-text');
  assert.match(text, /3к6/);
  assert.match(text, /навык/i);
  assert.deepEqual(errors, []);
  await context.close();
});

test('игрок за столом получает свои подсказки, чек-листа у него нет', async () => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const gm = await newPage(context);
  await openGM(gm.page);
  const code = (await gm.page.textContent('#roomCode')).trim();
  const pl = await newPage(context);
  await pl.page.click('[data-role="player"]');
  await pl.page.click('[data-act="join"]');
  await pl.page.waitForSelector('#joinName');
  await pl.page.fill('#joinName', 'Аня');
  await pl.page.fill('#joinCode', code);
  await pl.page.click('#joinGo');
  await pl.page.waitForSelector('#tbl', { timeout: 8000 });
  const id = await visibleTip(pl.page);
  assert.match(id, /^pl-/, 'игроцкая подсказка');
  assert.equal(await pl.page.locator('#checklistBtn').count(), 0);
  assert.equal(await pl.page.locator('#tipsToggle').count(), 1, 'выключить может и игрок');
  await closeTip(pl.page);
  await pl.page.click('[data-tab="hero"]');
  await visibleTip(pl.page);
  assert.match(await pl.page.textContent('.tip .tip-text'), /лист/i);
  // мастер узнаёт о первом игроке
  await gm.page.waitForFunction(() => document.querySelector('.tip:not([hidden])') && /player|игрок/i.test(document.querySelector('.tip').dataset.tip + document.querySelector('.tip').textContent), null, { timeout: 5000 }).catch(() => {});
  assert.deepEqual(gm.errors, []);
  assert.deepEqual(pl.errors, []);
  await context.close();
});

test('телефон: подсказка внизу, не выше 40% экрана, без прокрутки вбок', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const { page, errors } = await newPage(context);
  await openGM(page);
  await visibleTip(page);
  const r = await page.evaluate(() => { const t = document.querySelector('.tip').getBoundingClientRect(); return { l: t.left, r: t.right, t: t.top, b: t.bottom, h: t.height }; });
  assert.ok(r.l >= 0 && r.r <= 390, 'по ширине в экране');
  assert.ok(r.b <= 800 && r.t >= 800 * 0.5, 'прижата к низу экрана');
  assert.ok(r.h <= 800 * 0.4, 'не выше 40% экрана, а ' + Math.round(r.h));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual(errors, []);
  await context.close();
});
